import { Context } from "cocoa-discord-utils";
import { Awaitable } from "cocoa-discord-utils/internal/base";

import { GuildMember, VoiceChannel } from "discord.js";

import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  DiscordGatewayAdapterCreator,
  entersState,
  getVoiceConnection,
  joinVoiceChannel as libJoinVoiceChannel,
  VoiceConnection,
  VoiceConnectionStatus,
} from "@discordjs/voice";

import play, { YouTubeVideo } from "play-dl";

export interface IMusic {
  video: YouTubeVideo;
  requested_by: string;
}

interface MusicState {
  music_queue: IMusic[];
  now_playing: IMusic | undefined;
  audio_player: AudioPlayer | null;
  is_looping: boolean;
  is_playing: boolean;
  channel_id: string | null;
  playing_since: number;
}

function defaultMusicState() {
  return {
    music_queue: [],
    now_playing: undefined,
    audio_player: null,
    is_looping: false,
    is_playing: false,
    channel_id: null,
    playing_since: 0,
  };
}

export const musicStates: { [guildId: string]: MusicState } = {};

export function getState(guildId: string) {
  return (musicStates[guildId] ??= defaultMusicState());
}

export namespace VoiceHelper {
  export function forceDestroyConnection(conn: VoiceConnection | undefined) {
    try {
      conn?.destroy();
    } catch (e) {
      // pass
    }
  }

  export function isPaused(guildId: string) {
    return (
      getState(guildId).audio_player?.state?.status === AudioPlayerStatus.Paused
    );
  }
}

export namespace Utilities {
  export function pickLast<T>(arr: T[]) {
    return arr[arr.length - 1];
  }
}

export namespace Voice {
  export enum JoinFailureReason {
    Success,
    AlreadyConnected,
    NoChannel,
    NotJoinable,
    Other,
  }

  /**
   * Joins to the channel if not already in one.
   */
  export async function joinFromContext(
    ctx: Context,
    force = false
  ): Promise<JoinFailureReason> {
    const connection = getVoiceConnection(ctx.guildId!);

    if (connection?.state.status === VoiceConnectionStatus.Ready && !force) {
      return JoinFailureReason.AlreadyConnected;
    }

    const voiceChannel = (ctx.member as GuildMember | undefined)?.voice
      .channel as VoiceChannel | undefined;

    if (!voiceChannel) return JoinFailureReason.NoChannel;

    if (!voiceChannel.joinable) return JoinFailureReason.NotJoinable;

    return (await Voice.joinVoiceChannel(voiceChannel))
      ? JoinFailureReason.Success
      : JoinFailureReason.Other;
  }

  /**
   * Joins voice channel
   * @returns Connection
   */
  export async function joinVoiceChannel(
    channel: VoiceChannel,
    onDisconnect?: () => Awaitable<void>
  ) {
    const connection = libJoinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild
        .voiceAdapterCreator as DiscordGatewayAdapterCreator,
      selfMute: false,
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        // Seems to be reconnecting to a new channel - ignore disconnect
      } catch (error) {
        // Seems to be a real disconnect which SHOULDN'T be recovered from
        VoiceHelper.forceDestroyConnection(connection);
        await onDisconnect?.();
      }
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 5_000);
      getState(channel.guildId).channel_id = channel.id;
      return connection;
    } catch (err) {
      return undefined;
    }
  }

  /**
   * Add music to queue and play it if not playing
   * @returns Meta Info of the Video or string indicating failure reason
   */
  export async function addMusicToQueue(
    guildId: string,
    url: string,
    requester: string
  ) {
    let video: YouTubeVideo | undefined;

    const type = play.yt_validate(url);

    const state = getState(guildId);

    if (type === "search") {
      video = (await play.search(url, { limit: 1 }))[0];

      if (!video) {
        return "No video found";
      }

      video = (await play.video_basic_info(video.url)).video_details;

      state.music_queue.push({
        video,
        requested_by: requester,
      });
    } else if (type === "video") {
      video = (await play.video_basic_info(url)).video_details;

      state.music_queue.push({
        video,
        requested_by: requester,
      });
    } else if (type === "playlist") {
      const playlist = await play.playlist_info(url);
      const all_videos = await playlist.all_videos();

      if (all_videos.length < 1) {
        return "This playlist has no videos!";
      }

      state.music_queue.push(
        ...(await Promise.all(
          all_videos.map(async (video) => ({
            url: video.url,
            video: (await play.video_basic_info(video.url)).video_details,
            requested_by: requester,
          }))
        ))
      );

      video = all_videos[0]!;
    } else {
      return "Unknown URL";
    }

    if (!state.is_playing) playNextMusicInQueue(guildId);

    return video;
  }

  /**
   * @param guildId
   * @returns `true` if music finished successfully,
   * `false` early if no connection found or later when error occured
   */
  export async function playNextMusicInQueue(guildId: string) {
    const state = getState(guildId);

    if (state.is_looping && state.now_playing) {
      state.music_queue.push(state.now_playing);
    }

    if (state.music_queue.length < 1) {
      state.is_playing = false;
      VoiceHelper.forceDestroyConnection(getVoiceConnection(guildId));
      state.channel_id = null;
      return;
    }

    const music = state.music_queue.shift()!;
    state.now_playing = music;

    const connection = getVoiceConnection(guildId);
    if (!connection) return false;

    const audioPlayer = createAudioPlayer();
    state.audio_player = audioPlayer;
    connection.subscribe(audioPlayer);

    const stream = await play.stream(music.video.url);

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
    });

    audioPlayer.play(resource);

    state.is_playing = true;
    state.playing_since = new Date().getTime();

    return await new Promise<boolean>((resolve, reject) => {
      audioPlayer.on(AudioPlayerStatus.Idle, () => {
        playNextMusicInQueue(guildId);
        resolve(true);
      });
      audioPlayer.on("error", (err) => {
        playNextMusicInQueue(guildId);
        reject(err);
      });
    });
  }

  /**
   * Skip the music by force playing next song
   */
  export function skipMusic(guildId: string) {
    const connection = getVoiceConnection(guildId);

    if (!connection) return false;

    playNextMusicInQueue(guildId);
  }

  /**
   * Clear all music in queue, stops the current audio player
   * and disconnect from voice
   */
  export function clearMusicQueue(guildId: string) {
    const state = getState(guildId);

    state.music_queue = [];
    state.audio_player?.stop();
    state.now_playing = undefined;
    state.is_looping = false;

    VoiceHelper.forceDestroyConnection(getVoiceConnection(guildId));
  }

  /** @returns Removed Music or undefined if index out of bound */
  export function removeFromQueue(guildId: string, index: number) {
    const state = getState(guildId);
    return state.music_queue.splice(index - 1, 1)?.[0];
  }
}

import youtube, { Scraper } from "@yimura/scraper";

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

import ytdl, { VideoDetails, videoInfo } from "ytdl-core";

export interface IMusic {
    url: string;
    detail: VideoDetails;
    rawmeta: videoInfo;
    requested_by: string;
}

// @ts-ignore
export const yt = new youtube.default() as Scraper;

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
        } catch (e) {}
    }

    export function isPaused(guildId: string) {
        return (
            getState(guildId).audio_player?.state?.status ==
            AudioPlayerStatus.Paused
        );
    }
}

export namespace YoutubeHelper {
    export async function searchVideo(query: string) {
        return (await yt.search(query)).videos;
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

        if (connection?.state.status == VoiceConnectionStatus.Ready && !force) {
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

        connection.on(VoiceConnectionStatus.Disconnected, async (_, __) => {
            try {
                await Promise.race([
                    entersState(
                        connection,
                        VoiceConnectionStatus.Signalling,
                        5_000
                    ),
                    entersState(
                        connection,
                        VoiceConnectionStatus.Connecting,
                        5_000
                    ),
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
        if (!ytdl.validateURL(url)) {
            url = (await YoutubeHelper.searchVideo(url))[0]?.link ?? "";
            if (!url) return "No results found";
        }

        const meta = await ytdl.getInfo(url);
        const detail = meta.player_response.videoDetails;

        const state = getState(guildId);
        state.music_queue.push({
            url,
            detail,
            rawmeta: meta,
            requested_by: requester,
        });

        if (!state.is_playing) playNextMusicInQueue(guildId);

        return meta;
    }

    /**
     * @param guildId
     * @returns `true` if music finished successfully,
     * `false` early if no connection found or later when error occured
     */
    export function playNextMusicInQueue(guildId: string) {
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

        const stream = ytdl.downloadFromInfo(music.rawmeta, {
            filter: "audioonly",
            quality: "highestaudio",
            highWaterMark: 1 << 25,
            liveBuffer: 4000,
        });

        const resource = createAudioResource(stream);
        audioPlayer.play(resource);

        state.is_playing = true;
        state.playing_since = new Date().getTime();

        return new Promise<boolean>((resolve, reject) => {
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

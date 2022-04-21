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
import youtube, { Scraper } from "@yimura/scraper";

import { Context } from "cocoa-discord-utils";
import { Awaitable } from "cocoa-discord-utils/internal/base";
import { GuildMember, VoiceChannel } from "discord.js";
import ytdl, { VideoDetails, videoInfo } from "ytdl-core";

export interface IMusic {
    url: string;
    detail: VideoDetails;
    rawmeta: videoInfo;
}

// @ts-ignore
export const yt: Scraper = new youtube.default();

export namespace Voice {
    export const music_queue: { [guildId: string]: IMusic[] } = {};
    export const now_playing: { [guildId: string]: IMusic | undefined } = {};
    export const audio_player: { [guildId: string]: AudioPlayer } = {};

    export function destroyConnection(conn: VoiceConnection | undefined) {
        try {
            conn?.destroy();
        } catch (e) {}
    }

    // eslint-disable-next-line prefer-const
    export let loop = false;

    export function isPaused(guildId: string) {
        return audio_player[guildId]?.state?.status == AudioPlayerStatus.Paused;
    }

    /**
     * Joins to the channel if not already in one.
     * @returns `false` if no changes, `true` if new channel is joined
     */
    export async function joinFromContext(ctx: Context) {
        const connection = getVoiceConnection(ctx.guildId!);

        const voiceChannel = (ctx.member as GuildMember | undefined)?.voice
            .channel as VoiceChannel | undefined;

        if (!voiceChannel) return false;

        const guild = ctx.client.guilds.cache.get(ctx.guildId!);

        if (!guild?.available) return false;

        if (connection?.state.status == VoiceConnectionStatus.Ready) {
            return false;
        }

        await Voice.joinVoiceChannel(voiceChannel);

        return true;
    }

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
                destroyConnection(connection);
                await onDisconnect?.();
            }
        });

        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 5_000);
            return connection;
        } catch (err) {
            return undefined;
        }
    }

    export async function searchVideo(query: string) {
        return (await yt.search(query)).videos;
    }

    let isPlaying = false;

    /**
     * Add music to queue and play it if not playing
     * @returns Meta Info of the Video
     */
    export async function addMusicToQueue(guildId: string, url: string) {
        if (!ytdl.validateURL(url)) {
            url = (await searchVideo(url))[0].link;
        }

        const meta = await ytdl.getInfo(url);
        const detail = meta.player_response.videoDetails;

        music_queue[guildId] ??= [];
        music_queue[guildId].push({ url, detail, rawmeta: meta });

        if (!isPlaying) playNextMusicInQueue(guildId);

        return meta;
    }

    /**
     * @param guildId
     * @returns true if music finished successfully,
     * false immediately if no connection found or later when error occured
     */
    export function playNextMusicInQueue(guildId: string) {
        if (loop && now_playing[guildId]) {
            music_queue[guildId].push(now_playing[guildId]!);
        }

        if (music_queue[guildId]?.length < 1) {
            isPlaying = false;
            destroyConnection(getVoiceConnection(guildId));
            return;
        }

        const music = music_queue[guildId]!.shift()!;
        now_playing[guildId] = music;

        const connection = getVoiceConnection(guildId);
        if (!connection) return false;

        const audioPlayer = createAudioPlayer();
        audio_player[guildId] = audioPlayer;
        connection.subscribe(audioPlayer);

        const stream = ytdl.downloadFromInfo(music.rawmeta, {
            filter: "audioonly",
            quality: "highestaudio",
            highWaterMark: 1 << 25,
            liveBuffer: 4000,
        });

        const resource = createAudioResource(stream);
        audioPlayer.play(resource);

        isPlaying = true;

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
        music_queue[guildId] = [];

        audio_player[guildId]?.stop();

        now_playing[guildId] = undefined;

        loop = false;

        destroyConnection(getVoiceConnection(guildId));
    }

    /** @returns Removed Music or undefined if index out of bound */
    export function removeFromQueue(guildId: string, index: number) {
        return music_queue[guildId]?.splice(index - 1, 1)?.[0];
    }
}

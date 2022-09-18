import { EmbedStyle } from "cocoa-discord-utils";
import {
    CogSlashClass,
    SlashCommand,
    Param,
} from "cocoa-discord-utils/slash/class";

import {
    ActionRowBuilder,
    Awaitable,
    Client,
    SelectMenuBuilder,
    SelectMenuInteraction,
} from "discord.js";

import chalk from "chalk";
import { search, YouTubeVideo } from "play-dl";
import { v4 as uuid } from "uuid";

import {
    musicStates,
    Voice,
    IMusic,
    getState,
    VoiceHelper,
    Utilities,
} from "./voice";

export class Music extends CogSlashClass {
    protected selectMenuHandler?: (i: SelectMenuInteraction) => Awaitable<void>;
    protected garbage = new Set<string>();

    /**
     * Try to remove components from that select menu and add a message,
     * catch error and prints if failed
     */
    protected async yeetSelectMenu(interaction: SelectMenuInteraction) {
        await interaction
            .update({
                content:
                    "This interaction is no longer tracked! Please create new one!",
                components: [],
            })
            .catch(() =>
                console.log(
                    chalk.red(
                        `Attempt to delete components failed: ${interaction.customId}`
                    )
                )
            );
    }

    constructor(
        private client: Client,
        private style: EmbedStyle,
        description?: string
    ) {
        super("Music", description ?? "Cog for playing musics from YouTube");

        client.on("interactionCreate", async (interaction) => {
            if (interaction.isSelectMenu() && this.selectMenuHandler) {
                try {
                    await this.selectMenuHandler(interaction);
                } catch (err) {
                    console.log(
                        chalk.red(`Error while handling Select Menu: ${err}`)
                    );
                    await interaction.channel
                        ?.send(`${err}`)
                        .catch(console.error);
                }
            }
        });
    }

    protected parseLength(seconds: number) {
        const minutes = Math.floor(seconds / 60);

        seconds %= 60;

        return `${minutes}:${seconds >= 10 ? `${seconds}` : `0${seconds}`}`;
    }

    /** Only works for positive number */
    protected beautifyNumber(
        n: number | string | undefined | null,
        fallback = "Unknown"
    ) {
        if ((n ?? undefined) == undefined) return fallback;

        n = "" + n;

        let res = "";

        for (let i = 0; i < n.length; i++) {
            if ((n.length - i) % 3 == 0) {
                res += " ";
            }
            res += n[i];
        }

        return res.trim();
    }

    protected musicEmbed(
        ctx: SlashCommand.Context,
        requester: string,
        video: YouTubeVideo,
        overrides?: { title: string; desc: string }
    ) {
        const emb = this.style
            .use(ctx)
            .setTitle(overrides?.title ?? "Added to Queue")
            .setDescription(
                `[${video.title}](${video.url})${
                    overrides?.desc ? "\n" + overrides.desc : ""
                }`
            )
            .setThumbnail(Utilities.pickLast(video.thumbnails)?.url ?? "")
            .addInlineFields(
                {
                    name: "🎙️Author",
                    value: `[${video.channel?.name ?? "Unknown"}](${
                        video.channel?.url
                    })`,
                },
                {
                    name: "🧑Subscribers",
                    value: this.beautifyNumber(video.channel?.subscribers),
                },
                {
                    name: "⌛Duration",
                    value:
                        video.durationInSec == 0
                            ? "LIVE"
                            : this.parseLength(video.durationInSec),
                },
                {
                    name: "🎫Requested By",
                    value: `<@${requester}>`,
                },
                {
                    name: "👁️Watch",
                    value: this.beautifyNumber(video.views),
                },
                {
                    name: "👍Like",
                    value: this.beautifyNumber(video.likes),
                }
            );

        return emb;
    }

    /**
     * @returns `true` if should ends the function,
     * it will followUp the interaction printing error message
     */
    protected async joinHook(ctx: SlashCommand.Context, force = false) {
        const res = await Voice.joinFromContext(ctx, force);

        if (res == Voice.JoinFailureReason.NoChannel) {
            await ctx.followUp("Command Failed: No channel to join");
        } else if (res == Voice.JoinFailureReason.NotJoinable) {
            await ctx.followUp("Command Failed: This channel is not joinable");
        } else if (res == Voice.JoinFailureReason.Other) {
            await ctx.followUp("Command Failed: Unknown Reason");
        } else {
            return false;
        }

        return true;
    }

    @SlashCommand("Play a song/video from YouTube")
    async play(
        ctx: SlashCommand.Context,
        @Param.String("Youtube URL or Search Query") song: Param.String.Type
    ) {
        await ctx.deferReply();

        if (await this.joinHook(ctx)) return;

        const video = await Voice.addMusicToQueue(
            ctx.guildId!,
            song,
            ctx.user.id
        );

        if (typeof video == "string") {
            await ctx.followUp("Cannot find any video with that name");
            return;
        }

        const emb = this.musicEmbed(ctx, ctx.user.id, video);

        await ctx.followUp({ embeds: [emb.toJSON()] });
    }

    protected trimLabel(p1: string, p2: string) {
        const lenlim = 96 - p2.length;
        if (p1.length > 96 - p2.length) {
            p1 = p1.slice(0, lenlim - 3) + "...";
        }

        return `${p1} ${p2}`;
    }

    @SlashCommand("Pause the song")
    async pause(ctx: SlashCommand.Context) {
        if (musicStates[ctx.guildId!]?.audio_player?.pause())
            await ctx.reply("⏸️");
        else await ctx.reply("❓");
    }

    @SlashCommand("Resume paused song")
    async resume(ctx: SlashCommand.Context) {
        if (musicStates[ctx.guildId!]?.audio_player?.unpause())
            await ctx.reply("▶️");
        else await ctx.reply("❓");
    }

    @SlashCommand("Toggle Loop")
    async loop(ctx: SlashCommand.Context) {
        const state = getState(ctx.guildId!);
        state.is_looping = !state.is_looping;

        await ctx.reply(state.is_looping ? "🔁" : "🔂");
    }

    @SlashCommand("Prints the current song")
    async now(ctx: SlashCommand.Context) {
        const state = getState(ctx.guildId!);

        if (!state.is_playing || !state.now_playing) {
            await ctx.reply("Nothing is playing right now!");
            return;
        }

        let progressed = Math.round(
            (new Date().getTime() - state.playing_since) / 1000
        );
        const total = +state.now_playing.video.durationInSec;
        progressed = Math.min(progressed, total);

        const parts = 69;

        const part = Math.round((progressed * parts) / total);
        const prog = `**|${"-".repeat(part)}⬤${"-".repeat(
            parts - part
        )}|**\n**${this.parseLength(progressed)} / ${this.parseLength(
            total
        )}**`;

        const emb = this.musicEmbed(
            ctx,
            state.now_playing.requested_by,
            state.now_playing.video,
            {
                title: "Now Playing",
                desc: prog,
            }
        );

        await ctx.reply({ embeds: [emb] });
    }

    @SlashCommand("Remove x-th song from the queue")
    async remove(
        ctx: SlashCommand.Context,
        @Param.Integer("Index of removal") index: Param.Integer.Type
    ) {
        if (index <= 0) {
            await ctx.reply("❗Invalid Index");
            return;
        }

        const music = Voice.removeFromQueue(ctx.guildId!, index);

        if (music) {
            await ctx.reply(
                `✅ Removed **${music.video.title} - ${music.video.channel?.name}**`
            );
        } else {
            await ctx.reply("❗There is nothing to remove at that index!");
        }
    }

    @SlashCommand("Search for Song on YouTube")
    async search(
        ctx: SlashCommand.Context,
        @Param.String("What to search for") song: Param.String.Type
    ) {
        await ctx.deferReply();

        const songs = await search(song, { limit: 10 });

        let text = "";
        const ss = songs.slice(0, 10);

        for (let i = 0; i < ss.length; i++) {
            text += `**${i + 1})** ${ss[i]!.title} [${ss[i]!.durationRaw}]\n`;
        }

        const emb = this.style
            .use(ctx)
            .setTitle(`Search Results for "**${song}**"`)
            .setDescription(text || "NO RESULT");

        if (ss.length < 1) {
            await ctx.followUp({ embeds: [emb] });
            return;
        }

        const thisId = uuid().split("-")[0]!;

        const menu = new SelectMenuBuilder()
            .setCustomId(thisId)
            .setPlaceholder("Select your Song")
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
                ss.map((vid) => ({
                    label: this.trimLabel(
                        vid.title ?? "",
                        `[${vid.durationRaw}]`
                    ),
                    value: vid.url,
                }))
            );

        const row = new ActionRowBuilder<SelectMenuBuilder>().addComponents([
            menu,
        ]);

        this.selectMenuHandler = async (interaction) => {
            if (interaction.customId != thisId) {
                // * Old Interaction
                if (this.garbage.has(interaction.customId))
                    this.yeetSelectMenu(interaction);
                return;
            }

            if (await this.joinHook(ctx)) return;
            const prom = Voice.addMusicToQueue(
                ctx.guildId!,
                interaction.values[0]!,
                ctx.user.id
            );

            let newtext = "";
            for (let i = 0; i < ss.length; i++) {
                if (ss[i]!.url == interaction.values[0]) {
                    newtext += `**${i + 1}) ${ss[i]!.title} [${
                        ss[i]!.durationRaw
                    }]**\n`;
                } else {
                    newtext += `~~**${i + 1})** ${ss[i]!.title} [${
                        ss[i]!.durationRaw
                    }]~~\n`;
                }
            }

            this.selectMenuHandler = undefined;

            await interaction.message.edit({
                embeds: [
                    emb.setDescription(newtext),
                    this.musicEmbed(
                        ctx,
                        ctx.user.id,
                        (await prom) as YouTubeVideo
                    ),
                ],
                components: [],
            });

            this.garbage.add(thisId);
        };

        await ctx.followUp({
            embeds: [emb],
            components: [row],
        });
    }

    protected musicToString(music: IMusic) {
        return `[${music.video.title} - ${music.video.channel?.name}](${music.video.url})`.replaceAll(
            "*",
            "\\*"
        );
    }

    @SlashCommand("Prints out the current Queue")
    async queue(ctx: SlashCommand.Context) {
        const state = getState(ctx.guildId!);
        const q = state.music_queue;

        let text = "";

        if (state.is_looping) text += "*Loop is currently enabled*\n";

        if (VoiceHelper.isPaused(ctx.guildId!))
            text += "*Music is currently manually paused*\n";

        if (state.now_playing) {
            if (text) text += "\n";
            text +=
                "**Now Playing**\n" +
                this.musicToString(state.now_playing) +
                "\n";
        }

        if (q?.length > 0) text += "**Queue**\n";

        for (const [index, m] of Object.entries(q ?? [])) {
            text += `**${+index + 1})** ${this.musicToString(m)}\n`;
        }

        const emb = this.style
            .use(ctx)
            .setTitle("Music Queue")
            .setDescription(text || "**The Queue is Empty!**");

        await ctx.reply({ embeds: [emb] });
    }

    @SlashCommand("Skip the current song")
    async skip(ctx: SlashCommand.Context) {
        Voice.skipMusic(ctx.guildId!);

        await ctx.reply("⏩");
    }

    @SlashCommand(
        "Clear all songs in the queue, stop playing and leave the channel"
    )
    async clear(ctx: SlashCommand.Context) {
        Voice.clearMusicQueue(ctx.guildId!);

        await ctx.reply("Cleared!");
    }

    @SlashCommand("(Force) moves the bot to your voice channel")
    async rejoin(ctx: SlashCommand.Context) {
        if (await this.joinHook(ctx, true)) return;

        await ctx.reply("✅ Rejoined");
    }
}

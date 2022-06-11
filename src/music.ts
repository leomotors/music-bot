import { EmbedStyle } from "cocoa-discord-utils";
import { CogSlashClass, SlashCommand } from "cocoa-discord-utils/slash/class";
import { AutoBuilder, CocoaOption } from "cocoa-discord-utils/template";

import {
    Awaitable,
    CommandInteraction,
    Client,
    MessageActionRow,
    MessageSelectMenu,
    SelectMenuInteraction,
} from "discord.js";

import chalk from "chalk";
import { v4 as uuid } from "uuid";
import { videoInfo } from "ytdl-core";

import {
    musicStates,
    Voice,
    IMusic,
    getState,
    VoiceHelper,
    YoutubeHelper,
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
        ctx: CommandInteraction,
        requester: string,
        fullmeta: videoInfo,
        overrides?: { title: string; desc: string }
    ) {
        const meta = fullmeta.player_response.videoDetails;
        const metalong = fullmeta.videoDetails;

        const emb = this.style
            .use(ctx)
            .setTitle(overrides?.title ?? "Added to Queue")
            .setDescription(
                `[${meta.title}](${metalong.video_url})${
                    overrides?.desc ? "\n" + overrides.desc : ""
                }`
            )
            .setThumbnail(
                meta.thumbnail.thumbnails[meta.thumbnail.thumbnails.length - 1]!
                    .url
            )
            .addInlineFields(
                {
                    name: "🎙️Author",
                    value: `[${meta.author}](${metalong.author.channel_url})`,
                },
                {
                    name: "🧑Subscribers",
                    value: this.beautifyNumber(
                        metalong.author.subscriber_count
                    ),
                },
                {
                    name: "⌛Duration",
                    value: meta.isLiveContent
                        ? "LIVE"
                        : this.parseLength(+meta.lengthSeconds),
                },
                {
                    name: "🎫Requested By",
                    value: `<@${requester}>`,
                },
                {
                    name: "👁️Watch",
                    value: this.beautifyNumber(meta.viewCount),
                },
                {
                    name: "👍Like",
                    value: this.beautifyNumber(metalong.likes),
                }
            );

        return emb;
    }

    /**
     * @returns `true` if should ends the function,
     * it will followUp the interaction printing error message
     */
    protected async joinHook(ctx: CommandInteraction, force = false) {
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

    @SlashCommand(
        AutoBuilder("Play a song/video from YouTube").addStringOption(
            CocoaOption("song", "Youtube URL or Search Query", true)
        )
    )
    async play(ctx: CommandInteraction) {
        const song = ctx.options.getString("song", true);

        await ctx.deferReply();

        if (await this.joinHook(ctx)) return;

        const fullmeta = await Voice.addMusicToQueue(
            ctx.guildId!,
            song,
            ctx.user.id
        );

        if (typeof fullmeta == "string") {
            await ctx.followUp("Cannot find any video with that name");
            return;
        }

        const emb = this.musicEmbed(ctx, ctx.user.id, fullmeta);

        await ctx.followUp({ embeds: [emb] });
    }

    protected trimLabel(p1: string, p2: string) {
        const lenlim = 96 - p2.length;
        if (p1.length > 96 - p2.length) {
            p1 = p1.slice(0, lenlim - 3) + "...";
        }

        return `${p1} ${p2}`;
    }

    @SlashCommand(AutoBuilder("Pause the song"))
    async pause(ctx: CommandInteraction) {
        if (musicStates[ctx.guildId!]?.audio_player?.pause())
            await ctx.reply("⏸️");
        else await ctx.reply("❓");
    }

    @SlashCommand(AutoBuilder("Resume paused song"))
    async resume(ctx: CommandInteraction) {
        if (musicStates[ctx.guildId!]?.audio_player?.unpause())
            await ctx.reply("▶️");
        else await ctx.reply("❓");
    }

    @SlashCommand(AutoBuilder("Toggle Loop"))
    async loop(ctx: CommandInteraction) {
        const state = getState(ctx.guildId!);
        state.is_looping = !state.is_looping;

        await ctx.reply(state.is_looping ? "🔁" : "🔂");
    }

    @SlashCommand(AutoBuilder("Prints the current song"))
    async now(ctx: CommandInteraction) {
        const state = getState(ctx.guildId!);

        if (!state.is_playing || !state.now_playing) {
            await ctx.reply("Nothing is playing right now!");
            return;
        }

        let progressed = Math.round(
            (new Date().getTime() - state.playing_since) / 1000
        );
        const total =
            +state.now_playing.rawmeta.player_response.videoDetails
                .lengthSeconds;
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
            state.now_playing.rawmeta,
            {
                title: "Now Playing",
                desc: prog,
            }
        );

        await ctx.reply({ embeds: [emb] });
    }

    @SlashCommand(
        AutoBuilder("Remove x-th song from the queue").addIntegerOption(
            CocoaOption("index", "Index of removal", true)
        )
    )
    async remove(ctx: CommandInteraction) {
        const index = ctx.options.getInteger("index", true);

        if (index <= 0) {
            await ctx.reply("❗Invalid Index");
            return;
        }

        const music = Voice.removeFromQueue(ctx.guildId!, index);

        if (music) {
            await ctx.reply(
                `✅ Removed **${music.detail.title} - ${music.detail.author}**`
            );
        } else {
            await ctx.reply("❗There is nothing to remove at that index!");
        }
    }

    @SlashCommand(
        AutoBuilder("Search for Song on YouTube").addStringOption(
            CocoaOption("song", "What to search for", true)
        )
    )
    async search(ctx: CommandInteraction) {
        const song = ctx.options.getString("song", true);

        await ctx.deferReply();

        const songs = await YoutubeHelper.searchVideo(song);

        let text = "";
        const ss = songs.slice(0, 10);

        for (let i = 0; i < ss.length; i++) {
            text += `**${i + 1})** ${ss[i]!.title} [${ss[i]!.duration_raw}]\n`;
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

        const menu = new MessageSelectMenu()
            .setCustomId(thisId)
            .setPlaceholder("Select your Song")
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
                ...ss.map((vid) => {
                    return {
                        label: this.trimLabel(
                            vid.title,
                            `[${vid.duration_raw}]`
                        ),
                        description: "",
                        value: vid.link,
                    };
                })
            );

        const row = new MessageActionRow().addComponents(menu);

        this.selectMenuHandler = async (interaction) => {
            if (interaction.customId != thisId) {
                // * Old Interaction
                if (this.garbage.has(interaction.customId))
                    this.yeetSelectMenu(interaction);
                return;
            }

            await interaction.deferUpdate();

            if (await this.joinHook(ctx)) return;
            const prom = Voice.addMusicToQueue(
                ctx.guildId!,
                interaction.values[0]!,
                ctx.user.id
            );

            let newtext = "";
            for (let i = 0; i < ss.length; i++) {
                if (ss[i]!.link == interaction.values[0]) {
                    newtext += `**${i + 1}) ${ss[i]!.title} [${
                        ss[i]!.duration_raw
                    }]**\n`;
                } else {
                    newtext += `~~**${i + 1})** ${ss[i]!.title} [${
                        ss[i]!.duration_raw
                    }]~~\n`;
                }
            }

            this.selectMenuHandler = undefined;

            await interaction.followUp({
                embeds: [
                    emb.setDescription(newtext),
                    this.musicEmbed(
                        ctx,
                        ctx.user.id,
                        (await prom) as videoInfo
                    ),
                ],
                components: [],
            });

            this.garbage.add(thisId);
        };

        await ctx.followUp({ embeds: [emb], components: [row] });
    }

    protected musicToString(music: IMusic) {
        return `[${music.detail.title} - ${music.detail.author}](${music.url})`.replaceAll(
            "*",
            "\\*"
        );
    }

    @SlashCommand(AutoBuilder("Prints out the current Queue"))
    async queue(ctx: CommandInteraction) {
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

    @SlashCommand(AutoBuilder("Skip the current song"))
    async skip(ctx: CommandInteraction) {
        Voice.skipMusic(ctx.guildId!);

        await ctx.reply("⏩");
    }

    @SlashCommand(
        AutoBuilder(
            "Clear all songs in the queue, stop playing and leave the channel"
        )
    )
    async clear(ctx: CommandInteraction) {
        Voice.clearMusicQueue(ctx.guildId!);

        await ctx.reply("Cleared!");
    }

    @SlashCommand(AutoBuilder("(Force) moves the bot to your voice channel"))
    async rejoin(ctx: CommandInteraction) {
        if (await this.joinHook(ctx, true)) return;

        await ctx.reply("✅ Rejoined");
    }
}

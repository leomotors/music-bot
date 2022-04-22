import { EmbedStyle } from "cocoa-discord-utils";
import { CogSlashClass, SlashCommand } from "cocoa-discord-utils/slash/class";
import { AutoBuilder, CocoaOption } from "cocoa-discord-utils/template";

import {
    ActionRowBuilder,
    Awaitable,
    ChatInputCommandInteraction,
    Client,
    SelectMenuBuilder,
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
    private selectMenuHandler?: (i: SelectMenuInteraction) => Awaitable<void>;
    private garbage = new Set<string>();

    /**
     * Try to remove components from that select menu and add a message,
     * catch error and prints if failed
     */
    private async yeetSelectMenu(interaction: SelectMenuInteraction) {
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

    private parseLength(seconds: number) {
        const minutes = Math.floor(seconds / 60);

        seconds %= 60;

        return `${minutes}:${seconds >= 10 ? `${seconds}` : `0${seconds}`}`;
    }

    /** Only works for positive number */
    private beautifyNumber(
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

    private musicEmbed(ctx: ChatInputCommandInteraction, fullmeta: videoInfo) {
        const meta = fullmeta.player_response.videoDetails;
        const metalong = fullmeta.videoDetails;

        const emb = this.style
            .use(ctx)
            .setTitle("Added to Queue")
            .setDescription(`[${meta.title}](${metalong.video_url})`)
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
                    value: `<@${ctx.user.id}>`,
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

    @SlashCommand(
        AutoBuilder("Play a song/video from YouTube").addStringOption(
            CocoaOption("song", "Youtube URL or Search Query", true)
        )
    )
    async play(ctx: ChatInputCommandInteraction) {
        const song = ctx.options.getString("song", true);

        await ctx.deferReply();

        await Voice.joinFromContext(ctx);

        const fullmeta = await Voice.addMusicToQueue(ctx.guildId!, song);

        if (typeof fullmeta == "string") {
            await ctx.followUp("Cannot find any video with that name");
            return;
        }

        const emb = this.musicEmbed(ctx, fullmeta);

        await ctx.followUp({ embeds: [emb] });
    }

    private trimLabel(p1: string, p2: string) {
        const lenlim = 96 - p2.length;
        if (p1.length > 96 - p2.length) {
            p1 = p1.slice(0, lenlim - 3) + "...";
        }

        return `${p1} ${p2}`;
    }

    @SlashCommand(AutoBuilder("Pause the song"))
    async pause(ctx: ChatInputCommandInteraction) {
        musicStates[ctx.guildId!]?.audio_player?.pause();
        await ctx.reply("⏸️");
    }

    @SlashCommand(AutoBuilder("Resume paused song"))
    async resume(ctx: ChatInputCommandInteraction) {
        musicStates[ctx.guildId!]?.audio_player?.unpause();
        await ctx.reply("▶️");
    }

    @SlashCommand(AutoBuilder("Toggle Loop"))
    async loop(ctx: ChatInputCommandInteraction) {
        const state = getState(ctx.guildId!);
        state.is_looping = !state.is_looping;

        await ctx.reply(state.is_looping ? "🔁" : "🔂");
    }

    @SlashCommand(
        AutoBuilder("Remove x-th song from the queue").addIntegerOption(
            CocoaOption("index", "Index of removal", true)
        )
    )
    async remove(ctx: ChatInputCommandInteraction) {
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
    async search(ctx: ChatInputCommandInteraction) {
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

        const menu = new SelectMenuBuilder()
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

        // @ts-expect-error
        const row = new ActionRowBuilder().addComponents([menu]);

        this.selectMenuHandler = async (interaction) => {
            if (interaction.customId != thisId) {
                // * Old Interaction
                if (this.garbage.has(interaction.customId))
                    this.yeetSelectMenu(interaction);
                return;
            }

            await interaction.deferUpdate();

            await Voice.joinFromContext(ctx);
            const prom = Voice.addMusicToQueue(
                ctx.guildId!,
                interaction.values[0]!
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
                    this.musicEmbed(ctx, (await prom) as videoInfo),
                ],
                components: [],
            });

            this.garbage.add(thisId);
        };

        console.log("CAN CONSTRUCT");

        // @ts-expect-error
        await ctx.followUp({ embeds: [emb], components: [row] });
    }

    private musicToString(music: IMusic) {
        return `[${music.detail.title} - ${music.detail.author}](${music.url})`.replaceAll(
            "*",
            "\\*"
        );
    }

    @SlashCommand(AutoBuilder("Prints out the current Queue"))
    async queue(ctx: ChatInputCommandInteraction) {
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
    async skip(ctx: ChatInputCommandInteraction) {
        Voice.skipMusic(ctx.guildId!);

        await ctx.reply("⏩");
    }

    @SlashCommand(AutoBuilder("Clear all songs in the queue and stop playing"))
    async clear(ctx: ChatInputCommandInteraction) {
        Voice.clearMusicQueue(ctx.guildId!);

        await ctx.reply("Cleared!");
    }
}

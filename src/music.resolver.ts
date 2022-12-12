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
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";

import chalk from "chalk";
import { search, YouTubeVideo } from "play-dl";

import { generateId, SearchEmbedIdPrefix } from "./constants.js";
import { MusicService } from "./music.service.js";
import { musicStates, Voice, getState, VoiceHelper } from "./voice.js";

export class Music extends CogSlashClass {
  protected selectMenuHandler?: (
    i: StringSelectMenuInteraction
  ) => Awaitable<void>;

  constructor(
    private client: Client,
    private style: EmbedStyle,
    description?: string
  ) {
    super("Music", description ?? "Cog for playing musics from YouTube");

    client.on("interactionCreate", async (interaction) => {
      if (interaction.isStringSelectMenu() && this.selectMenuHandler) {
        try {
          await this.selectMenuHandler(interaction);
        } catch (err) {
          console.log(chalk.red(`Error while handling Select Menu: ${err}`));
          await interaction.channel?.send(`${err}`).catch(console.error);
        }
      }
    });
  }

  @SlashCommand("Play a song/video from YouTube")
  async play(
    ctx: SlashCommand.Context,
    @Param.String("Youtube URL or Search Query") song: Param.String.Type
  ) {
    await ctx.deferReply();

    if (await MusicService.joinHook(ctx)) return;

    const video = await Voice.addMusicToQueue(ctx.guildId!, song, ctx.user.id);

    if (typeof video === "string") {
      await ctx.followUp("Cannot find any video with that name");
      return;
    }

    const emb = MusicService.musicEmbed(ctx, ctx.user.id, video, this.style);

    await ctx.followUp({ embeds: [emb.toJSON()] });
  }

  @SlashCommand("Pause the song")
  async pause(ctx: SlashCommand.Context) {
    if (musicStates[ctx.guildId!]?.audio_player?.pause()) await ctx.reply("⏸️");
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
    )}|**\n**${MusicService.parseLength(
      progressed
    )} / ${MusicService.parseLength(total)}**`;

    const emb = MusicService.musicEmbed(
      ctx,
      state.now_playing.requested_by,
      state.now_playing.video,
      this.style,
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

    const thisId = generateId(SearchEmbedIdPrefix);

    const menu = new StringSelectMenuBuilder()
      .setCustomId(thisId)
      .setPlaceholder("Select your Song")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        ss.map((vid) => ({
          label: MusicService.trimLabel(
            vid.title ?? "",
            `[${vid.durationRaw}]`
          ),
          value: vid.url,
        }))
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents([
      menu,
    ]);

    this.selectMenuHandler = async (interaction) => {
      if (interaction.customId !== thisId) {
        // * Old Interaction
        if (interaction.customId.startsWith(SearchEmbedIdPrefix))
          MusicService.yeetSelectMenu(interaction);
        return;
      }

      if (await MusicService.joinHook(ctx)) return;
      const prom = Voice.addMusicToQueue(
        ctx.guildId!,
        interaction.values[0]!,
        ctx.user.id
      );

      let newtext = "";
      for (let i = 0; i < ss.length; i++) {
        if (ss[i]!.url === interaction.values[0]) {
          newtext += `**${i + 1}) ${ss[i]!.title} [${ss[i]!.durationRaw}]**\n`;
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
          MusicService.musicEmbed(
            ctx,
            ctx.user.id,
            (await prom) as YouTubeVideo,
            this.style
          ),
        ],
        components: [],
      });
    };

    await ctx.followUp({
      embeds: [emb],
      components: [row],
    });
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
        MusicService.musicToString(state.now_playing) +
        "\n";
    }

    if (q?.length > 0) text += "**Queue**\n";

    for (const [index, m] of Object.entries(q ?? [])) {
      text += `**${+index + 1})** ${MusicService.musicToString(m)}\n`;
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
    if (await MusicService.joinHook(ctx, true)) return;

    await ctx.reply("✅ Rejoined");
  }
}

import { EmbedStyle } from "cocoa-discord-utils";
import { SlashCommand } from "cocoa-discord-utils/slash/class";

import { SelectMenuInteraction } from "discord.js";

import chalk from "chalk";
import { YouTubeVideo } from "play-dl";

import { IMusic, Utilities, Voice } from "./voice";

export namespace MusicService {
  /**
   * Try to remove components from that select menu and add a message,
   * catch error and prints if failed
   */
  export async function yeetSelectMenu(interaction: SelectMenuInteraction) {
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

  export function parseLength(seconds: number) {
    const minutes = Math.floor(seconds / 60);

    seconds %= 60;

    return `${minutes}:${seconds >= 10 ? `${seconds}` : `0${seconds}`}`;
  }

  /** Only works for positive number */
  export function beautifyNumber(
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

  export function musicEmbed(
    ctx: SlashCommand.Context,
    requester: string,
    video: YouTubeVideo,
    style: EmbedStyle,
    overrides?: { title: string; desc: string }
  ) {
    const emb = style
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
          value: `[${video.channel?.name ?? "Unknown"}](${video.channel?.url})`,
        },
        {
          name: "🧑Subscribers",
          value: beautifyNumber(video.channel?.subscribers),
        },
        {
          name: "⌛Duration",
          value:
            video.durationInSec == 0
              ? "LIVE"
              : parseLength(video.durationInSec),
        },
        {
          name: "🎫Requested By",
          value: `<@${requester}>`,
        },
        {
          name: "👁️Watch",
          value: beautifyNumber(video.views),
        },
        {
          name: "👍Like",
          value: beautifyNumber(video.likes),
        }
      );

    return emb;
  }

  /**
   * @returns `true` if should ends the function,
   * it will followUp the interaction printing error message
   */
  export async function joinHook(ctx: SlashCommand.Context, force = false) {
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

  export function trimLabel(p1: string, p2: string) {
    const lenlim = 96 - p2.length;
    if (p1.length > 96 - p2.length) {
      p1 = p1.slice(0, lenlim - 3) + "...";
    }

    return `${p1} ${p2}`;
  }

  export function musicToString(music: IMusic) {
    return `[${music.video.title} - ${music.video.channel?.name}](${music.video.url})`.replaceAll(
      "*",
      "\\*"
    );
  }
}

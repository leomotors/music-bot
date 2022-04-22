// @ts-check
import "dotenv/config";

import { checkLogin, ConsoleManager, EmbedStyle } from "cocoa-discord-utils";
import { SlashCenter } from "cocoa-discord-utils/slash";
import { DJCocoaOptions } from "cocoa-discord-utils/template";

import { Client } from "discord.js";

import { Music } from "../dist";

// * A simple discord bot to test this cog module

const client = new Client(DJCocoaOptions);
const style = new EmbedStyle({
    author: "invoker",
    color: 0xd7f6fc,
    footer: { text: "@leomotors/music-bot test mode" },
});

const center = new SlashCenter(client, process.env.GUILD_IDS?.split(","));
center.addCog(new Music(client, style));
center.useHelpCommand(style);

client.on("ready", (cli) => {
    console.log(`Logged in as ${cli.user.tag}`);
    center.syncCommands();
});

new ConsoleManager().useLogout(client);
checkLogin(client, process.env.DISCORD_TOKEN);

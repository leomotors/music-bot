// @ts-check

/** @type {import("@trivago/prettier-plugin-sort-imports").PrettierConfig} */
const config = {
  bracketSpacing: true,
  tabWidth: 2,
  useTabs: false,
  singleQuote: false,
  semi: true,
  printWidth: 80,
  importOrder: [
    "^dotenv",
    "^cocoa-discord-utils",
    "^discord.js",
    "^@discordjs",
    "^[a-zA-Z]",
    "^[.][.]",
    "^[.]",
  ],
  importOrderCaseInsensitive: true,
  importOrderSeparation: true,
  importOrderParserPlugins: ["typescript", "decorators-legacy"],
  plugins: ["@trivago/prettier-plugin-sort-imports"],
};

module.exports = config;
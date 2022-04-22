# @leomotors/music-bot

[![](https://img.shields.io/npm/v/@leomotors/music-bot.svg?maxAge=3600)](https://www.npmjs.com/package/@leomotors/music-bot)
[![](https://img.shields.io/npm/dt/@leomotors/music-bot.svg?maxAge=3600)](https://www.npmjs.com/package/@leomotors/music-bot)
[![](https://github.com/Leomotors/music-bot/actions/workflows/test.yml/badge.svg)](https://github.com/Leomotors/music-bot/actions)

Music Bot components extracted from [harunon.js](https://github.com/CarelessDev/harunon.js)

## How to use

This package has 2 parts, the underlying mechanics and the part that consume it.

This package exports Music Cog which is compatible to [cocoa-discord-utils](https://github.com/Leomotors/cocoa-discord-utils)

You can import, create and add to center normally.

*See Example at tests/index.js*

## Prerequisites

- node 16 (Minimum required by discord.js, What my bots are optimized for)

- **IMPORTANT** [Encoding Libraries](https://www.npmjs.com/package/@discordjs/voice#dependencies)
(This library does not ship these encoding libraries, so you can freely decide which one to install)

## ✨Features

- play from YouTube

- queue

- pause / resume

- Loop

- Remove from Queue and Clear

- Search with beautiful embeds

## Note

- This module has its cog named "Music", be sure to not creating a duplicate name

# Killua BOT — Hosting bundle

This folder contains the Node.js runtime files only. The original Python files remain in the project root as a backup.

## Deploy

- Runtime: Node.js 20 or newer.
- Install dependencies: `npm ci` (or `npm install` if no lockfile is present).
- Start command: `npm start`.
- Install FFmpeg on the host for voice playback.
- Copy `.env.example` to `.env` locally or enter its variables in your hosting provider's environment settings. Set `TOKEN` to the Discord bot token. Never upload a real `.env` file.
- Enable Server Members, Message Content, and Voice States intents in the Discord Developer Portal.

Keep the JSON data files in the app's working directory. If the hosting provider uses an ephemeral filesystem, attach persistent storage for these files or their changes will be lost when the service restarts. `KEEP_ALIVE` and `PORT` can be configured by the host.

`VV2.gif` is included with the original assets; the current Node.js runtime does not reference it. `ZA.png` is used as the welcome image background.

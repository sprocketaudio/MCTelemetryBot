# MCTelementryBot

A Discord bot for monitoring Minecraft servers via MCTelemetry endpoints and Pterodactyl health data. It provides a `/mcstatus` slash command with a refresh button plus an auto-refreshing dashboard you can pin to a channel.

## Features
- `/mcstatus` shows a compact embed of configured servers.
- `/mcdashboard` sets up an auto-refreshing dashboard message in a chosen channel.
- Refresh button updates the same message without spamming channels.
- Telemetry and Pterodactyl responses cached for 10 seconds to reduce load.
- Administrator (or configured role) required to run the command or refresh.

## Prerequisites
- Node.js 20+
- npm
- A Discord application and bot token

## Setup
1. Create a Discord application and bot in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Enable the **applications.commands** scope and invite the bot to your development server with the **bot** scope (no privileged intents needed).
3. Clone this repository and install dependencies:
   ```bash
   npm install
   ```
4. Create a `servers.json` file in the project root (or `./config/servers.json`) with telemetry and Pterodactyl identifiers:
   ```json
   [
     {
       "id": "aof",
       "name": "Age Of Fate",
       "telemetryUrl": "http://188.40.107.48:28765/telemetry",
       "pteroIdentifier": "17cb1533",
       "pteroName": "AOF Node"
     },
     {
       "id": "atm10",
       "name": "ATM10",
       "telemetryUrl": "http://188.40.107.48:28766/telemetry",
       "pteroIdentifier": "55aabb22"
     }
   ]
   ```
5. Set environment variables (use a `.env` file for convenience):
   ```bash
   DISCORD_TOKEN=your_bot_token
   DISCORD_CLIENT_ID=your_application_id
   DISCORD_GUILD_ID=your_dev_guild_id
   # Optional: allow a specific role to use /mcstatus
   ADMIN_ROLE_ID=role_id
   PTERO_PANEL_URL=https://panel.example.com
   PTERO_CLIENT_TOKEN=client_api_token
   ```
6. (Optional) Pre-seed `dashboard.json` in the repo root if you already know the dashboard message info:
   ```json
   { "guildId": "123", "channelId": "456", "messageId": "789" }
   ```

## Scripts
- `npm run dev` – Start the bot in watch mode via `tsx`.
- `npm run build` – Compile TypeScript to `dist/`.
- `npm start` – Run the compiled bot.
- `npm run lint` – Lint TypeScript files.
- `npm run format` – Format with Prettier.

## Running the bot (development)
```bash
npm run dev
```
The bot registers guild-scoped commands on startup for faster iteration.

## Build and run (production)
```bash
npm run build
npm start
```

## Notes
- Telemetry and Pterodactyl fetches timeout after 2 seconds; failed servers show placeholders while errors are logged with timestamps.
- Cached data is reused for 10 seconds unless the refresh button is clicked.
- `/mcdashboard` stores the dashboard message reference in `dashboard.json` and updates the same message every 10 seconds.

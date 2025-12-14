# MCTelemetryBot

A Discord bot for monitoring Minecraft servers via MCTelemetry endpoints and Pterodactyl health data. It provides a `/mcstatus` slash command with a refresh button plus an auto-refreshing dashboard you can pin to a channel.

## Features
- `/mcstatus` shows a compact embed of configured servers.
- `/mcdashboard` sets up an auto-refreshing dashboard message in a chosen channel.
- Refresh button updates the same message without spamming channels.
- Telemetry and Pterodactyl responses cached for 10 seconds to reduce load.
- Administrator required to run slash commands; a configured moderator role can use dashboard buttons.
- Optional per-user Pterodactyl tokens ensure panel actions match each user's permissions.

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
       "id": "server_id",
       "name": "Server Name",
       "telemetryUrl": "http://<servername>:<IP>/telemetry",
       "pteroIdentifier": "ptero_id",
       "pteroName": "Ptero Name"
     },
     {
       "id": "server_id",
       "name": "Server Name",
       "telemetryUrl": "http://<servername>:<IP>/telemetry",
       "pteroIdentifier": "ptero_id",
       "pteroName": "Ptero Name"
     }
   ]
   ```
5. Set environment variables (use a `.env` file for convenience):
   ```bash
   DISCORD_TOKEN=your_bot_token
   DISCORD_CLIENT_ID=your_application_id
   DISCORD_GUILD_ID=your_dev_guild_id
   # Optional: allow a specific role to use dashboard buttons
   MOD_ROLE_ID=role_id
   PTERO_PANEL_URL=https://panel.example.com
   PTERO_CLIENT_TOKEN=client_api_token # default/fallback token
   ```
6. (Optional) Provide user-specific Pterodactyl API tokens in `pterodactylTokens.json` in the project root (or
   `./config/pterodactylTokens.json`). Each entry maps a Discord user ID to their own panel token:
   ```json
   [
     { "userId": "123456789012345678", "token": "user_specific_client_token" }
   ]
   ```
   These per-user tokens will be used for dashboard refreshes and control buttons triggered by that user, ensuring
   panel permissions match their account. Interactions without a user-specific token will fall back to `PTERO_CLIENT_TOKEN`.
7. (Optional) Pre-seed `dashboard.json` in the repo root if you already know the dashboard message info:
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

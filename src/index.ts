import 'dotenv/config';
import { Client, GatewayIntentBits, Interaction, REST, Routes } from 'discord.js';
import { mcStatusCommand, executeMcStatus, handleMcStatusRefresh, MCSTATUS_REFRESH_ID } from './commands/mcstatus';
import { loadServers } from './config/servers';
import { logger } from './utils/logger';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const adminRoleId = process.env.ADMIN_ROLE_ID;

if (!token || !clientId || !guildId) {
  throw new Error('DISCORD_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_ID must be set.');
}

const resolvedToken = token!;
const resolvedClientId = clientId!;
const resolvedGuildId = guildId!;

const servers = loadServers();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const rest = new REST({ version: '10' }).setToken(resolvedToken);

async function registerCommands() {
  const commands = [mcStatusCommand.toJSON()];
  logger.info('Registering slash commands');
  await rest.put(Routes.applicationGuildCommands(resolvedClientId, resolvedGuildId), { body: commands });
  logger.info('Commands registered');
}

client.once('ready', () => {
  logger.info(`Logged in as ${client.user?.tag}`);
});

client.on('interactionCreate', async (interaction: Interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === mcStatusCommand.name) {
      await executeMcStatus(interaction, { servers, adminRoleId });
      return;
    }

    if (interaction.isButton() && interaction.customId === MCSTATUS_REFRESH_ID) {
      await handleMcStatusRefresh(interaction, { servers, adminRoleId });
      return;
    }
  } catch (error) {
    logger.error('Interaction handling failed', error);
    if (interaction.isRepliable()) {
      const content = 'Something went wrong while handling that interaction.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content });
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
    }
  }
});

async function start() {
  try {
    await registerCommands();
    await client.login(resolvedToken);
  } catch (error) {
    logger.error('Failed to start bot', error);
    process.exit(1);
  }
}

start();

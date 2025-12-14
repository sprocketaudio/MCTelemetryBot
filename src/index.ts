import 'dotenv/config';
import { Client, GatewayIntentBits, Interaction, REST, Routes, TextBasedChannel } from 'discord.js';
import { executeMcDashboard, mcDashboardCommand } from './commands/mcdashboard';
import { executeMcStatus, handleMcStatusView, mcStatusCommand } from './commands/mcstatus';
import { MCSTATUS_VIEW_PLAYERS_ID, MCSTATUS_VIEW_STATUS_ID } from './config/constants';
import { loadServers } from './config/servers';
import { loadDashboardConfig, DashboardConfig } from './services/dashboardStore';
import { buildStatusEmbed, buildViewComponents, fetchServerStatuses, getViewFromMessage } from './services/status';
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
let dashboardConfig: DashboardConfig | null = loadDashboardConfig();
let dashboardInterval: NodeJS.Timeout | null = null;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const rest = new REST({ version: '10' }).setToken(resolvedToken);

async function registerCommands() {
  const commands = [mcStatusCommand.toJSON(), mcDashboardCommand.toJSON()];
  logger.info('Registering slash commands');
  await rest.put(Routes.applicationGuildCommands(resolvedClientId, resolvedGuildId), { body: commands });
  logger.info('Commands registered');
}

async function refreshDashboard(options: { forceRefresh?: boolean } = {}) {
  if (!dashboardConfig) return;

  try {
    const channel = await client.channels.fetch(dashboardConfig.channelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error('Configured dashboard channel is unavailable');
    }

    const textChannel = channel as TextBasedChannel;
    const message = await textChannel.messages.fetch(dashboardConfig.messageId);

    const statuses = await fetchServerStatuses(servers, options);
    const currentView = getViewFromMessage(message);
    const embed = buildStatusEmbed(servers, statuses, new Date(), currentView);

    await message.edit({ embeds: [embed], components: buildViewComponents(currentView) });
  } catch (error) {
    logger.warn('Dashboard refresh failed; disabling auto-refresh until reconfigured.', error);
    if (dashboardInterval) {
      clearInterval(dashboardInterval);
      dashboardInterval = null;
    }
  }
}

function startDashboardLoop() {
  if (!dashboardConfig) return;

  if (dashboardInterval) {
    clearInterval(dashboardInterval);
  }

  dashboardInterval = setInterval(() => {
    refreshDashboard().catch((error) => logger.warn('Dashboard refresh tick failed', error));
  }, 10_000);

  refreshDashboard().catch((error) => logger.warn('Initial dashboard refresh failed', error));
}

client.once('ready', () => {
  logger.info(`Logged in as ${client.user?.tag}`);

  if (dashboardConfig) {
    startDashboardLoop();
  }
});

client.on('interactionCreate', async (interaction: Interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === mcStatusCommand.name) {
      await executeMcStatus(interaction, { servers, adminRoleId });
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === mcDashboardCommand.name) {
      await executeMcDashboard(interaction, {
        servers,
        adminRoleId,
        onConfigured: (config) => {
          dashboardConfig = config;
          startDashboardLoop();
        },
      });
      return;
    }

    if (interaction.isButton() && interaction.customId === MCSTATUS_VIEW_STATUS_ID) {
      await handleMcStatusView(interaction, { servers, adminRoleId }, 'status');
      return;
    }

    if (interaction.isButton() && interaction.customId === MCSTATUS_VIEW_PLAYERS_ID) {
      await handleMcStatusView(interaction, { servers, adminRoleId }, 'players');
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

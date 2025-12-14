import 'dotenv/config';
import { Client, GatewayIntentBits, Interaction, REST, Routes, TextBasedChannel } from 'discord.js';
import { executeMcDashboard, mcDashboardCommand } from './commands/mcdashboard';
import {
  executeMcStatus,
  handleMcStatusAction,
  handleMcStatusActionConfirm,
  handleMcStatusSelect,
  handleMcStatusView,
  mcStatusCommand,
  parseActionButton,
  parseActionConfirmation,
} from './commands/mcstatus';
import {
  MCSTATUS_ACTION_CUSTOM_ID_PREFIX,
  MCSTATUS_CONFIRM_CUSTOM_ID_PREFIX,
  MCSTATUS_SELECT_CUSTOM_ID,
  MCSTATUS_VIEW_CUSTOM_ID_PREFIX,
} from './config/constants';
import { loadServers } from './config/servers';
import { loadDashboardConfig, DashboardConfig } from './services/dashboardStore';
import {
  DashboardState,
  buildDefaultState,
  buildStatusEmbeds,
  buildViewComponents,
  fetchServerStatuses,
  getDashboardStateFromMessage,
  parseViewButton,
} from './services/status';
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
const messageStates = new Map<string, DashboardState>();

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
  const currentState = messageStates.get(message.id) ?? getDashboardStateFromMessage(message, servers);
  if (!servers.some((server) => server.id === currentState.selectedServerId)) {
    currentState.selectedServerId = null;
  }
    messageStates.set(message.id, currentState);
    const embeds = buildStatusEmbeds(
      servers,
      statuses,
      new Date(),
      currentState.serverViews,
      currentState.selectedServerId
    );

    await message.edit({
      embeds,
      components: buildViewComponents(servers, currentState.selectedServerId, currentState.serverViews),
    });
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
      await executeMcStatus(interaction, {
        servers,
        adminRoleId,
        onStateChange: (state, messageId) => {
          if (messageId) {
            messageStates.set(messageId, state);
          }
        },
        getState: (messageId) => messageStates.get(messageId) ?? null,
      });
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === mcDashboardCommand.name) {
      await executeMcDashboard(interaction, {
        servers,
        adminRoleId,
        onConfigured: (config) => {
          dashboardConfig = config;
          messageStates.set(config.messageId, buildDefaultState());
          startDashboardLoop();
        },
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(MCSTATUS_VIEW_CUSTOM_ID_PREFIX)) {
      const parsedView = parseViewButton(interaction.customId);
      if (!parsedView) return;
      await handleMcStatusView(interaction, {
        servers,
        adminRoleId,
        onStateChange: (state, messageId) => {
          if (messageId) {
            messageStates.set(messageId, state);
          }
        },
        getState: (messageId) => messageStates.get(messageId) ?? null,
      }, parsedView);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === MCSTATUS_SELECT_CUSTOM_ID) {
      await handleMcStatusSelect(interaction, {
        servers,
        adminRoleId,
        onStateChange: (state, messageId) => {
          if (messageId) {
            messageStates.set(messageId, state);
          }
        },
        getState: (messageId) => messageStates.get(messageId) ?? null,
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(MCSTATUS_ACTION_CUSTOM_ID_PREFIX)) {
      const parsedAction = parseActionButton(interaction.customId);
      if (!parsedAction) return;
      await handleMcStatusAction(interaction, {
        servers,
        adminRoleId,
        getState: (messageId) => messageStates.get(messageId) ?? null,
      }, parsedAction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(MCSTATUS_CONFIRM_CUSTOM_ID_PREFIX)) {
      const parsedConfirmation = parseActionConfirmation(interaction.customId);
      if (!parsedConfirmation) return;
      await handleMcStatusActionConfirm(interaction, {
        servers,
        adminRoleId,
        getState: (messageId) => messageStates.get(messageId) ?? null,
      }, parsedConfirmation);
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

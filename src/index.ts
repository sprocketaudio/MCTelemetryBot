import 'dotenv/config';
import { Client, GatewayIntentBits, Interaction, REST, Routes, TextBasedChannel, User } from 'discord.js';
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
import { executeMcAudit, mcAuditCommand } from './commands/mcaudit';
import {
  MCSTATUS_ACTION_CUSTOM_ID_PREFIX,
  MCSTATUS_CONFIRM_CUSTOM_ID_PREFIX,
  MCSTATUS_SELECT_CUSTOM_ID,
  MCSTATUS_VIEW_CUSTOM_ID_PREFIX,
} from './config/constants';
import { loadServers } from './config/servers';
import { loadDashboardConfig, DashboardConfig } from './services/dashboardStore';
import { AuditConfig, loadAuditConfig } from './services/auditStore';
import { loadPterodactylUserTokens } from './config/pterodactylUsers';
import {
  DashboardState,
  buildDefaultState,
  buildStatusEmbeds,
  buildViewComponents,
  fetchServerStatuses,
  getDashboardStateFromMessage,
  parseViewButton,
} from './services/status';
import { AuditLogEntry, sendAuditLog } from './services/auditLogger';
import { logger } from './utils/logger';
import { sendTemporaryReply } from './utils/messages';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const modRoleId = process.env.MOD_ROLE_ID;
const defaultPterodactylToken = process.env.PTERO_CLIENT_TOKEN ?? null;

if (!token || !clientId || !guildId) {
  throw new Error('DISCORD_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_ID must be set.');
}

const resolvedToken = token!;
const resolvedClientId = clientId!;
const resolvedGuildId = guildId!;

const servers = loadServers();
let dashboardConfig: DashboardConfig | null = loadDashboardConfig();
let auditConfig: AuditConfig | null = loadAuditConfig();
const pterodactylTokens = loadPterodactylUserTokens();
let dashboardInterval: NodeJS.Timeout | null = null;
const messageStates = new Map<string, DashboardState>();

const resolvePteroToken = (userId?: string | null): string | null => {
  if (userId) {
    const userToken = pterodactylTokens.get(userId);
    if (userToken) return userToken;
  }

  return defaultPterodactylToken;
};

const logAudit = async (entry: AuditLogEntry, user: User) => {
  await sendAuditLog(client, auditConfig, entry, user);
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const rest = new REST({ version: '10' }).setToken(resolvedToken);

async function registerCommands() {
  const commands = [mcStatusCommand.toJSON(), mcDashboardCommand.toJSON(), mcAuditCommand.toJSON()];
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

    const pteroToken = resolvePteroToken(dashboardConfig.configuredByUserId);
    const statuses = await fetchServerStatuses(servers, {
      ...options,
      pterodactylToken: pteroToken,
      tokenOwnerId: dashboardConfig.configuredByUserId,
    });
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
        modRoleId,
        resolvePteroToken,
        onStateChange: (state, messageId) => {
          if (messageId) {
            messageStates.set(messageId, state);
          }
        },
        getState: (messageId) => messageStates.get(messageId) ?? null,
        logAudit: (entry, user) => logAudit(entry, user),
      });
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === mcDashboardCommand.name) {
      await executeMcDashboard(interaction, {
        servers,
        resolvePteroToken,
        onConfigured: (config) => {
          dashboardConfig = config;
          messageStates.set(config.messageId, buildDefaultState());
          startDashboardLoop();
        },
        logAudit: (entry, user) => logAudit(entry, user),
      });
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === mcAuditCommand.name) {
      await executeMcAudit(interaction, {
        onConfigured: (config) => {
          auditConfig = config;
        },
        logAudit: (entry, user) => logAudit(entry, user),
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(MCSTATUS_VIEW_CUSTOM_ID_PREFIX)) {
      const parsedView = parseViewButton(interaction.customId);
      if (!parsedView) return;
      await handleMcStatusView(interaction, {
        servers,
        modRoleId,
        resolvePteroToken,
        onStateChange: (state, messageId) => {
          if (messageId) {
            messageStates.set(messageId, state);
          }
        },
        getState: (messageId) => messageStates.get(messageId) ?? null,
        logAudit: (entry, user) => logAudit(entry, user),
      }, parsedView);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === MCSTATUS_SELECT_CUSTOM_ID) {
      await handleMcStatusSelect(interaction, {
        servers,
        modRoleId,
        resolvePteroToken,
        onStateChange: (state, messageId) => {
          if (messageId) {
            messageStates.set(messageId, state);
          }
        },
        getState: (messageId) => messageStates.get(messageId) ?? null,
        logAudit: (entry, user) => logAudit(entry, user),
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(MCSTATUS_ACTION_CUSTOM_ID_PREFIX)) {
      const parsedAction = parseActionButton(interaction.customId);
      if (!parsedAction) return;
      await handleMcStatusAction(interaction, {
        servers,
        modRoleId,
        resolvePteroToken,
        getState: (messageId) => messageStates.get(messageId) ?? null,
        logAudit: (entry, user) => logAudit(entry, user),
      }, parsedAction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(MCSTATUS_CONFIRM_CUSTOM_ID_PREFIX)) {
      const parsedConfirmation = parseActionConfirmation(interaction.customId);
      if (!parsedConfirmation) return;
      await handleMcStatusActionConfirm(interaction, {
        servers,
        modRoleId,
        resolvePteroToken,
        getState: (messageId) => messageStates.get(messageId) ?? null,
        logAudit: (entry, user) => logAudit(entry, user),
      }, parsedConfirmation);
      return;
    }
  } catch (error) {
    logger.error('Interaction handling failed', error);
    if (interaction.isRepliable()) {
      const content = 'Something went wrong while handling that interaction.';
      await sendTemporaryReply(interaction, content);
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

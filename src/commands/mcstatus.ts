import {
  ActionRowBuilder,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Message,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  User,
} from 'discord.js';
import { ServerConfig } from '../config/servers';
import {
  DashboardState,
  StatusView,
  buildDefaultState,
  buildStatusEmbeds,
  buildViewComponents,
  fetchServerStatuses,
  getDashboardStateFromMessage,
} from '../services/status';
import { MCSTATUS_ACTION_CUSTOM_ID_PREFIX, MCSTATUS_CONFIRM_CUSTOM_ID_PREFIX } from '../config/constants';
import { buildPanelConsoleUrl, sendPowerSignal } from '../services/pterodactyl';
import { hasModRoleOrAdmin, isAdministrator } from '../utils/permissions';
import { editReplyWithExpiry, sendTemporaryReply } from '../utils/messages';
import { AuditLogEntry, AuditStyle } from '../services/auditLogger';

export interface CommandContext {
  servers: ServerConfig[];
  modRoleId?: string;
  resolvePteroToken?: (userId?: string) => string | null;
  onStateChange?: (state: DashboardState, messageId?: string) => void;
  getState?: (messageId: string) => DashboardState | null;
  logAudit?: (entry: AuditLogEntry, user: User) => Promise<void> | void;
}

export const mcStatusCommand = new SlashCommandBuilder()
  .setName('mcstatus')
  .setDescription('Show the status of configured Minecraft servers')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function executeMcStatus(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  if (!isAdministrator(interaction)) {
    await sendTemporaryReply(interaction, 'You need Administrator permissions to use this command.');
    return;
  }

  await interaction.deferReply();

  const pteroToken = context.resolvePteroToken?.(interaction.user.id);

  const statuses = await fetchServerStatuses(context.servers, {
    pterodactylToken: pteroToken,
    tokenOwnerId: interaction.user.id,
  });
  const state = buildDefaultState();
  const embeds = buildStatusEmbeds(
    context.servers,
    statuses,
    new Date(),
    state.serverViews,
    state.selectedServerId
  );

  const message = await interaction.editReply({
    embeds,
    components: buildViewComponents(context.servers, state.selectedServerId, state.serverViews),
  });

  if (context.onStateChange) {
    context.onStateChange(state, message.id);
  }
}

const resolveState = (interaction: ButtonInteraction | StringSelectMenuInteraction, context: CommandContext) => {
  const messageId = interaction.message.id;
  return context.getState?.(messageId) ?? getDashboardStateFromMessage(interaction.message, context.servers);
};

const resolvePteroTokenOrNotify = async (
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  context: CommandContext
): Promise<string | null> => {
  const token = context.resolvePteroToken?.(interaction.user.id) ?? null;
  if (token) return token;

  await sendTemporaryReply(interaction, 'No Pterodactyl API token is configured for you.');
  return null;
};

export async function handleMcStatusView(
  interaction: ButtonInteraction,
  context: CommandContext,
  view: StatusView
): Promise<void> {
  if (!hasModRoleOrAdmin(interaction, context.modRoleId)) {
    await sendTemporaryReply(interaction, 'You need Moderator permissions to refresh this status.');
    return;
  }

  await interaction.deferUpdate();

  const currentState = resolveState(interaction, context);
  if (!currentState.selectedServerId) {
    await interaction.editReply({
      components: buildViewComponents(context.servers, currentState.selectedServerId, currentState.serverViews),
    });
    await sendTemporaryReply(interaction, 'Select a server first.');
    return;
  }

  currentState.serverViews[currentState.selectedServerId] = view;

  if (context.onStateChange) {
    context.onStateChange(currentState, interaction.message.id);
  }

  const pteroToken = context.resolvePteroToken?.(interaction.user.id);

  const statuses = await fetchServerStatuses(context.servers, {
    forceRefresh: true,
    pterodactylToken: pteroToken,
    tokenOwnerId: interaction.user.id,
  });
  const embeds = buildStatusEmbeds(
    context.servers,
    statuses,
    new Date(),
    currentState.serverViews,
    currentState.selectedServerId
  );

  await interaction.editReply({
    embeds,
    components: buildViewComponents(context.servers, currentState.selectedServerId, currentState.serverViews),
  });
}

export async function handleMcStatusSelect(
  interaction: StringSelectMenuInteraction,
  context: CommandContext
): Promise<void> {
  if (!hasModRoleOrAdmin(interaction, context.modRoleId)) {
    await sendTemporaryReply(interaction, 'You need Moderator permissions to refresh this status.');
    return;
  }

  await interaction.deferUpdate();

  const selectedId = interaction.values?.[0];
  const selectedServer = context.servers.find((server) => server.id === selectedId) ?? null;
  const currentState = resolveState(interaction, context);
  currentState.selectedServerId = selectedServer ? selectedServer.id : null;
  if (currentState.selectedServerId && !currentState.serverViews[currentState.selectedServerId]) {
    currentState.serverViews[currentState.selectedServerId] = 'status';
  }

  if (context.onStateChange) {
    context.onStateChange(currentState, interaction.message.id);
  }

  const pteroToken = context.resolvePteroToken?.(interaction.user.id);

  const statuses = await fetchServerStatuses(context.servers, {
    forceRefresh: true,
    pterodactylToken: pteroToken,
    tokenOwnerId: interaction.user.id,
  });
  const embeds = buildStatusEmbeds(
    context.servers,
    statuses,
    new Date(),
    currentState.serverViews,
    currentState.selectedServerId
  );

  await interaction.editReply({
    embeds,
    components: buildViewComponents(context.servers, currentState.selectedServerId, currentState.serverViews),
  });
}

export type StatusAction = 'console' | 'restart' | 'stop' | 'start' | 'kill';

const ACTION_AUDIT_DETAILS: Record<StatusAction, { emoji: string; style: AuditStyle; label: string }> = {
  console: { emoji: '🖥️', style: 'secondary', label: 'Opened console for' },
  restart: { emoji: '🔁', style: 'danger', label: 'Restart requested for' },
  stop: { emoji: '🛑', style: 'danger', label: 'Stop requested for' },
  kill: { emoji: '💀', style: 'danger', label: 'Kill requested for' },
  start: { emoji: '▶️', style: 'success', label: 'Start requested for' },
};

const buildActionAuditEntry = (action: StatusAction, serverName: string): AuditLogEntry => {
  const details = ACTION_AUDIT_DETAILS[action];
  return { action: `${details.label} **${serverName}**.`, emoji: details.emoji, style: details.style };
};

export const parseActionButton = (customId: string): StatusAction | null => {
  const match = customId.match(
    new RegExp(`^${MCSTATUS_ACTION_CUSTOM_ID_PREFIX}:(console|restart|stop|start|kill)$`)
  );
  if (!match) return null;
  return match[1] as StatusAction;
};

interface ActionConfirmation {
  action: Extract<StatusAction, 'restart' | 'stop' | 'kill'>;
  messageId: string;
  serverId: string;
}

export const parseActionConfirmation = (customId: string): ActionConfirmation | null => {
  const match = customId.match(
    new RegExp(`^${MCSTATUS_CONFIRM_CUSTOM_ID_PREFIX}:(restart|stop|kill):([^:]+):([^:]+)$`)
  );
  if (!match) return null;

  const [, action, messageId, serverId] = match;
  return { action: action as ActionConfirmation['action'], messageId, serverId };
};

const buildConfirmationModal = (
  action: Extract<StatusAction, 'restart' | 'stop' | 'kill'>,
  messageId: string,
  serverId: string,
  serverName: string
) => {
  const title = action === 'restart' ? 'Restart server' : action === 'stop' ? 'Stop server' : 'Kill server';
  const prompt = action === 'restart' ? 'Restart' : action === 'stop' ? 'Stop' : 'Kill';

  return new ModalBuilder()
    .setCustomId(`${MCSTATUS_CONFIRM_CUSTOM_ID_PREFIX}:${action}:${messageId}:${serverId}`)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('confirm_action')
          .setLabel(`Type ${prompt} to confirm ${serverName}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder(prompt)
      )
    );
};

const refreshDashboardMessage = async (
  message: Message,
  state: DashboardState,
  context: CommandContext,
  options: { pteroToken?: string | null; tokenOwnerId?: string } = {}
) => {
  const statuses = await fetchServerStatuses(context.servers, {
    forceRefresh: true,
    pterodactylToken: options.pteroToken ?? undefined,
    tokenOwnerId: options.tokenOwnerId,
  });
  const embeds = buildStatusEmbeds(
    context.servers,
    statuses,
    new Date(),
    state.serverViews,
    state.selectedServerId
  );

  await message.edit({
    embeds,
    components: buildViewComponents(context.servers, state.selectedServerId, state.serverViews),
  });
};

export async function handleMcStatusAction(
  interaction: ButtonInteraction,
  context: CommandContext,
  action: StatusAction
): Promise<void> {
  if (!hasModRoleOrAdmin(interaction, context.modRoleId)) {
    await sendTemporaryReply(interaction, 'You need Moderator permissions to perform this action.');
    return;
  }

  const currentState = resolveState(interaction, context);
  if (!currentState.selectedServerId) {
    await sendTemporaryReply(interaction, 'Select a server first.');
    return;
  }

  const targetServer = context.servers.find((server) => server.id === currentState.selectedServerId);
  if (!targetServer) {
    await sendTemporaryReply(interaction, 'Selected server is no longer available.');
    return;
  }

  if (action === 'console') {
    const consoleUrl = buildPanelConsoleUrl(targetServer);
    await sendTemporaryReply(interaction, `Open console for **${targetServer.name}**: ${consoleUrl}`);
    context.logAudit?.(buildActionAuditEntry('console', targetServer.name), interaction.user);
    return;
  }

  const pteroToken = await resolvePteroTokenOrNotify(interaction, context);
  if (!pteroToken) {
    return;
  }

  if (action === 'restart' || action === 'stop') {
    const modal = buildConfirmationModal(action, interaction.message.id, targetServer.id, targetServer.name);
    await interaction.showModal(modal);
    return;
  }

  if (action === 'kill') {
    const modal = buildConfirmationModal(action, interaction.message.id, targetServer.id, targetServer.name);
    await interaction.showModal(modal);
    return;
  }

  if (action === 'start') {
    await interaction.deferReply();
    try {
      await sendPowerSignal(targetServer, 'start', { token: pteroToken, tokenOwnerId: interaction.user.id });
      await editReplyWithExpiry(interaction, `Sent start command to **${targetServer.name}**.`);
      context.logAudit?.(buildActionAuditEntry('start', targetServer.name), interaction.user);
    } catch (error) {
      await editReplyWithExpiry(
        interaction,
        `Failed to start **${targetServer.name}**: ${(error as Error).message}`
      );
      return;
    }

    await refreshDashboardMessage(interaction.message, currentState, context, {
      pteroToken,
      tokenOwnerId: interaction.user.id,
    });
    return;
  }
}

export async function handleMcStatusActionConfirm(
  interaction: ModalSubmitInteraction,
  context: CommandContext,
  parsed: ActionConfirmation
): Promise<void> {
  if (!hasModRoleOrAdmin(interaction, context.modRoleId)) {
    await sendTemporaryReply(interaction, 'You need Moderator permissions to perform this action.');
    return;
  }

  const confirmation = interaction.fields.getTextInputValue('confirm_action')?.trim();
  if (!confirmation || confirmation.toLowerCase() !== parsed.action.toLowerCase()) {
    await sendTemporaryReply(interaction, `Confirmation failed. Type "${parsed.action}" to proceed.`);
    return;
  }

  const targetServer = context.servers.find((server) => server.id === parsed.serverId);
  if (!targetServer) {
    await sendTemporaryReply(interaction, 'Selected server is no longer available.');
    return;
  }

  await interaction.deferReply();
  const pteroToken = await resolvePteroTokenOrNotify(interaction, context);
  if (!pteroToken) {
    return;
  }
  try {
    await sendPowerSignal(targetServer, parsed.action, {
      token: pteroToken,
      tokenOwnerId: interaction.user.id,
    });
    await editReplyWithExpiry(interaction, `Sent ${parsed.action} command to **${targetServer.name}**.`);
    context.logAudit?.(buildActionAuditEntry(parsed.action, targetServer.name), interaction.user);
  } catch (error) {
    await editReplyWithExpiry(
      interaction,
      `Failed to ${parsed.action} **${targetServer.name}**: ${(error as Error).message}`
    );
    return;
  }

  const state = context.getState?.(parsed.messageId) ?? buildDefaultState();
  if (!state.selectedServerId) {
    state.selectedServerId = parsed.serverId;
    state.serverViews[parsed.serverId] = state.serverViews[parsed.serverId] ?? 'status';
  }

  if (interaction.channel && interaction.channel.isTextBased()) {
    const message = await interaction.channel.messages.fetch(parsed.messageId).catch(() => null);
    if (message) {
      await refreshDashboardMessage(message, state, context, {
        pteroToken,
        tokenOwnerId: interaction.user.id,
      });
    }
  }
}

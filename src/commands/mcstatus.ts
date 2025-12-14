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
import { isAdmin } from '../utils/permissions';

export interface CommandContext {
  servers: ServerConfig[];
  adminRoleId?: string;
  onStateChange?: (state: DashboardState, messageId?: string) => void;
  getState?: (messageId: string) => DashboardState | null;
}

export const mcStatusCommand = new SlashCommandBuilder()
  .setName('mcstatus')
  .setDescription('Show the status of configured Minecraft servers')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function executeMcStatus(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  if (!isAdmin(interaction, context.adminRoleId)) {
    await interaction.reply({
      content: 'You need Administrator permissions to use this command.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const statuses = await fetchServerStatuses(context.servers);
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

export async function handleMcStatusView(
  interaction: ButtonInteraction,
  context: CommandContext,
  view: StatusView
): Promise<void> {
  if (!isAdmin(interaction, context.adminRoleId)) {
    await interaction.reply({
      content: 'You need Administrator permissions to refresh this status.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  const currentState = resolveState(interaction, context);
  if (!currentState.selectedServerId) {
    await interaction.editReply({
      components: buildViewComponents(context.servers, currentState.selectedServerId, currentState.serverViews),
    });
    await interaction.followUp({ content: 'Select a server first.', ephemeral: true });
    return;
  }

  currentState.serverViews[currentState.selectedServerId] = view;

  if (context.onStateChange) {
    context.onStateChange(currentState, interaction.message.id);
  }

  const statuses = await fetchServerStatuses(context.servers, { forceRefresh: true });
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
  if (!isAdmin(interaction, context.adminRoleId)) {
    await interaction.reply({
      content: 'You need Administrator permissions to refresh this status.',
      ephemeral: true,
    });
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

  const statuses = await fetchServerStatuses(context.servers, { forceRefresh: true });
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
  context: CommandContext
) => {
  const statuses = await fetchServerStatuses(context.servers, { forceRefresh: true });
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
  if (!isAdmin(interaction, context.adminRoleId)) {
    await interaction.reply({
      content: 'You need Administrator permissions to perform this action.',
      ephemeral: true,
    });
    return;
  }

  const currentState = resolveState(interaction, context);
  if (!currentState.selectedServerId) {
    await interaction.reply({ content: 'Select a server first.', ephemeral: true });
    return;
  }

  const targetServer = context.servers.find((server) => server.id === currentState.selectedServerId);
  if (!targetServer) {
    await interaction.reply({ content: 'Selected server is no longer available.', ephemeral: true });
    return;
  }

  if (action === 'console') {
    const consoleUrl = buildPanelConsoleUrl(targetServer);
    await interaction.reply({
      content: `Open console for **${targetServer.name}**: ${consoleUrl}`,
      ephemeral: true,
    });
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
    await interaction.deferReply({ ephemeral: true });
    try {
      await sendPowerSignal(targetServer, 'start');
      await interaction.editReply({ content: `Sent start command to **${targetServer.name}**.` });
    } catch (error) {
      await interaction.editReply({
        content: `Failed to start **${targetServer.name}**: ${(error as Error).message}`,
      });
      return;
    }

    await refreshDashboardMessage(interaction.message, currentState, context);
    return;
  }
}

export async function handleMcStatusActionConfirm(
  interaction: ModalSubmitInteraction,
  context: CommandContext,
  parsed: ActionConfirmation
): Promise<void> {
  if (!isAdmin(interaction, context.adminRoleId)) {
    await interaction.reply({
      content: 'You need Administrator permissions to perform this action.',
      ephemeral: true,
    });
    return;
  }

  const confirmation = interaction.fields.getTextInputValue('confirm_action')?.trim();
  if (!confirmation || confirmation.toLowerCase() !== parsed.action.toLowerCase()) {
    await interaction.reply({
      content: `Confirmation failed. Type "${parsed.action}" to proceed.`,
      ephemeral: true,
    });
    return;
  }

  const targetServer = context.servers.find((server) => server.id === parsed.serverId);
  if (!targetServer) {
    await interaction.reply({ content: 'Selected server is no longer available.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    await sendPowerSignal(targetServer, parsed.action);
    await interaction.editReply({
      content: `Sent ${parsed.action} command to **${targetServer.name}**.`,
    });
  } catch (error) {
    await interaction.editReply({
      content: `Failed to ${parsed.action} **${targetServer.name}**: ${(error as Error).message}`,
    });
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
      await refreshDashboardMessage(message, state, context);
    }
  }
}

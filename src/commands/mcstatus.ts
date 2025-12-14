import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuInteraction,
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
import { MCSTATUS_ACTION_CUSTOM_ID_PREFIX } from '../config/constants';
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

export type StatusAction = 'console' | 'restart' | 'stop' | 'start';

export const parseActionButton = (customId: string): StatusAction | null => {
  const match = customId.match(
    new RegExp(`^${MCSTATUS_ACTION_CUSTOM_ID_PREFIX}:(console|restart|stop|start)$`)
  );
  if (!match) return null;
  return match[1] as StatusAction;
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

  await interaction.reply({
    content: `Action "${action}" for **${targetServer.name}** is not implemented yet.`,
    ephemeral: true,
  });
}

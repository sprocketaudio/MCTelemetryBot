import {
  ChannelType,
  ChatInputCommandInteraction,
  Message,
  PermissionFlagsBits,
  SlashCommandBuilder,
  SlashCommandChannelOption,
  TextBasedChannel,
  GuildTextBasedChannel,
  User,
} from 'discord.js';
import { DashboardConfig, loadDashboardConfig, saveDashboardConfig } from '../services/dashboardStore';
import { buildDefaultState, buildStatusEmbeds, buildViewComponents, fetchServerStatuses } from '../services/status';
import { isAdministrator } from '../utils/permissions';
import { logger } from '../utils/logger';
import { ServerConfig } from '../config/servers';
import { editReplyWithExpiry, sendTemporaryReply } from '../utils/messages';
import { AuditLogEntry } from '../services/auditLogger';

export interface DashboardContext {
  servers: ServerConfig[];
  resolvePteroToken?: (userId?: string) => string | null;
  onConfigured?: (config: DashboardConfig) => Promise<void> | void;
  logAudit?: (entry: AuditLogEntry, user: User) => Promise<void> | void;
}

const SUPPORTED_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

function isSupportedTextChannel(channel: TextBasedChannel): channel is GuildTextBasedChannel {
  return channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement;
}

export const mcDashboardCommand = new SlashCommandBuilder()
  .setName('mcdashboard')
  .setDescription('Configure the auto-refreshing dashboard channel')
  .addChannelOption((option: SlashCommandChannelOption) =>
    option
      .setName('channel')
      .setDescription('Text channel to post the dashboard in')
      .addChannelTypes(...SUPPORTED_CHANNELS)
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function executeMcDashboard(
  interaction: ChatInputCommandInteraction,
  context: DashboardContext
): Promise<void> {
  if (!isAdministrator(interaction)) {
    await sendTemporaryReply(interaction, 'You need Administrator permissions to use this command.');
    return;
  }

  const channel = interaction.options.getChannel('channel', true);
  const isSupportedChannel =
    channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement;
  if (!isSupportedChannel) {
    await sendTemporaryReply(interaction, 'Please select a text channel.');
    return;
  }

  const selectedChannel = channel as GuildTextBasedChannel;

  await interaction.deferReply();

  const statuses = await fetchServerStatuses(context.servers, {
    forceRefresh: true,
    pterodactylToken: context.resolvePteroToken?.(interaction.user.id),
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
  const components = buildViewComponents(context.servers, state.selectedServerId, state.serverViews);

  const existingConfig = loadDashboardConfig();
  let targetMessage: Message<true> | null = null;

  if (existingConfig && existingConfig.guildId === interaction.guildId) {
    try {
      const existingChannel = await interaction.client.channels.fetch(existingConfig.channelId);
      if (existingChannel && existingChannel.isTextBased() && isSupportedTextChannel(existingChannel)) {
        const textChannel = existingChannel;
        targetMessage = await textChannel.messages.fetch(existingConfig.messageId);
        await targetMessage.edit({ embeds, components });
      }
    } catch (error) {
      logger.warn('Existing dashboard message could not be updated, creating a new one.', error);
      targetMessage = null;
    }
  }

  if (!targetMessage) {
    targetMessage = await selectedChannel.send({ embeds, components });
  }

  if (!targetMessage) {
    await interaction.editReply({ content: 'Unable to configure dashboard. Please try again.' });
    return;
  }

  const config: DashboardConfig = {
    guildId: interaction.guildId ?? '',
    channelId: targetMessage.channelId,
    messageId: targetMessage.id,
    configuredByUserId: interaction.user.id,
  };

  saveDashboardConfig(config);
  if (context.onConfigured) {
    await context.onConfigured(config);
  }

  await editReplyWithExpiry(interaction, 'Dashboard configured');
  context.logAudit?.(
    { action: `Configured dashboard in ${selectedChannel.toString()}.`, emoji: '🛠️', style: 'primary' },
    interaction.user
  );
}

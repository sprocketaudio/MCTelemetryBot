import {
  ChannelType,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  SlashCommandChannelOption,
  TextBasedChannel,
  GuildTextBasedChannel,
} from 'discord.js';
import { DashboardConfig, loadDashboardConfig, saveDashboardConfig } from '../services/dashboardStore';
import { buildStatusEmbed, buildViewComponents, fetchServerStatuses } from '../services/status';
import { isAdmin } from '../utils/permissions';
import { logger } from '../utils/logger';
import { ServerConfig } from '../config/servers';

export interface DashboardContext {
  servers: ServerConfig[];
  adminRoleId?: string;
  onConfigured?: (config: DashboardConfig) => Promise<void> | void;
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
  if (!isAdmin(interaction, context.adminRoleId)) {
    await interaction.reply({
      content: 'You need Administrator permissions to use this command.',
      ephemeral: true,
    });
    return;
  }

  const channel = interaction.options.getChannel('channel', true);
  const isSupportedChannel =
    channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement;
  if (!isSupportedChannel) {
    await interaction.reply({
      content: 'Please select a text channel.',
      ephemeral: true,
    });
    return;
  }

  const selectedChannel = channel as GuildTextBasedChannel;

  await interaction.deferReply({ ephemeral: true });

  const statuses = await fetchServerStatuses(context.servers, { forceRefresh: true });
  const embed = buildStatusEmbed(context.servers, statuses, new Date());
  const components = buildViewComponents('status');

  const existingConfig = loadDashboardConfig();
  let targetMessage;

  if (existingConfig && existingConfig.guildId === interaction.guildId) {
    try {
      const existingChannel = await interaction.client.channels.fetch(existingConfig.channelId);
      if (existingChannel && existingChannel.isTextBased() && isSupportedTextChannel(existingChannel)) {
        const textChannel = existingChannel;
        targetMessage = await textChannel.messages.fetch(existingConfig.messageId);
        await targetMessage.edit({ embeds: [embed], components });
      }
    } catch (error) {
      logger.warn('Existing dashboard message could not be updated, creating a new one.', error);
    }
  }

  if (!targetMessage) {
    targetMessage = await selectedChannel.send({ embeds: [embed], components });
  }

  if (!targetMessage) {
    await interaction.editReply({ content: 'Unable to configure dashboard. Please try again.' });
    return;
  }

  const config: DashboardConfig = {
    guildId: interaction.guildId ?? '',
    channelId: targetMessage.channelId,
    messageId: targetMessage.id,
  };

  saveDashboardConfig(config);
  if (context.onConfigured) {
    await context.onConfigured(config);
  }

  await interaction.editReply({ content: 'Dashboard configured' });
}

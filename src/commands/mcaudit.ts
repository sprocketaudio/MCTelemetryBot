import {
  ChannelType,
  ChatInputCommandInteraction,
  GuildTextBasedChannel,
  PermissionFlagsBits,
  SlashCommandBuilder,
  SlashCommandChannelOption,
  User,
} from 'discord.js';
import { isAdmin } from '../utils/permissions';
import { sendTemporaryReply } from '../utils/messages';
import { AuditConfig, saveAuditConfig } from '../services/auditStore';
import { AuditLogEntry } from '../services/auditLogger';

export interface AuditContext {
  adminRoleId?: string;
  onConfigured?: (config: AuditConfig) => Promise<void> | void;
  logAudit?: (entry: AuditLogEntry, user: User) => Promise<void> | void;
}

const SUPPORTED_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

export const mcAuditCommand = new SlashCommandBuilder()
  .setName('mcaudit')
  .setDescription('Configure the audit log channel')
  .addChannelOption((option: SlashCommandChannelOption) =>
    option
      .setName('channel')
      .setDescription('Text channel to send audit messages to')
      .addChannelTypes(...SUPPORTED_CHANNELS)
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function executeMcAudit(
  interaction: ChatInputCommandInteraction,
  context: AuditContext
): Promise<void> {
  if (!isAdmin(interaction, context.adminRoleId)) {
    await sendTemporaryReply(interaction, 'You need Administrator permissions to use this command.');
    return;
  }

  const channel = interaction.options.getChannel('channel', true);
  const isSupportedChannel = SUPPORTED_CHANNELS.includes(channel.type as (typeof SUPPORTED_CHANNELS)[number]);
  if (!isSupportedChannel) {
    await sendTemporaryReply(interaction, 'Please select a text channel.');
    return;
  }

  const selectedChannel = channel as GuildTextBasedChannel;

  const config: AuditConfig = {
    channelId: selectedChannel.id,
  };

  saveAuditConfig(config);
  if (context.onConfigured) {
    await context.onConfigured(config);
  }

  await sendTemporaryReply(
    interaction,
    `Audit channel set to ${selectedChannel.name} (${selectedChannel.toString()}).`
  );
  context.logAudit?.(
    { action: `Set the audit channel to ${selectedChannel.toString()}.`, emoji: '📢', style: 'primary' },
    interaction.user
  );
}

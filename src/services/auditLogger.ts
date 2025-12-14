import { Client, EmbedBuilder, TextBasedChannel, User } from 'discord.js';
import { AuditConfig } from './auditStore';
import { logger } from '../utils/logger';

export type AuditStyle = 'primary' | 'secondary' | 'success' | 'danger';

export interface AuditLogEntry {
  action: string;
  emoji?: string;
  style?: AuditStyle;
}

const STYLE_COLORS: Record<AuditStyle, number> = {
  primary: 0x5865f2,
  secondary: 0x747f8d,
  success: 0x57f287,
  danger: 0xed4245,
};

export async function sendAuditLog(
  client: Client,
  auditConfig: AuditConfig | null,
  entry: AuditLogEntry,
  user: User
): Promise<void> {
  if (!auditConfig) {
    return;
  }

  try {
    const channel = await client.channels.fetch(auditConfig.channelId);
    if (!channel || !channel.isTextBased() || !('send' in channel)) {
      throw new Error('Configured audit channel is unavailable');
    }

    const textChannel = channel as TextBasedChannel & { send: (options: unknown) => Promise<unknown> };
    const style = entry.style ?? 'primary';
    const embed = new EmbedBuilder()
      .setColor(STYLE_COLORS[style])
      .setAuthor({
        name: `${user.tag} (ID ${user.id})`,
        iconURL: user.displayAvatarURL(),
      })
      .setDescription(`${entry.emoji ? `${entry.emoji} ` : ''}${entry.action}`)
      .setThumbnail(client.user?.displayAvatarURL() ?? null)
      .setTimestamp();

    await textChannel.send({ embeds: [embed] });
  } catch (error) {
    logger.warn('Failed to send audit log message', error);
  }
}

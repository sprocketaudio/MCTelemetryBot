import { Client, TextBasedChannel, User } from 'discord.js';
import { AuditConfig } from './auditStore';
import { logger } from '../utils/logger';

export async function sendAuditLog(
  client: Client,
  auditConfig: AuditConfig | null,
  action: string,
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
    const content = `Audit: ${user.tag} (<@${user.id}>) ${action}`;
    await textChannel.send({ content });
  } catch (error) {
    logger.warn('Failed to send audit log message', error);
  }
}

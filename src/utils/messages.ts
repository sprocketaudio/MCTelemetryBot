import { InteractionEditReplyOptions, InteractionReplyOptions, Message, RepliableInteraction } from 'discord.js';
import { logger } from './logger';

export const TEMP_MESSAGE_DURATION_MS = 5000;

export function scheduleMessageDeletion(
  message: Message | null | undefined,
  delayMs = TEMP_MESSAGE_DURATION_MS
): void {
  if (!message) return;

  setTimeout(() => {
    message.delete().catch((error) => logger.warn('Failed to delete temporary message', error));
  }, delayMs);
}

export async function sendTemporaryReply(
  interaction: RepliableInteraction,
  options: string | InteractionReplyOptions,
  delayMs = TEMP_MESSAGE_DURATION_MS
): Promise<Message> {
  const replyOptions =
    typeof options === 'string'
      ? ({ content: options, fetchReply: true } as InteractionReplyOptions)
      : { ...options, fetchReply: true };

  const message =
    interaction.deferred || interaction.replied
      ? await interaction.followUp(replyOptions)
      : await interaction.reply(replyOptions);

  const resolvedMessage = message as Message;
  scheduleMessageDeletion(resolvedMessage, delayMs);
  return resolvedMessage;
}

export async function editReplyWithExpiry(
  interaction: RepliableInteraction,
  options: string | InteractionEditReplyOptions,
  delayMs = TEMP_MESSAGE_DURATION_MS
): Promise<Message> {
  const message = (await interaction.editReply(options)) as Message;
  scheduleMessageDeletion(message, delayMs);
  return message;
}

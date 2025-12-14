import { ButtonInteraction, ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ServerConfig } from '../config/servers';
import {
  StatusView,
  buildStatusEmbed,
  buildViewComponents,
  fetchServerStatuses,
} from '../services/status';
import { isAdmin } from '../utils/permissions';

export interface CommandContext {
  servers: ServerConfig[];
  adminRoleId?: string;
  onViewChange?: (view: StatusView, messageId?: string) => void;
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
  const embed = buildStatusEmbed(context.servers, statuses, new Date());

  await interaction.editReply({ embeds: [embed], components: buildViewComponents('status') });
}

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

  if (context.onViewChange) {
    context.onViewChange(view, interaction.message.id);
  }

  const statuses = await fetchServerStatuses(context.servers, { forceRefresh: true });
  const embed = buildStatusEmbed(context.servers, statuses, new Date(), view);

  await interaction.editReply({ embeds: [embed], components: buildViewComponents(view) });
}

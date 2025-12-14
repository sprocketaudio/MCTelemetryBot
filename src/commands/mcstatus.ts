import { ButtonInteraction, ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ServerConfig } from '../config/servers';
import { buildRefreshComponents, buildStatusEmbed, fetchServerStatuses } from '../services/status';
import { isAdmin } from '../utils/permissions';

export interface CommandContext {
  servers: ServerConfig[];
  adminRoleId?: string;
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

  await interaction.editReply({ embeds: [embed], components: buildRefreshComponents() });
}

export async function handleMcStatusRefresh(
  interaction: ButtonInteraction,
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

  const statuses = await fetchServerStatuses(context.servers, { forceRefresh: true });
  const embed = buildStatusEmbed(context.servers, statuses, new Date());

  await interaction.editReply({ embeds: [embed], components: buildRefreshComponents() });
}

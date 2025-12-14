import { GuildMemberRoleManager, PermissionFlagsBits } from 'discord.js';

export const isAdministrator = (interaction: { memberPermissions?: any }) => {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
};

export const hasModRoleOrAdmin = (
  interaction: { memberPermissions?: any; member?: any },
  modRoleId?: string
) => {
  if (isAdministrator(interaction)) return true;

  if (modRoleId && interaction.member && 'roles' in interaction.member) {
    const roles = interaction.member.roles as GuildMemberRoleManager;
    if (roles?.cache?.has(modRoleId)) return true;
  }

  return false;
};

import { GuildMemberRoleManager, PermissionFlagsBits } from 'discord.js';

export const isAdmin = (interaction: { memberPermissions?: any; member?: any }, adminRoleId?: string) => {
  const hasAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  if (hasAdmin) return true;

  if (adminRoleId && interaction.member && 'roles' in interaction.member) {
    const roles = interaction.member.roles as GuildMemberRoleManager;
    if (roles?.cache?.has(adminRoleId)) return true;
  }

  return false;
};

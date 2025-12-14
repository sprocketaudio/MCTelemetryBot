import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { ServerConfig } from '../config/servers';
import { MCSTATUS_REFRESH_ID } from '../config/constants';
import { PterodactylResources, fetchPterodactylResources } from './pterodactyl';
import { TelemetryResponse, fetchTelemetry } from './telemetry';
import { logger } from '../utils/logger';

export interface ServerStatus {
  telemetry?: TelemetryResponse;
  telemetryError?: Error;
  pterodactyl?: PterodactylResources;
  pterodactylError?: Error;
}

export async function fetchServerStatuses(
  servers: ServerConfig[],
  options: { forceRefresh?: boolean } = {}
): Promise<Map<string, ServerStatus>> {
  const result = new Map<string, ServerStatus>();

  await Promise.all(
    servers.map(async (server) => {
      const status: ServerStatus = {};
      result.set(server.id, status);

      const telemetryPromise = fetchTelemetry(server, options)
        .then((data) => {
          status.telemetry = data;
        })
        .catch((error) => {
          status.telemetryError = error as Error;
          logger.warn(`Failed to fetch telemetry for ${server.name}: ${(error as Error).message}`);
        });

      const pterodactylPromise = server.pteroIdentifier
        ? fetchPterodactylResources(server, options)
            .then((data) => {
              status.pterodactyl = data;
            })
            .catch((error) => {
              status.pterodactylError = error as Error;
              logger.warn(`Failed to fetch Pterodactyl data for ${server.name}: ${(error as Error).message}`);
            })
        : Promise.resolve();

      await Promise.all([telemetryPromise, pterodactylPromise]);
    })
  );

  return result;
}

const formatStatus = (state?: string) => {
  switch (state) {
    case 'running':
      return '🟢 running';
    case 'starting':
      return '🟡 starting';
    case 'stopping':
      return '🟠 stopping';
    case 'offline':
      return '🔴 offline';
    default:
      return '—';
  }
};

const formatPlayers = (telemetry?: TelemetryResponse) => {
  if (!telemetry) return '—';
  const players = telemetry.players ?? [];
  if (players.length === 0) return '0';
  const names = players.map((p) => p.name);
  const suffix = names.length <= 5 ? ` (${names.join(', ')})` : '';
  return `${players.length}${suffix}`;
};

const formatTpsMspt = (telemetry?: TelemetryResponse) => {
  if (!telemetry) return 'TPS — | MSPT —';
  return `TPS ${telemetry.tps.toFixed(1)} | MSPT ${telemetry.mspt.toFixed(1)}ms`;
};

const toNumberOrUndefined = (value: number | undefined) =>
  typeof value === 'number' && !Number.isNaN(value) ? value : undefined;

const formatBytesAsGb = (bytes?: number) => {
  const value = toNumberOrUndefined(bytes);
  if (value === undefined) return '—';
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

const formatCpu = (cpu?: number) => {
  const value = toNumberOrUndefined(cpu);
  if (value === undefined) return '—';
  return `${value.toFixed(1)}%`;
};

const formatUptime = (uptimeMs?: number) => {
  const value = toNumberOrUndefined(uptimeMs);
  if (value === undefined) return '—';

  const totalSeconds = Math.floor(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h${minutes.toString().padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m${seconds.toString().padStart(2, '0')}s`;
  return `${seconds}s`;
};

const formatResources = (resources?: PterodactylResources) => {
  const cpu = formatCpu(resources?.cpuAbsolute);
  const memUsed = formatBytesAsGb(resources?.memoryBytes);
  const memLimit = resources?.memoryLimitBytes ? formatBytesAsGb(resources.memoryLimitBytes) : '—';
  const disk = formatBytesAsGb(resources?.diskBytes);
  const uptime = formatUptime(resources?.uptimeMs);

  return `CPU: ${cpu} | MEM: ${memUsed}/${memLimit} | Disk: ${disk} | Uptime: ${uptime}`;
};

export const buildStatusEmbed = (
  servers: ServerConfig[],
  statuses: Map<string, ServerStatus>,
  lastUpdated: Date
) => {
  const embed = new EmbedBuilder().setTitle('Minecraft Server Status').setColor(0x2d3136);

  servers.forEach((server) => {
    const status = statuses.get(server.id);
    const telemetry = status?.telemetry;
    const pterodactyl = status?.pterodactyl;

    const lines = [
      `Status: ${formatStatus(pterodactyl?.currentState)}`,
      `TPS/MSPT: ${formatTpsMspt(telemetry)}`,
      `Players: ${formatPlayers(telemetry)}`,
      formatResources(pterodactyl),
    ];

    const name = server.pteroName ?? server.name;
    embed.addFields({ name, value: lines.join('\n') });
  });

  embed.setFooter({ text: `Last update: <t:${Math.floor(lastUpdated.getTime() / 1000)}:R>` });
  return embed;
};

export const buildRefreshComponents = () => [
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(MCSTATUS_REFRESH_ID).setLabel('Refresh').setStyle(ButtonStyle.Primary)
  ),
];

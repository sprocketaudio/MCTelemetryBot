import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Message } from 'discord.js';
import { ServerConfig } from '../config/servers';
import { MCSTATUS_VIEW_PLAYERS_ID, MCSTATUS_VIEW_STATUS_ID } from '../config/constants';
import { PterodactylResources, fetchPterodactylResources } from './pterodactyl';
import { TelemetryResponse, fetchTelemetry } from './telemetry';
import { logger } from '../utils/logger';

export interface ServerStatus {
  telemetry?: TelemetryResponse;
  telemetryError?: Error;
  pterodactyl?: PterodactylResources;
  pterodactylError?: Error;
}

export type StatusView = 'status' | 'players';

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
      return '🟢 Running';
    case 'starting':
      return '🟡 Starting';
    case 'stopping':
      return '🟠 Stopping';
    case 'offline':
      return '🔴 Offline';
    default:
      return '—';
  }
};

const formatPlayers = (telemetry?: TelemetryResponse, error?: Error) => {
  if (error) return 'Player info unavailable';
  if (!telemetry) return '—';
  const players = telemetry.players ?? [];
  if (players.length === 0) return 'No players online';
  const names = players.map((p) => `- ${p.name}`);
  return `Online (${players.length}):\n${names.join('\n')}`;
};

const formatPlayerSummary = (telemetry?: TelemetryResponse, error?: Error) => {
  if (error) return 'Players Online: unavailable';
  if (!telemetry) return 'Players Online: —';
  return `Players Online: ${telemetry.players?.length ?? 0}`;
};

const formatTpsMspt = (telemetry?: TelemetryResponse) => {
  if (!telemetry) return 'TPS — | MSPT —';
  return `TPS ${telemetry.tps.toFixed(1)} | MSPT ${telemetry.mspt.toFixed(1)}ms`;
};

const toNumberOrUndefined = (value: number | undefined) =>
  typeof value === 'number' && !Number.isNaN(value) ? value : undefined;

const formatPercent = (value?: number) => {
  const numeric = toNumberOrUndefined(value);
  if (numeric === undefined) return '—';
  return `${numeric.toFixed(1)}%`;
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

const calculatePercent = (used?: number, limit?: number) => {
  const usedValue = toNumberOrUndefined(used);
  const limitValue = toNumberOrUndefined(limit);
  if (usedValue === undefined || limitValue === undefined || limitValue === 0) return undefined;
  return (usedValue / limitValue) * 100;
};

const isHot = (percent?: number) => percent !== undefined && percent > 90;

const formatResources = (resources?: PterodactylResources) => {
  const cpuPercent = resources?.cpuLimitPercent
    ? calculatePercent(resources.cpuAbsolute, resources.cpuLimitPercent)
    : toNumberOrUndefined(resources?.cpuAbsolute);
  const memPercent = calculatePercent(resources?.memoryBytes, resources?.memoryLimitBytes);
  const diskPercent = calculatePercent(resources?.diskBytes, resources?.diskLimitBytes);

  const cpuIcon = isHot(cpuPercent) ? '🔥' : '🧠';
  const memIcon = isHot(memPercent) ? '🔥' : '🧮';
  const diskIcon = isHot(diskPercent) ? '🔥' : '💾';

  const cpuText = `${cpuIcon} CPU ${formatPercent(cpuPercent)}`;
  const memText = `${memIcon} RAM ${formatPercent(memPercent)}`;
  const diskText = `${diskIcon} Disk ${formatPercent(diskPercent)}`;
  const uptimeText = resources?.uptimeMs !== undefined ? `⏱ Uptime ${formatUptime(resources?.uptimeMs)}` : null;

  const cpuRamLine = [cpuText, memText].filter(Boolean).join(' | ');
  const diskUptimeLine = [diskText, uptimeText].filter(Boolean).join(' | ');

  return [cpuRamLine, diskUptimeLine];
};

const formatStatusLines = (
  telemetry?: TelemetryResponse,
  resources?: PterodactylResources,
  telemetryError?: Error
) => {
  const lines = [formatPlayerSummary(telemetry, telemetryError), formatTpsMspt(telemetry)];

  const resourceLines = formatResources(resources);
  if (resourceLines.length > 0) {
    lines.push('', ...resourceLines);
  }

  return lines.join('\n');
};

const formatPlayerLines = (telemetry?: TelemetryResponse, telemetryError?: Error) => {
  return formatPlayers(telemetry, telemetryError);
};

const formatFooterDate = (lastUpdated: Date) => {
  return lastUpdated.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  });
};

export const buildStatusEmbed = (
  servers: ServerConfig[],
  statuses: Map<string, ServerStatus>,
  lastUpdated: Date,
  view: StatusView = 'status'
) => {
  const embed = new EmbedBuilder().setTitle('Minecraft Server Status').setColor(0x2d3136);

  servers.forEach((server) => {
    const status = statuses.get(server.id);
    const telemetry = status?.telemetry;
    const pterodactyl = status?.pterodactyl;

    const value =
      view === 'status'
        ? formatStatusLines(telemetry, pterodactyl, status?.telemetryError)
        : formatPlayerLines(telemetry, status?.telemetryError);

    const name = server.pteroName ?? server.name;
    const statusLabel = formatStatus(pterodactyl?.currentState);
    embed.addFields({ name: `${name} ${statusLabel}\n`, value });
  });

  embed.setFooter({ text: `Last update: ${formatFooterDate(lastUpdated)} UTC` });
  return embed;
};

export function buildViewComponents(
  activeView: StatusView
): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(MCSTATUS_VIEW_STATUS_ID)
        .setLabel('Status')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(activeView === 'status'),
      new ButtonBuilder()
        .setCustomId(MCSTATUS_VIEW_PLAYERS_ID)
        .setLabel('Players')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(activeView === 'players')
    ),
  ];
}

export const getViewFromMessage = (message: Message): StatusView => {
  for (const row of message.components) {
    const actionRow = (row as { components?: { customId?: string; disabled?: boolean }[] }).components;
    if (!actionRow) continue;

    for (const component of actionRow) {
      if (component.customId === MCSTATUS_VIEW_PLAYERS_ID && component.disabled) {
        return 'players';
      }
      if (component.customId === MCSTATUS_VIEW_STATUS_ID && component.disabled) {
        return 'status';
      }
    }
  }

  return 'status';
};

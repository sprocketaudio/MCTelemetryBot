import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  Message,
  MessageActionRowComponentBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { ServerConfig } from '../config/servers';
import {
  MCSTATUS_ACTION_CUSTOM_ID_PREFIX,
  MCSTATUS_SELECT_CUSTOM_ID,
  MCSTATUS_VIEW_CUSTOM_ID_PREFIX,
} from '../config/constants';
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

export interface DashboardState {
  selectedServerId: string | null;
  serverViews: Record<string, StatusView>;
}

const VIEW_CUSTOM_ID_REGEX = new RegExp(`^${MCSTATUS_VIEW_CUSTOM_ID_PREFIX}:(status|players)$`);

export const buildDefaultState = (defaultView: StatusView = 'status'): DashboardState => ({
  selectedServerId: null,
  serverViews: {},
});

export const getServerView = (
  serverId: string,
  state: DashboardState,
  defaultView: StatusView = 'status'
): StatusView => state.serverViews[serverId] ?? defaultView;

export const parseViewButton = (customId: string): StatusView | null => {
  const match = customId.match(VIEW_CUSTOM_ID_REGEX);
  if (!match) return null;
  return match[1] as StatusView;
};

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

// Builds: "<left padded>  |  <right>" so the "|" lines up across servers.
// No monospace, so it’s “best-effort” alignment, but it looks much cleaner.
const twoColBar = (left: string, right: string, leftWidth: number) =>
  `${left.padEnd(leftWidth)}  |  ${right}`;

const formatResources = (resources: PterodactylResources | undefined, leftWidth: number) => {
  const cpuPercent = resources?.cpuLimitPercent
    ? calculatePercent(resources.cpuAbsolute, resources.cpuLimitPercent)
    : toNumberOrUndefined(resources?.cpuAbsolute);
  const memPercent = calculatePercent(resources?.memoryBytes, resources?.memoryLimitBytes);
  const diskPercent = calculatePercent(resources?.diskBytes, resources?.diskLimitBytes);

  const cpuIcon = isHot(cpuPercent) ? '🔥' : '🧠';
  const memIcon = isHot(memPercent) ? '🔥' : '🧮'; // keep abacus
  const diskIcon = isHot(diskPercent) ? '🔥' : '💾';

  const cpuText = `${cpuIcon} CPU ${formatPercent(cpuPercent)}`;
  const memText = `${memIcon} RAM ${formatPercent(memPercent)}`;
  const diskText = `${diskIcon} Disk ${formatPercent(diskPercent)}`;
  const uptimeText =
    resources?.uptimeMs !== undefined ? `⏱ Uptime ${formatUptime(resources.uptimeMs)}` : '⏱ Uptime —';

  const cpuRamLine = twoColBar(cpuText, memText, leftWidth);
  const diskUptimeLine = twoColBar(diskText, uptimeText, leftWidth);

  return [cpuRamLine, diskUptimeLine];
};

const formatStatusLines = (
  telemetry?: TelemetryResponse,
  resources?: PterodactylResources,
  telemetryError?: Error,
  leftWidth: number = 16
) => {
  const lines = [formatPlayerSummary(telemetry, telemetryError), formatTpsMspt(telemetry)];

  const resourceLines = formatResources(resources, leftWidth);
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

export const buildStatusEmbeds = (
  servers: ServerConfig[],
  statuses: Map<string, ServerStatus>,
  lastUpdated: Date,
  serverViews: Record<string, StatusView>,
  selectedServerId: string | null,
  defaultView: StatusView = 'status'
) => {
  const leftWidth = 16;
  const embeds: EmbedBuilder[] = [];

  const selectedId = servers.some((server) => server.id === selectedServerId) ? selectedServerId : null;

  servers.forEach((server) => {
    const status = statuses.get(server.id);
    const telemetry = status?.telemetry;
    const pterodactyl = status?.pterodactyl;

    const view = getServerView(server.id, { selectedServerId, serverViews }, defaultView);
    const description =
      view === 'status'
        ? formatStatusLines(telemetry, pterodactyl, status?.telemetryError, leftWidth)
        : formatPlayerLines(telemetry, status?.telemetryError);

    const name = server.pteroName ?? server.name;
    const prefix = server.id === selectedId ? '▶ ' : '';
    const title = `${prefix}${name}  ${formatStatus(pterodactyl?.currentState)}`;

    const embedColor = server.id === selectedId ? 0x00c6ff : 0x2b1645;

    embeds.push(
      new EmbedBuilder()
        .setTitle(title)
        .setColor(embedColor)
        .setDescription(description)
        .setFooter({ text: `Last update: ${formatFooterDate(lastUpdated)} UTC` })
    );
  });

  return embeds;
};

export function buildViewComponents(
  servers: ServerConfig[],
  selectedServerId: string | null,
  serverViews: Record<string, StatusView>,
  defaultView: StatusView = 'status'
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const selectedId = servers.some((server) => server.id === selectedServerId) ? selectedServerId : null;
  const activeView = selectedId ? getServerView(selectedId, { selectedServerId, serverViews }, defaultView) : defaultView;

  const selectMenu = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(MCSTATUS_SELECT_CUSTOM_ID)
      .setPlaceholder('Select server…')
      .addOptions(
        servers.map((server) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(server.name)
            .setValue(server.id)
            .setDefault(server.id === selectedId)
        )
      )
  );

  const viewButtons = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${MCSTATUS_VIEW_CUSTOM_ID_PREFIX}:status`)
      .setLabel('Status')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!selectedId || activeView === 'status'),
    new ButtonBuilder()
      .setCustomId(`${MCSTATUS_VIEW_CUSTOM_ID_PREFIX}:players`)
      .setLabel('Players')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!selectedId || activeView === 'players')
  );

  const actionButtons = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${MCSTATUS_ACTION_CUSTOM_ID_PREFIX}:console`)
      .setLabel('Open Console')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!selectedId),
    new ButtonBuilder()
      .setCustomId(`${MCSTATUS_ACTION_CUSTOM_ID_PREFIX}:restart`)
      .setLabel('Restart')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!selectedId),
    new ButtonBuilder()
      .setCustomId(`${MCSTATUS_ACTION_CUSTOM_ID_PREFIX}:stop`)
      .setLabel('Stop')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!selectedId),
    new ButtonBuilder()
      .setCustomId(`${MCSTATUS_ACTION_CUSTOM_ID_PREFIX}:kill`)
      .setLabel('Kill')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!selectedId),
    new ButtonBuilder()
      .setCustomId(`${MCSTATUS_ACTION_CUSTOM_ID_PREFIX}:start`)
      .setLabel('Start')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!selectedId)
  );

  return [selectMenu, viewButtons, actionButtons];
}

export const getDashboardStateFromMessage = (
  message: Message,
  servers: ServerConfig[],
  defaultView: StatusView = 'status'
): DashboardState => {
  const state = buildDefaultState(defaultView);
  const validIds = new Set(servers.map((server) => server.id));

  for (const row of message.components) {
    const actionRow = (row as { components?: { customId?: string; disabled?: boolean; options?: { value: string; default?: boolean }[]; type?: number }[] }).components;
    if (!actionRow) continue;

    for (const component of actionRow) {
      if (!component.customId) continue;

      if (component.customId === MCSTATUS_SELECT_CUSTOM_ID && component.type === ComponentType.StringSelect) {
        const selectedOption = component.options?.find((option) => option.default);
        if (selectedOption && validIds.has(selectedOption.value)) {
          state.selectedServerId = selectedOption.value;
        }
      }

      const parsedView = parseViewButton(component.customId);
      if (parsedView) {
        const isDisabled = (component as { disabled?: boolean }).disabled;
        if (isDisabled && state.selectedServerId) {
          state.serverViews[state.selectedServerId] = parsedView;
        }
      }
    }
  }

  if (state.selectedServerId && !validIds.has(state.selectedServerId)) {
    state.selectedServerId = null;
  }

  if (state.selectedServerId && !state.serverViews[state.selectedServerId]) {
    state.serverViews[state.selectedServerId] = defaultView;
  }

  return state;
};

import { ServerConfig } from '../config/servers';
import { logger } from '../utils/logger';

export interface PterodactylResources {
  currentState?: string;
  cpuAbsolute?: number;
  cpuLimitPercent?: number;
  memoryBytes?: number;
  memoryLimitBytes?: number;
  diskBytes?: number;
  diskLimitBytes?: number;
  networkRxBytes?: number;
  networkTxBytes?: number;
  uptimeMs?: number;
}

interface PterodactylLimits {
  cpuLimitPercent?: number;
  memoryLimitBytes?: number;
  diskLimitBytes?: number;
}

interface CacheEntry {
  data: PterodactylResources;
  timestamp: number;
}

const CACHE_TTL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 2_000;
const cache = new Map<string, CacheEntry>();
const lastKnownStates = new Map<string, string | undefined>();
const runningSince = new Map<string, number>();

export type PowerSignal = 'start' | 'restart' | 'stop' | 'kill';

const getEnv = () => {
  const panelUrl = process.env.PTERO_PANEL_URL;
  const token = process.env.PTERO_CLIENT_TOKEN;

  if (!panelUrl || !token) {
    throw new Error('PTERO_PANEL_URL and PTERO_CLIENT_TOKEN must be set to fetch server health.');
  }

  return { panelUrl: panelUrl.replace(/\/$/, ''), token };
};

const validateAndParseResources = (payload: unknown): PterodactylResources => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid Pterodactyl payload');
  }

  const attributes = (payload as any).attributes;
  if (!attributes || typeof attributes !== 'object') {
    throw new Error('Invalid Pterodactyl payload attributes');
  }

  const resources = attributes.resources ?? {};
  return {
    currentState: attributes.current_state,
    cpuAbsolute: Number(resources.cpu_absolute),
    memoryBytes: Number(resources.memory_bytes),
    memoryLimitBytes: resources.memory_limit_bytes !== undefined ? Number(resources.memory_limit_bytes) : undefined,
    diskBytes: Number(resources.disk_bytes),
    diskLimitBytes:
      resources.disk_limit_bytes !== undefined ? Number(resources.disk_limit_bytes) : undefined,
    networkRxBytes: Number(resources.network_rx_bytes),
    networkTxBytes: Number(resources.network_tx_bytes),
    uptimeMs: attributes.uptime !== undefined ? Number(attributes.uptime) : undefined,
  };
};

const validateAndParseLimits = (payload: unknown): PterodactylLimits => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid Pterodactyl limits payload');
  }

  const attributes = (payload as any).attributes;
  if (!attributes || typeof attributes !== 'object') {
    throw new Error('Invalid Pterodactyl limits payload attributes');
  }

  const limits = attributes.limits ?? {};
  const toBytes = (value: unknown) => (value === undefined ? undefined : Number(value) * 1024 * 1024);

  return {
    cpuLimitPercent: limits.cpu !== undefined ? Number(limits.cpu) : undefined,
    memoryLimitBytes: toBytes(limits.memory),
    diskLimitBytes: toBytes(limits.disk),
  };
};

const withTimeout = async (url: string, token: string, init: RequestInit = { method: 'GET' }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    if (response.status === 204) {
      return null;
    }

    const text = await response.text();
    if (!text) return null;

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return JSON.parse(text) as unknown;
    }

    return text as unknown;
  } finally {
    clearTimeout(timeout);
  }
};

const calculateUptime = (
  serverId: string,
  currentState?: string,
  reportedUptimeMs?: number
): number | undefined => {
  const previousState = lastKnownStates.get(serverId);
  lastKnownStates.set(serverId, currentState);

  if (currentState !== 'running') {
    runningSince.delete(serverId);
    return undefined;
  }

  if (!runningSince.has(serverId) || previousState !== 'running') {
    const startedAt = Date.now() - (reportedUptimeMs ?? 0);
    runningSince.set(serverId, startedAt);
  }

  const start = runningSince.get(serverId);
  return start !== undefined ? Date.now() - start : reportedUptimeMs;
};

export async function fetchPterodactylResources(
  server: ServerConfig,
  options: { forceRefresh?: boolean } = {}
): Promise<PterodactylResources> {
  if (!server.pteroIdentifier) {
    throw new Error(`Server ${server.name} is missing pteroIdentifier.`);
  }

  const cached = cache.get(server.id);
  const now = Date.now();
  if (!options.forceRefresh && cached && now - cached.timestamp < CACHE_TTL_MS) {
    logger.debug(`Serving cached Pterodactyl resources for ${server.name}`);
    const uptimeMs = calculateUptime(server.id, cached.data.currentState, cached.data.uptimeMs);
    return { ...cached.data, uptimeMs };
  }

  const { panelUrl, token } = getEnv();
  const resourcesUrl = `${panelUrl}/api/client/servers/${server.pteroIdentifier}/resources`;
  const limitsUrl = `${panelUrl}/api/client/servers/${server.pteroIdentifier}`;

  const [resourcesPayload, limitsPayload] = await Promise.all([
    withTimeout(resourcesUrl, token),
    withTimeout(limitsUrl, token),
  ]);

  const parsedResources = validateAndParseResources(resourcesPayload);
  const parsedLimits = validateAndParseLimits(limitsPayload);

  const data: PterodactylResources = {
    ...parsedResources,
    cpuLimitPercent: parsedLimits.cpuLimitPercent ?? parsedResources.cpuLimitPercent,
    memoryLimitBytes: parsedLimits.memoryLimitBytes ?? parsedResources.memoryLimitBytes,
    diskLimitBytes: parsedLimits.diskLimitBytes ?? parsedResources.diskLimitBytes,
  };

  data.uptimeMs = calculateUptime(server.id, data.currentState, data.uptimeMs);

  cache.set(server.id, { data, timestamp: now });
  return data;
}

export const buildPanelConsoleUrl = (server: ServerConfig): string => {
  const { panelUrl } = getEnv();
  return `${panelUrl}/server/${server.pteroIdentifier}`;
};

export async function sendPowerSignal(server: ServerConfig, signal: PowerSignal): Promise<void> {
  const { panelUrl, token } = getEnv();
  const powerUrl = `${panelUrl}/api/client/servers/${server.pteroIdentifier}/power`;

  await withTimeout(powerUrl, token, {
    method: 'POST',
    body: JSON.stringify({ signal }),
  });
}

export function clearPterodactylCache(): void {
  cache.clear();
}

import { ServerConfig } from '../config/servers';
import { logger } from '../utils/logger';

export interface PterodactylResources {
  currentState?: string;
  cpuAbsolute?: number;
  memoryBytes?: number;
  memoryLimitBytes?: number;
  diskBytes?: number;
  diskLimitBytes?: number;
  networkRxBytes?: number;
  networkTxBytes?: number;
  uptimeMs?: number;
}

interface CacheEntry {
  data: PterodactylResources;
  timestamp: number;
}

const CACHE_TTL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 2_000;
const cache = new Map<string, CacheEntry>();

const getEnv = () => {
  const panelUrl = process.env.PTERO_PANEL_URL;
  const token = process.env.PTERO_CLIENT_TOKEN;

  if (!panelUrl || !token) {
    throw new Error('PTERO_PANEL_URL and PTERO_CLIENT_TOKEN must be set to fetch server health.');
  }

  return { panelUrl: panelUrl.replace(/\/$/, ''), token };
};

const validateAndParse = (payload: unknown): PterodactylResources => {
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
    return cached.data;
  }

  const { panelUrl, token } = getEnv();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = `${panelUrl}/api/client/servers/${server.pteroIdentifier}/resources`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    const data = validateAndParse(payload);
    cache.set(server.id, { data, timestamp: now });
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export function clearPterodactylCache(): void {
  cache.clear();
}

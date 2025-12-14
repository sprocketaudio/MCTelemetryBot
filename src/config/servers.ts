import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export interface ServerConfig {
  id: string;
  name: string;
  telemetryUrl: string;
  pteroIdentifier: string;
  pteroName?: string;
}

const serverFileCandidates = [
  path.resolve('servers.json'),
  path.resolve('config', 'servers.json'),
];

const isValidUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (error) {
    return false;
  }
};

export function loadServers(): ServerConfig[] {
  const filePath = serverFileCandidates.find((candidate) => fs.existsSync(candidate));

  if (!filePath) {
    throw new Error('No servers.json file found. Create servers.json in the project root or ./config.');
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse ${filePath}: ${(error as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('servers.json must contain an array of server definitions.');
  }

  const servers: ServerConfig[] = parsed.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Server entry at index ${index} is not an object.`);
    }

    const { id, name, telemetryUrl, pteroIdentifier, pteroName } = item as Partial<ServerConfig>;

    if (!id || typeof id !== 'string') {
      throw new Error(`Server entry at index ${index} is missing an id.`);
    }

    if (!name || typeof name !== 'string') {
      throw new Error(`Server entry at index ${index} is missing a name.`);
    }

    if (!telemetryUrl || typeof telemetryUrl !== 'string' || !isValidUrl(telemetryUrl)) {
      throw new Error(
        `Server entry at index ${index} has an invalid telemetryUrl (must be http/https).`
      );
    }

    if (!pteroIdentifier || typeof pteroIdentifier !== 'string') {
      throw new Error(`Server entry at index ${index} is missing a pteroIdentifier.`);
    }

    return { id, name, telemetryUrl, pteroIdentifier, pteroName };
  });

  logger.info(`Loaded ${servers.length} servers from ${filePath}`);
  return servers;
}

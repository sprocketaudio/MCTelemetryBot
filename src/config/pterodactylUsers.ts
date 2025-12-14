import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export interface PterodactylUserToken {
  userId: string;
  token: string;
}

const tokenFileCandidates = [
  path.resolve('pterodactylTokens.json'),
  path.resolve('config', 'pterodactylTokens.json'),
];

export function loadPterodactylUserTokens(): Map<string, string> {
  const filePath = tokenFileCandidates.find((candidate) => fs.existsSync(candidate));
  if (!filePath) {
    logger.info('No pterodactylTokens.json found; falling back to default token.');
    return new Map();
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error('Token file must contain an array of { userId, token } objects.');
    }

    const entries = parsed.map((item, index) => {
      if (!item || typeof item !== 'object') {
        throw new Error(`Entry at index ${index} is not an object.`);
      }

      const { userId, token } = item as Partial<PterodactylUserToken>;
      if (!userId || typeof userId !== 'string') {
        throw new Error(`Entry at index ${index} is missing a userId.`);
      }

      if (!token || typeof token !== 'string') {
        throw new Error(`Entry at index ${index} is missing a token.`);
      }

      return [userId, token] as const;
    });

    logger.info(`Loaded ${entries.length} Pterodactyl user token(s) from ${filePath}`);
    return new Map(entries);
  } catch (error) {
    throw new Error(`Failed to read ${filePath}: ${(error as Error).message}`);
  }
}

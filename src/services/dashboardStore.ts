import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export interface DashboardConfig {
  guildId: string;
  channelId: string;
  messageId: string;
  configuredByUserId?: string;
}

const DASHBOARD_PATH = path.resolve('dashboard.json');

export function loadDashboardConfig(): DashboardConfig | null {
  if (!fs.existsSync(DASHBOARD_PATH)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(DASHBOARD_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DashboardConfig>;
    if (parsed.guildId && parsed.channelId && parsed.messageId) {
      return parsed as DashboardConfig;
    }

    logger.warn('dashboard.json is missing required fields; ignoring file.');
    return null;
  } catch (error) {
    logger.warn('Failed to read dashboard.json; ignoring dashboard config.', error);
    return null;
  }
}

export function saveDashboardConfig(config: DashboardConfig): void {
  fs.writeFileSync(DASHBOARD_PATH, JSON.stringify(config, null, 2));
}

export function clearDashboardConfig(): void {
  if (fs.existsSync(DASHBOARD_PATH)) {
    fs.rmSync(DASHBOARD_PATH);
  }
}

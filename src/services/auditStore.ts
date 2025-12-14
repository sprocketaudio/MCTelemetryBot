import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export interface AuditConfig {
  channelId: string;
}

const AUDIT_PATH = path.resolve('audit.json');

export function loadAuditConfig(): AuditConfig | null {
  if (!fs.existsSync(AUDIT_PATH)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(AUDIT_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AuditConfig>;
    if (parsed.channelId) {
      return parsed as AuditConfig;
    }

    logger.warn('audit.json is missing required fields; ignoring file.');
    return null;
  } catch (error) {
    logger.warn('Failed to read audit.json; ignoring audit config.', error);
    return null;
  }
}

export function saveAuditConfig(config: AuditConfig): void {
  fs.writeFileSync(AUDIT_PATH, JSON.stringify(config, null, 2));
}

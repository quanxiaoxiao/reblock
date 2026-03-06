import type { Context } from 'hono';
import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';

export interface AuditEntry {
  timestamp: number;
  requestId: string;
  action: AuditAction;
  resourceType: ResourceType;
  resourceId?: string | undefined;
  status: 'success' | 'failure';
  ip: string;
  userAgent?: string | undefined;
  method: string;
  path: string;
  statusCode?: number | undefined;
  error?: string | undefined;
  userId?: string | undefined;
}

export type AuditAction = 
  | 'CREATE' 
  | 'READ' 
  | 'UPDATE' 
  | 'DELETE' 
  | 'DOWNLOAD' 
  | 'UPLOAD'
  | 'LIST';

export type ResourceType = 
  | 'entry' 
  | 'block' 
  | 'resource';

const AUDIT_DIR = join(process.cwd(), 'storage', '_audit');
const AUDIT_FILE = join(AUDIT_DIR, `audit-${getDateString()}.jsonl`);

function getDateString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export class AuditService {
  private initialized = false;

  private async ensureDirectoryExists(): Promise<void> {
    if (this.initialized) return;
    
    try {
      await mkdir(AUDIT_DIR, { recursive: true });
      this.initialized = true;
    } catch (error) {
      console.error('Failed to create audit directory:', error);
    }
  }

  async log(entry: AuditEntry): Promise<void> {
    await this.ensureDirectoryExists();
    
    try {
      const logLine = JSON.stringify(entry) + '\n';
      await appendFile(AUDIT_FILE, logLine);
    } catch (error) {
      console.error('Failed to write audit log:', error);
    }
  }

  getClientIp(c: Pick<Context, 'req'>): string {
    const cfIp = c.req.header('cf-connecting-ip');
    if (cfIp) return cfIp;
    
    const forwardedFor = c.req.header('x-forwarded-for');
    if (forwardedFor) {
      const firstForwardedIp = forwardedFor.split(',')[0];
      return firstForwardedIp ? firstForwardedIp.trim() : 'unknown';
    }
    
    return c.req.raw?.socket?.remoteAddress || 'unknown';
  }
}

export const auditService = new AuditService();

import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';

export interface AuditEntry {
  timestamp: number;
  requestId: string;
  action: AuditAction;
  resourceType: ResourceType;
  resourceId?: string;
  status: 'success' | 'failure';
  ip: string;
  userAgent?: string;
  method: string;
  path: string;
  statusCode?: number;
  error?: string;
  userId?: string;
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

function getDateString() {
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

  getClientIp(c: { req: { header: (name: string) => string | null; raw?: { socket?: { remoteAddress?: string } } } }): string {
    const cfIp = c.req.header('cf-connecting-ip');
    if (cfIp) return cfIp;
    
    const forwardedFor = c.req.header('x-forwarded-for');
    if (forwardedFor) {
      return forwardedFor.split(',')[0].trim();
    }
    
    return c.req.raw?.socket?.remoteAddress || 'unknown';
  }
}

export const auditService = new AuditService();

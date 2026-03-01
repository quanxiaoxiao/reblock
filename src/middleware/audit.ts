import type { Context, Next } from 'hono';
import { auditService, type AuditAction, type ResourceType } from '../services/auditService';
import { env } from '../config/env';

export interface AuditOptions {
  action: AuditAction;
  resourceType: ResourceType;
  getResourceId?: (c: Context) => string | undefined;
}

export const audit = (options: AuditOptions) => {
  return async (c: Context, next: Next) => {
    const requestId = crypto.randomUUID();
    c.set('requestId', requestId);
    c.set('auditStartTime', Date.now());
    
    const clientIp = auditService.getClientIp(c as any);
    const userAgent = c.req.header('user-agent') || undefined;
    const method = c.req.method;
    const path = c.req.path;
    
    let error: string | undefined;
    let statusCode: number | undefined;
    
    try {
      await next();
      statusCode = c.res.status;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      statusCode = 500;
      throw err;
    } finally {
      const success = statusCode !== undefined && statusCode < 400;
      
      if (env.NODE_ENV === 'production' || env.NODE_ENV === 'development') {
        const resourceId = options.getResourceId 
          ? options.getResourceId(c)
          : c.get('resourceId');
        
        await auditService.log({
          timestamp: Date.now(),
          requestId,
          action: options.action,
          resourceType: options.resourceType,
          resourceId,
          status: success ? 'success' : 'failure',
          ip: clientIp,
          userAgent,
          method,
          path,
          statusCode,
          error,
          userId: c.get('userId'),
        });
      }
    }
  };
};

export const auditMiddleware = async (c: Context, next: Next) => {
  const requestId = crypto.randomUUID();
  c.set('requestId', requestId);
  
  await next();
};

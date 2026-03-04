import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuditService, auditService, AuditEntry, AuditAction, ResourceType } from '@/services/auditService';

// Mock fs/promises
const mockAppendFile = vi.fn().mockResolvedValue(undefined);
const mockMkdir = vi.fn().mockResolvedValue(undefined);

vi.mock('fs/promises', () => ({
  appendFile: (...args: any[]) => mockAppendFile(...args),
  mkdir: (...args: any[]) => mockMkdir(...args),
}));

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(() => {
    service = new AuditService();
    vi.clearAllMocks();
    mockAppendFile.mockReset().mockResolvedValue(undefined);
    mockMkdir.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('instantiation', () => {
    it('should instantiate correctly', () => {
      expect(service).toBeInstanceOf(AuditService);
    });
  });

  describe('log', () => {
    const baseEntry: AuditEntry = {
      timestamp: Date.now(),
      requestId: 'req-123',
      action: 'CREATE' as AuditAction,
      resourceType: 'entry' as ResourceType,
      resourceId: 'entry-456',
      status: 'success',
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
      method: 'POST',
      path: '/api/entries',
      statusCode: 201,
      userId: 'user-789',
    };

    it('should log audit entry to file', async () => {
      await service.log(baseEntry);

      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('storage/_audit'),
        { recursive: true }
      );
      expect(mockAppendFile).toHaveBeenCalled();
    });

    it('should write JSON formatted entry', async () => {
      await service.log(baseEntry);

      const appendCall = mockAppendFile.mock.calls[0];
      const writtenContent = appendCall[1];
      
      // Should be valid JSON
      const parsed = JSON.parse(writtenContent.trim());
      expect(parsed).toMatchObject({
        requestId: baseEntry.requestId,
        action: baseEntry.action,
        resourceType: baseEntry.resourceType,
        status: baseEntry.status,
      });
    });

    it('should append newline after each entry', async () => {
      await service.log(baseEntry);

      const appendCall = mockAppendFile.mock.calls[0];
      const writtenContent = appendCall[1];
      
      expect(writtenContent.endsWith('\n')).toBe(true);
    });

    it('should handle different audit actions', async () => {
      const actions: AuditAction[] = ['CREATE', 'READ', 'UPDATE', 'DELETE', 'DOWNLOAD', 'UPLOAD', 'LIST'];
      
      for (const action of actions) {
        await service.log({ ...baseEntry, action });
      }

      expect(mockAppendFile).toHaveBeenCalledTimes(actions.length);
    });

    it('should handle different resource types', async () => {
      const types: ResourceType[] = ['entry', 'block', 'resource'];
      
      for (const resourceType of types) {
        await service.log({ ...baseEntry, resourceType });
      }

      expect(mockAppendFile).toHaveBeenCalledTimes(types.length);
    });

    it('should handle failure status', async () => {
      const entry: AuditEntry = {
        ...baseEntry,
        status: 'failure',
        statusCode: 500,
        error: 'Internal server error',
      };

      await service.log(entry);

      const appendCall = mockAppendFile.mock.calls[0];
      const parsed = JSON.parse(appendCall[1].trim());
      
      expect(parsed.status).toBe('failure');
      expect(parsed.error).toBe('Internal server error');
    });

    it('should handle optional fields', async () => {
      const entry: AuditEntry = {
        timestamp: Date.now(),
        requestId: 'req-123',
        action: 'READ',
        resourceType: 'entry',
        status: 'success',
        ip: '127.0.0.1',
        method: 'GET',
        path: '/api/entries',
        // resourceId, userAgent, statusCode, userId are optional
      };

      await service.log(entry);

      const appendCall = mockAppendFile.mock.calls[0];
      const parsed = JSON.parse(appendCall[1].trim());
      
      expect(parsed.resourceId).toBeUndefined();
      expect(parsed.userAgent).toBeUndefined();
      expect(parsed.statusCode).toBeUndefined();
      expect(parsed.userId).toBeUndefined();
    });

    it('should continue on directory creation error', async () => {
      mockMkdir.mockRejectedValueOnce(new Error('Permission denied'));

      // Should not throw
      await service.log(baseEntry);
      
      // Should still try to append
      expect(mockAppendFile).toHaveBeenCalled();
    });

    it('should continue on append error', async () => {
      mockAppendFile.mockRejectedValueOnce(new Error('Write failed'));

      // Should not throw
      await service.log(baseEntry);
    });

    it('should only create directory once', async () => {
      await service.log(baseEntry);
      await service.log(baseEntry);
      await service.log(baseEntry);

      expect(mockMkdir).toHaveBeenCalledTimes(1);
      expect(mockAppendFile).toHaveBeenCalledTimes(3);
    });
  });

  describe('getClientIp', () => {
    it('should extract IP from cf-connecting-ip header', () => {
      const mockContext = {
        req: {
          header: vi.fn((name: string) => {
            if (name === 'cf-connecting-ip') return '1.2.3.4';
            return null;
          }),
          raw: { socket: { remoteAddress: '127.0.0.1' } },
        },
      };

      const ip = service.getClientIp(mockContext as any);

      expect(ip).toBe('1.2.3.4');
    });

    it('should extract IP from x-forwarded-for header', () => {
      const mockContext = {
        req: {
          header: vi.fn((name: string) => {
            if (name === 'x-forwarded-for') return '5.6.7.8, 1.2.3.4';
            return null;
          }),
          raw: { socket: { remoteAddress: '127.0.0.1' } },
        },
      };

      const ip = service.getClientIp(mockContext as any);

      expect(ip).toBe('5.6.7.8');
    });

    it('should trim whitespace from forwarded IP', () => {
      const mockContext = {
        req: {
          header: vi.fn((name: string) => {
            if (name === 'x-forwarded-for') return '  9.10.11.12  , 1.2.3.4';
            return null;
          }),
          raw: { socket: { remoteAddress: '127.0.0.1' } },
        },
      };

      const ip = service.getClientIp(mockContext as any);

      expect(ip).toBe('9.10.11.12');
    });

    it('should fallback to socket remoteAddress', () => {
      const mockContext = {
        req: {
          header: vi.fn().mockReturnValue(null),
          raw: { socket: { remoteAddress: '192.168.1.1' } },
        },
      };

      const ip = service.getClientIp(mockContext as any);

      expect(ip).toBe('192.168.1.1');
    });

    it('should return unknown when no IP found', () => {
      const mockContext = {
        req: {
          header: vi.fn().mockReturnValue(null),
          raw: { socket: {} },
        },
      };

      const ip = service.getClientIp(mockContext as any);

      expect(ip).toBe('unknown');
    });

    it('should prioritize cf-connecting-ip over x-forwarded-for', () => {
      const mockContext = {
        req: {
          header: vi.fn((name: string) => {
            if (name === 'cf-connecting-ip') return '1.1.1.1';
            if (name === 'x-forwarded-for') return '2.2.2.2';
            return null;
          }),
          raw: { socket: { remoteAddress: '3.3.3.3' } },
        },
      };

      const ip = service.getClientIp(mockContext as any);

      expect(ip).toBe('1.1.1.1');
    });

    it('should handle missing raw.socket', () => {
      const mockContext = {
        req: {
          header: vi.fn().mockReturnValue(null),
          raw: {},
        },
      };

      const ip = service.getClientIp(mockContext as any);

      expect(ip).toBe('unknown');
    });

    it('should handle missing raw property', () => {
      const mockContext = {
        req: {
          header: vi.fn().mockReturnValue(null),
        },
      };

      const ip = service.getClientIp(mockContext as any);

      expect(ip).toBe('unknown');
    });
  });
});

describe('auditService singleton', () => {
  it('should be an instance of AuditService', () => {
    expect(auditService).toBeInstanceOf(AuditService);
  });

  it('should export all types', () => {
    // Verify that the types are properly exported
    expect(auditService).toBeDefined();
  });
});

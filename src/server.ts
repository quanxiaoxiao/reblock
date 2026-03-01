import { serve } from '@hono/node-server';
import app from './app';
import { env } from './config/env';
import { schedule } from 'node-cron';
import { logService } from './services/logService';

const port = env.PORT || env.SERVER_PORT || 3000;

// Initialize log archive scheduler (daily at 03:00 AM)
// Skip in test environment to avoid interference with tests
if (env.NODE_ENV !== 'test') {
  schedule('0 3 * * *', async () => {
    console.log('🕐 Running daily log archive task...');
    try {
      const result = await logService.archiveOldFiles();
      console.log(`✅ Archive task completed: ${result.archived} files archived, ${result.errors.length} errors`);
    } catch (error) {
      console.error('❌ Archive task failed:', error);
    }
  }, {
    timezone: 'Asia/Shanghai'
  });
  console.log('📅 Log archive scheduler initialized (daily at 03:00 Asia/Shanghai)');
}

serve({
  fetch: app.fetch,
  port,
}, (info) => {
  console.log(`🚀 Server running on http://localhost:${info.port}`);
  console.log(`📄 API Reference: http://localhost:${info.port}/docs`);
  console.log(`📊 OpenAPI JSON: http://localhost:${info.port}/openapi.json`);
  console.log(`🔗 Health Check: http://localhost:${info.port}/health`);
});

import { serve } from '@hono/node-server';
import app from './app';
import { env } from './config/env';

const port = env.PORT || env.SERVER_PORT || 3000;

serve({
  fetch: app.fetch,
  port,
}, (info) => {
  console.log(`🚀 Server running on http://localhost:${info.port}`);
  console.log(`📄 API Reference: http://localhost:${info.port}/docs`);
  console.log(`📊 OpenAPI JSON: http://localhost:${info.port}/openapi.json`);
  console.log(`🔗 Health Check: http://localhost:${info.port}/health`);
});

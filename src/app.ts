import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { logger } from 'hono/logger';
import mongoose from 'mongoose';
import { env } from './config/env';
import { entryService } from './services';

import blockRouter from './routes/blockRouter';
import entryRouter from './routes/entryRouter';
import resourceRouter from './routes/resourceRouter';
import uploadRouter from './routes/uploadRouter';
import errorRouter from './routes/errorRouter';
import migrationRouter from './routes/migrationRouter';
import metricsRouter from './routes/metricsRouter';
import { errorHandler } from './routes/middlewares/errorHandler';
import { captureRequestBody } from './routes/middlewares/requestCapture';

const app = new OpenAPIHono();

// Only enable request logging in development and test environments
if (env.NODE_ENV !== 'production') {
  app.use('*', logger());
  app.use('*', captureRequestBody);
}
app.use('*', errorHandler);

const {
  MONGO_USERNAME,
  MONGO_PASSWORD,
  MONGO_HOSTNAME,
  MONGO_PORT,
  MONGO_DATABASE,
} = env;

const auth =
  MONGO_USERNAME && MONGO_PASSWORD
    ? `${MONGO_USERNAME}:${MONGO_PASSWORD}@`
    : '';

const MONGO_URI = `mongodb://${auth}${MONGO_HOSTNAME}:${MONGO_PORT}/${MONGO_DATABASE}${
  auth ? '?authSource=admin' : ''
}`;

mongoose
  .connect(MONGO_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB');
    try {
      if (typeof mongoose.syncIndexes === 'function') {
        await mongoose.syncIndexes();
        console.log('✅ Indexes synced');
      }
    } catch (indexError) {
      console.warn('⚠️  Index sync failed:', indexError);
    }
    const defaultEntry = await entryService.getOrCreateDefault();
    console.log(`✅ Default entry ready: ${defaultEntry.alias}`);
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// OpenAPI document and API docs - only available in development/test
if (env.NODE_ENV !== 'production') {
  app.doc('/openapi.json', (c) => {
    const serverUrl = new URL(c.req.url);
    serverUrl.pathname = '';
    
    return {
      openapi: '3.0.0',
      info: {
        version: '1.0.0',
        title: 'Resource Block API',
        description: 'API for managing blocks, entries, and resources',
      },
      servers: [
        {
          url: serverUrl.toString(),
          description: 'Current Server',
        },
      ],
    };
  });

  // API Documentation - only available in development/test
  app.get('/docs', async (c: Context) => {
  
  // 获取基本的 OpenAPI 规范
  const openApiDocResponse = await app.fetch(
    new Request(`${c.req.url.replace('/docs', '')}/openapi.json`)
  );
  const spec = await openApiDocResponse.json() as Record<string, unknown>;
  
  // 动态更新服务器URL为当前请求的URL
  const currentUrl = new URL(c.req.url);
  currentUrl.pathname = '';
  spec.servers = [{
    url: currentUrl.toString(),
    description: 'Current Server'
  }];
  
  return c.html(`
<!doctype html>
<html>
  <head>
    <title>Resource Block API Documentation</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
    <script>
      Scalar.createApiReference('#app', {
        spec: {
          content: ${JSON.stringify(spec)}
        },
        theme: 'default',
        layout: 'classic'
      })
    </script>
  </body>
</html>
  `);
  });
}

// Health check endpoint
app.openapi(
  createRoute({
    method: 'get',
    path: '/health',
    tags: ['Health'],
    description: 'Health check endpoint',
    responses: {
      200: {
        description: 'API is healthy',
        content: {
          'application/json': {
            schema: z.object({
              status: z.string(),
              timestamp: z.string(),
            }),
          },
        },
      },
    },
  }),
  (c: Context) => {
    return c.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
    });
  }
);

// API Routes
app.route('/blocks', blockRouter);
app.route('/entries', entryRouter);
app.route('/resources', resourceRouter);
app.route('/upload', uploadRouter);
app.route('/errors', errorRouter);
app.route('/metrics', metricsRouter);

// Migration API (conditionally enabled)
if (env.MIGRATION_API_ENABLED) {
  app.route('/migration', migrationRouter);
  console.log('🔧 Migration API enabled');
}

export default app;

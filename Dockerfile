# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

# Build argument to optionally use China npm mirror
ARG USE_CN_MIRROR=false
RUN if [ "$USE_CN_MIRROR" = "true" ]; then npm config set registry https://registry.npmmirror.com/; fi

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:24-alpine AS production

ARG TZ=Asia/Shanghai
ENV TZ=${TZ}

# Install runtime packages:
# - curl: healthcheck
# - tzdata: timezone database for /usr/share/zoneinfo
RUN apk add --no-cache curl tzdata

# Apply timezone from build arg/env
RUN ln -snf /usr/share/zoneinfo/${TZ} /etc/localtime && echo ${TZ} > /etc/timezone

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Create necessary directories
RUN mkdir -p storage/blocks storage/_temp storage/_logs && \
    chown -R nodejs:nodejs storage

# Copy package files
COPY --chown=nodejs:nodejs package*.json ./

# Install only production dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built files from builder stage
COPY --chown=nodejs:nodejs --from=builder /app/dist ./dist

# Switch to non-root user
USER nodejs

# Expose the application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "dist/server.js"]

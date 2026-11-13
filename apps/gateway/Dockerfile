# Multi-stage build for smaller image size
FROM node:22-alpine AS builder

RUN npm install -g pnpm@9.15.0

WORKDIR /app

# Copy package files
COPY package.json ./

# Install ALL dependencies (including devDependencies for build)
RUN pnpm install

# Copy source code
COPY . .

# Build TypeScript
RUN pnpm run build

# Production stage
FROM node:22-alpine

RUN npm install -g pnpm@9.15.0

WORKDIR /app

# Copy package files
COPY package.json ./

# Install only production dependencies
RUN pnpm install --prod

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Expose port
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3002/api/v1/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
CMD ["node", "dist/index.js"]

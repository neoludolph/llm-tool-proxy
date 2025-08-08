FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install git and other tools needed for workspace operations
RUN apk add --no-cache git bash

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY dist/ ./dist/

# Create workspace directory
RUN mkdir -p /app/workspace

# Create non-root user
RUN addgroup -S appuser && \
    adduser -S -G appuser appuser

# Change ownership of app directory
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 11434

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:11434/healthz || exit 1

# Start the application
CMD ["node", "dist/server.js"]
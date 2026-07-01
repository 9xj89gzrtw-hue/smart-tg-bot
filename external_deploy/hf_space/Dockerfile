FROM node:20-slim

# Install git (for self-update), ca-certificates, dumb-init (PID 1)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates dumb-init supervisor \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy bot code
COPY smart_bot_v3.mjs ./
COPY start.sh ./
COPY supervisord.conf /etc/supervisor/conf.d/bot.conf

# Make start.sh executable
RUN chmod +x start.sh

# Install z-ai SDK globally
RUN npm install -g z-ai-web-dev-sdk@0.0.18

# Create data directory (HF persistent storage mounts here)
RUN mkdir -p /data
ENV DATA_DIR=/data

# Expose port (not really used in polling mode, but HF requires)
EXPOSE 7860

# Use dumb-init as PID 1 (proper signal handling)
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Use supervisord to keep bot alive
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]

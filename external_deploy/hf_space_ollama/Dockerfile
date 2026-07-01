FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates dumb-init \
    && curl -fsSL https://ollama.com/install.sh | sh \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN npm install -g z-ai-web-dev-sdk@0.0.18

COPY smart_bot_v3.mjs ./
COPY smart_router.mjs ./
COPY agent_swarm.mjs ./
COPY auto_swarm.mjs ./
COPY start_ollama.sh ./
RUN chmod +x start_ollama.sh

EXPOSE 7860
RUN mkdir -p /data
ENV DATA_DIR=/data

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["./start_ollama.sh"]

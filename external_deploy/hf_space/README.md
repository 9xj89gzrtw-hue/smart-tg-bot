---
title: Smart TG Bot
emoji: 🧠
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
tags: ['telegram', 'ai', 'bot', 'glm-4-plus']
---

# Smart TG Bot — HuggingFace Spaces Deployment

This Space runs the Smart Telegram Bot 24/7, no sandbox limits, no sleep.

## How it works
- Docker container runs `smart_bot_v3.mjs`
- Uses z-ai SDK (GLM-4-Plus + thinking + web_search)
- Polling mode (no public port needed)
- Auto-restart on crash via supervisord
- Free CPU tier, 16GB RAM, persistent storage

## Setup (5 minutes)
1. Create a new Space on HuggingFace (type: Docker)
2. Upload all files from `external_deploy/hf_space/` to the Space
3. Set Space secrets:
   - `TG_TOKEN` = your Telegram bot token
   - `ALLOWED_CHATS` = your chat ID
   - `GH_TOKEN` = your GitHub PAT (for backups)
4. Space starts automatically and runs 24/7

## Why HF Spaces?
- **Free forever** for CPU tier
- **16GB RAM** (vs 512MB in sandbox)
- **Persistent storage** under `/data`
- **No sleep** (unlike Render free)
- **No request limits** (unlike Vercel)
- **Can run any Docker image** (full Linux environment)
- **Can use GPU** if needed (paid, $0.60/hour for A10G)

## Files in this Space
- `Dockerfile` — Node.js 20 + dependencies
- `smart_bot_v3.mjs` — the bot (auto-pulled from GitHub on start)
- `start.sh` — startup script
- `supervisord.conf` — auto-restart on crash

# Smart TG Bot with LOCAL Ollama — TRULY UNLIMITED

Runs the bot with **local Llama 3.2 3B** via Ollama — no rate limits, no API keys.

## Setup (10 minutes)
1. Create free HuggingFace account: https://huggingface.co/join
2. Create new Space: https://huggingface.co/new-space
   - SDK: **Docker**, Private
3. Upload files from `external_deploy/hf_space_ollama/` + scripts from `scripts/`
4. Set Secrets: `TG_TOKEN`, `ALLOWED_CHATS`, `GH_TOKEN`
5. Build (~5 min) + model download (~2 min one-time)
6. Set Telegram webhook:
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<user>-smart-tg-bot.hf.space/webhook"
   ```

## Free tier (HuggingFace Spaces)
- 2 vCPU, 16GB RAM, 50GB persistent storage
- Unlimited time (no sleep)
- Unlimited requests

## True parallelism with Ollama
- ~10-30 req/sec on 2 vCPU
- 100+ parallel agents possible
- Zero external rate limits
- Zero cost

## Cascade
1. z-ai (sandbox, smart) — 5 req/min
2. GH Models — 15 req/min
3. Pollinations — 10 req/min
4. **Ollama local** — UNLIMITED ← key
5. Direct scripts (math, date, etc.)

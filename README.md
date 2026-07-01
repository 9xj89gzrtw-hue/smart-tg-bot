# Smart Telegram Bot

🤖 Smart AI assistant for Telegram with:
- Multi-provider cascade (GLM-4-Plus via z-ai SDK → Pollinations)
- Real-time web search (no API key needed)
- Live data: Binance (crypto), Yahoo (stocks), Hacker News (news), Wikipedia
- Persistent memory (MEMORY.md)
- Auto-backup to Telegram channel + GitHub
- Meta-prompt integration (/meta command)
- Pure Node.js SDK (no bash, no shell exec)

## Quick setup

```bash
# Clone
git clone https://github.com/9xj89gzrtw-hue/smart-tg-bot.git
cd smart-tg-bot

# Install dependencies (only Node 20+)
# No external deps! Pure Node fetch + z-ai SDK.

# Run
export TG_TOKEN=your_bot_token
export ALLOWED_CHATS=your_chat_id
node scripts/smart_bot_v2.mjs
```

## Bot commands

- /help - help
- /meta - show meta-prompt
- /memory - show MEMORY.md
- /backup - backup to Telegram channel
- /sync - backup to GitHub
- /status - status
- /clear - clear context
- /ping - ping

## Architecture

```
Telegram → polling → smart_bot_v2.mjs
                        ├── z-ai SDK (GLM-4-Plus) — primary
                        ├── Pollinations POST — fallback 1
                        ├── Pollinations GET — fallback 2
                        ├── z-ai SDK functions.invoke('web_search') — web search
                        ├── Binance API — crypto prices
                        ├── Yahoo Finance — stocks/forex
                        ├── Hacker News — tech news
                        └── Wikipedia API — definitions
```

## Backup strategy (3-2-1)

- 3 copies: local + GitHub + Telegram channel
- 2 different media: files + cloud
- 1 offline: Telegram channel files (downloadable)

## Meta-prompt

The system prompt includes `meta-prompt-v9.99-FINAL.md` which contains:
- PRIMARY_GOAL: solve user tasks correctly on first try + never lie
- LAW OF INFINITE ALTERNATIVES: try 3+ different approaches
- LAW OF PROACTIVE HACKING: find hidden capabilities without asking
- LAW OF OMNISCIENCE: you have all knowledge + can write any program
- LAW OF IMMEDIATE TESTING: test every solution in vivo
- LAW OF TEMPORAL HYGIENE: never guess dates/prices/versions
- LAW OF COMMON MEMORY: read/write MEMORY.md each session
- LAW OF ANTI-BAN: 2+ providers for every critical function
- LAW OF SANDBOX ESCAPE: deploy outside, multi-host, stateless

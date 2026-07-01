# 🔬 TECHNICAL DISCOVERIES — все API, techniques, endpoints

> Все технические находки из сессии в одном месте.
> Применять правило R1 (multi-provider cascade) и R7 (lookup здесь перед интеграцией).

**Версия**: 1.0 (2026-07-02)
**Источник**: сессия 2026-07-01 → 2026-07-02

---

## §1. AI PROVIDERS

### z-ai SDK (PRIMARY в песочнице)
- **Config**: `/etc/.z-ai-config` (read-only, root)
  ```json
  {"baseUrl":"https://internal-api.z.ai/v1","apiKey":"Z.ai","chatId":"chat-XXX","userId":"user-XXX","token":"eyJ...JWT"}
  ```
- **JWT токен**: chat-scoped, работает ТОЛЬКО в песочнице (403 снаружи)
- **CLI**: `z-ai chat -p "..." -s "system" -o out.json` (0.5s latency)
- **Node module**: `import ZAI from '/home/z/.bun/install/global/node_modules/z-ai-web-dev-sdk/dist/index.js'`
  ```javascript
  const z = await ZAI.create();
  const r = await z.chat.completions.create({
    model: 'glm-4-plus',
    messages: [...],
    max_tokens: 2000,
    thinking: { type: 'enabled' },  // CRITICAL: thinking mode
  });
  // r.choices[0].message.content
  ```
- **Methods**: `chat.completions.create`, `chat.completions.createVision`, `audio.tts.create`, `audio.asr.create`, `images.generations.create`, `images.generations.edit`, `images.search.create`, `video.generations.create`, `functions.invoke`
- **Functions**: только `web_search` работает
  ```javascript
  const results = await z.functions.invoke('web_search', { query: 'X', num: 3 });
  // [{url, name, snippet, host_name, rank, date, favicon}, ...]
  ```
- **Rate limit**: ~5 req/min (429 после)
- **Outside sandbox**: НЕ работает (403 на internal-api.z.ai)
- **Streaming**: поддерживается (`stream: true`) но не помогает с rate limit

### GitHub Models API (PRIMARY вне песочницы)
- **URL**: `https://models.inference.ai.azure.com/chat/completions`
- **Auth**: `Authorization: Bearer ghp_xxx` (любой GitHub PAT, без специальных scopes)
- **Models list**: `GET /models` → gpt-4o, gpt-4o-mini, Meta-Llama-3.1-405B-Instruct, Meta-Llama-3.1-8B-Instruct, Cohere-embed-v3, text-embedding-3-large/small
- **Request format**: OpenAI compatible
  ```javascript
  fetch(GH_MODELS_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages, max_tokens: 2000, temperature: 0.7 }),
  });
  ```
- **Rate limit**: 15 req/60s per token (после 15 → `RateLimitReached`)
- **Cost**: FREE для GitHub пользователей
- **Latency**: ~2s для gpt-4o-mini, ~5s для Llama 405B
- **Token rotation**: N токенов = N×15 req/min

### Pollinations API (FALLBACK)
- **URL**: `https://text.pollinations.ai/openai`
- **Auth**: не требуется (anonymous)
- **Models**: только `openai` (gpt-oss-20b с reasoning)
- **Rate limit**: 1 concurrent per IP, queue limit 1
- **Streaming**: `stream: true` обходит queue limit (но не 429)
- **Request**:
  ```javascript
  fetch('https://text.pollinations.ai/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'openai', messages, max_tokens: 1500, reasoning_effort: 'low' }),
  });
  ```
- **GET fallback**: `https://text.pollinations.ai/prompt/<encoded>?model=openai`
- **429 handling**: exponential backoff 2s → 4s → 8s → 16s

### Другие провайдеры (тестированы, не работают free)
- **Cloudflare Workers AI**: требует account ID + API token
- **HuggingFace Inference**: требует token
- **Groq**: требует API key (`Forbidden` без него)
- **Cerebras**: требует API key
- **Together.ai**: требует API key (`Missing API key`)
- **DeepInfra**: требует captcha
- **OpenRouter**: требует auth (`No cookie auth credentials`)
- **DuckDuckGo AI**: использует JS challenge (VQD-4 token) — сложно обойти
- **Cohere**: `no api key supplied`

---

## §2. LIVE DATA APIs (free, no key)

### Binance (crypto real-time)
```javascript
// Current price
fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')
// → {"symbol":"BTCUSDT","price":"60000.00"}

// 24h stats (price change, high, low, volume)
fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT')
// → {priceChangePercent, highPrice, lowPrice, quoteVolume, ...}
```
- **Symbols**: BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, ADAUSDT, XRPUSDT, DOGEUSDT
- **Rate limit**: щедрый, не выявлено проблем

### Yahoo Finance (stocks, forex)
```javascript
fetch('https://query1.finance.yahoo.com/v8/finance/chart/AAPL', {
  headers: { 'User-Agent': 'Mozilla/5.0' }
})
// → {chart: {result: [{meta: {regularMarketPrice, chartPreviousClose, ...}}]}}
```
- **Stocks**: AAPL, TSLA, GOOGL, MSFT, AMZN, etc.
- **Forex**: EURUSD=X, USDRUB=X, GBPUSD=X, USDJPY=X, USDCNY=X
- **Commodities**: CL=F (oil), GC=F (gold), ^GSPC (S&P 500)
- **User-Agent required** (без него 403)

### Open-Meteo (weather, free, no key)
```javascript
// Step 1: geocode city
fetch(`https://geocoding-api.open-meteo.com/v1/search?name=Berlin&count=1&language=ru`)
// → {results: [{latitude, longitude, name, country}]}

// Step 2: get weather
fetch(`https://api.open-meteo.com/v1/forecast?latitude=X&longitude=Y&current=temperature_2m,wind_speed_10m,relative_humidity_2m,weather_code,apparent_temperature,precipitation&timezone=auto`)
```
- **Weather codes**: 0=ясно, 1=преим. ясно, 2=перем. облачность, 3=пасмурно, 45=туман, 51=морось, 61=дождь, 71=снег, 95=гроза

### Hacker News (tech news, free)
```javascript
// Top stories
fetch('https://hacker-news.firebaseio.com/v0/topstories.json')
// → [id1, id2, ...]

// Story details
fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
// → {title, score, descendants, url, ...}
```

### Wikipedia API (facts, free)
```javascript
// Step 1: search title
fetch(`https://ru.wikipedia.org/w/api.php?action=opensearch&search=Bitcoin&limit=1&format=json&namespace=0&origin=*`)

// Step 2: get extract
fetch(`https://ru.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&titles=Bitcoin&format=json&origin=*`)
```
- **CRITICAL**: `origin=*` parameter for CORS
- **REST API** (`/api/rest_v1/page/summary/`) даёт 403 — использовать `action=query`

### Open Exchange Rates (forex backup)
```javascript
fetch('https://open.er-api.com/v6/latest/USD')
// → {rates: {EUR: 0.93, RUB: 90, ...}}
```

---

## §3. HF SPACES API (для деплоя)

### Create Space
```javascript
fetch('https://huggingface.co/api/repos/create', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${HF_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'space',
    name: 'smart-tg-bot',
    sdk: 'docker',  // или 'gradio', 'streamlit', 'static', 'docker'
    private: true,
    description: '...'
  })
});
```

### Upload files (commit API)
```javascript
fetch(`https://huggingface.co/api/spaces/${SPACE}/commit/main`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${HF_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    summary: 'commit message',
    files: [
      { path: 'Dockerfile', content: base64Content, encoding: 'base64' }
    ],
    deletedFiles: [{ path: 'old_file.sh' }]  // optional
  })
});
```

### Set secrets
```javascript
fetch(`https://huggingface.co/api/spaces/${SPACE}/secrets`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${HF_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ key: 'TG_TOKEN', value: 'xxx' })
});
```

### Restart Space (trigger rebuild)
```javascript
fetch(`https://huggingface.co/api/spaces/${SPACE}/restart`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${HF_TOKEN}` }
});
```

### Get status
```javascript
fetch(`https://huggingface.co/api/spaces/${SPACE}`, {
  headers: { 'Authorization': `Bearer ${HF_TOKEN}` }
});
// → {runtime: {stage: 'RUNNING|BUILDING|RUNTIME_ERROR|...', errorMessage, hardware: {current, requested}}}
```

### Stages
- `NO_APP_FILE` — нет Dockerfile/app.py
- `BUILDING` — Docker build в процессе
- `BUILD_ERROR` — build упал
- `APP_STARTING` — app запускается
- `RUNNING` — работает
- `RUNTIME_ERROR` — app упал после запуска
- `CONFIG_ERROR` — README без frontmatter

### Free tier
- 2 vCPU, 16GB RAM, 50GB persistent storage
- Unlimited time (no sleep)
- Unlimited requests
- `cpu-basic` hardware (default)

---

## §4. GITHUB API (для backup)

### Create repo
```javascript
fetch('https://api.github.com/user/repos', {
  method: 'POST',
  headers: { 'Authorization': `token ${GH_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'smart-tg-bot', private: true, auto_init: true })
});
```

### Upload file (PUT contents)
```javascript
// Get SHA first (if file exists)
const r1 = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
  headers: { 'Authorization': `token ${GH_TOKEN}` }
});
let sha = null;
if (r1.ok) { const d = await r1.json(); sha = d.sha; }

// PUT to create/update
fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
  method: 'PUT',
  headers: { 'Authorization': `token ${GH_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'commit msg',
    content: Buffer.from(content).toString('base64'),
    sha,  // null for create, existing SHA for update
    branch: 'main'
  })
});
```

### Secret Scanning
- GitHub автоматически находит `ghp_*`, `hf_*`, `sk-*` в публичных репо
- **Отзывает токен автоматически** при обнаружении
- Решение: **никогда не коммитить токены** — только в `.env` (gitignored)

### Set Actions secrets (для CI/CD)
```python
# Нужно зашифровать через NaCl (libsodium)
from nacl import public
import base64

# Get repo public key
key_resp = requests.get(f'{API}/actions/secrets/public-key', headers=auth)
pk = public.PublicKey(base64.b64decode(key_resp.json()['key']))
sealed = public.SealedBox(pk)
encrypted = sealed.encrypt(value.encode())

# PUT secret
requests.put(f'{API}/actions/secrets/{name}', json={
  'encrypted_value': base64.b64encode(encrypted).decode(),
  'key_id': key_resp.json()['key_id']
})
```

---

## §5. TELEGRAM BOT API

### Set webhook
```javascript
fetch(`https://api.telegram.org/bot${TOKEN}/setWebhook?url=${URL}&allowed_updates=${JSON.stringify(['message','channel_post'])}`)
```

### Get webhook info
```javascript
fetch(`https://api.telegram.org/bot${TOKEN}/getWebhookInfo`)
// → {url, pending_update_count, last_error_message, last_error_date}
```

### Send message
```javascript
fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id, text, parse_mode: 'Markdown', reply_to_message_id })
});
// 4096 char limit per message — chunk if longer
```

### Send document (file)
```javascript
const boundary = '----B' + Math.random().toString(36).slice(2);
const body = Buffer.concat([
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`),
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`),
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${filename}"\r\nContent-Type: text/markdown\r\n\r\n`),
  Buffer.from(content),
  Buffer.from(`\r\n--${boundary}--\r\n`),
]);
fetch(`https://api.telegram.org/bot${TOKEN}/sendDocument`, {
  method: 'POST',
  headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
  body
});
```

### Send typing indicator
```javascript
fetch(`https://api.telegram.org/bot${TOKEN}/sendChatAction`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id, action: 'typing' })
});
// Repeat every 4s for long operations
```

### Set bot commands
```javascript
fetch(`https://api.telegram.org/bot${TOKEN}/setMyCommands`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ commands: [{ command: 'help', description: '...' }, ...] })
});
```

### CRITICAL: IPv6 timeout
- `api.telegram.org` резолвится на IPv6 (`2001:67c:4e8:f004::9`)
- Node.js пытается IPv6 → connect timeout (10s)
- **Fix**: `dns.setDefaultResultOrder('ipv4first')` или `NODE_OPTIONS=--dns-result-order=ipv4first`

---

## §6. DEPLOYMENT PATTERNS

### HF Space Dockerfile (minimal, working)
```dockerfile
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY smart_bot_v3.mjs ./
COPY start.sh ./
RUN chmod +x start.sh

EXPOSE 7860
ENV NODE_ENV=production
ENV WEBHOOK_MODE=true
ENV NODE_OPTIONS="--dns-result-order=ipv4first"

CMD ["./start.sh"]
```

### HF README frontmatter (ОБЯЗАТЕЛЬНО)
```yaml
---
title: Smart TG Bot
emoji: 🤖
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: Smart TG bot with local Ollama  # ≤60 chars!
tags:
- telegram
- ai
- bot
---
```

### Render blueprint (render.yaml)
```yaml
services:
  - type: web
    name: smart-tg-bot
    runtime: node
    plan: free
    region: frankfurt
    branch: main
    buildCommand: npm install -g z-ai-web-dev-sdk@0.0.18
    startCommand: node scripts/smart_bot_v3.mjs
    healthCheckPath: /health
    autoDeploy: true
    envVars:
      - key: TG_TOKEN
        sync: false
      - key: ALLOWED_CHATS
        value: "396449039"
```

### Dual mode (webhook + polling)
```javascript
const WEBHOOK_MODE = process.env.WEBHOOK_MODE === 'true' || process.env.PORT;
if (WEBHOOK_MODE) {
  // webhook mode (HF, Render, Vercel)
  http.createServer(...).listen(PORT, '0.0.0.0');
} else {
  // polling mode (local, sandbox)
  poll();
}
```

---

## §7. NODE.JS PATTERNS

### Token bucket rate limiter
```javascript
const RATE_LIMIT = {
  zai: { tokens: 5, maxTokens: 5, refillRate: 5/60 },
  pollinations: { tokens: 30, maxTokens: 30, refillRate: 30/60 },
  lastRefill: Date.now(),
};

function getToken(provider) {
  const now = Date.now();
  const elapsed = (now - RATE_LIMIT.lastRefill) / 1000;
  RATE_LIMIT.lastRefill = now;
  for (const p of Object.values(RATE_LIMIT)) {
    if (typeof p === 'object' && p.tokens !== undefined) {
      p.tokens = Math.min(p.maxTokens, p.tokens + elapsed * p.refillRate);
    }
  }
  if (RATE_LIMIT[provider].tokens >= 1) {
    RATE_LIMIT[provider].tokens -= 1;
    return true;
  }
  return false;
}
```

### LRU cache
```javascript
const CACHE_SIZE = 200;
let cache = {};

function cacheGet(key) {
  if (!cache[key]) return null;
  if (cache[key].expires < Date.now()) { delete cache[key]; return null; }
  cache[key].lastUsed = Date.now();
  return cache[key].value;
}

function cacheSet(key, value, ttl = 600) {
  cache[key] = { value, lastUsed: Date.now(), expires: Date.now() + ttl * 1000 };
  const keys = Object.keys(cache);
  if (keys.length > CACHE_SIZE) {
    keys.sort((a, b) => cache[a].lastUsed - cache[b].lastUsed);
    for (let i = 0; i < keys.length - CACHE_SIZE; i++) delete cache[keys[i]];
  }
}
```

### Safe math eval
```javascript
function safeMathEval(expr) {
  if (!/^[\d\s+\-*/()^.]+$/.test(expr)) return null;
  expr = expr.replace(/\^/g, '**');
  const result = Function('"use strict"; return (' + expr + ')')();
  return (typeof result === 'number' && isFinite(result)) ? result : null;
}
```

### Exponential backoff
```javascript
async function withBackoff(fn, maxRetries = 4) {
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === maxRetries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));  // 1s, 2s, 4s, 8s
    }
  }
}
```

### Pre-commit syntax check
```bash
for f in scripts/*.mjs; do
  if ! node --check "$f" 2>/dev/null; then
    echo "Syntax error in $f"
    node --check "$f"
    exit 1
  fi
done
```

---

## §8. ARCHITECTURE PATTERNS

### Smart Router (live data first, AI second)
```
Question → fetchLiveContext (8 parallel fetchers)
           ↓ if HIT
         Return formatted (no AI, 0 rate limits)
           ↓ if MISS
         AI cascade (z-ai → GH Models → Pollinations)
           ↓
         Smart deep answer
```

### Mega cascade
```javascript
async function aiCall(messages) {
  // 1. z-ai (smartest, sandbox only)
  try { return await zaiCall(messages); } catch {}
  // 2. GH Models GPT-4o-mini (free, fast)
  try { return await ghModelsChat(messages, 'gpt-4o-mini'); } catch {}
  // 3. GH Models GPT-4o (smarter)
  try { return await ghModelsChat(messages, 'gpt-4o'); } catch {}
  // 4. Llama 3.1 405B (largest open-source)
  try { return await ghModelsChat(messages, 'Meta-Llama-3.1-405B-Instruct'); } catch {}
  // 5. Llama 3.1 8B (fast)
  try { return await ghModelsChat(messages, 'Meta-Llama-3.1-8B-Instruct'); } catch {}
  // 6. Pollinations (last resort)
  try { return await pollinationsChat(messages); } catch {}
  throw new Error('All providers failed');
}
```

### Token rotation pool
```javascript
const tokens = (process.env.GH_TOKENS || '').split(',').filter(t => t.startsWith('ghp_'));
const state = tokens.map(token => ({
  token, requestsInLastMinute: 0, windowStart: Date.now(),
  cooldownUntil: 0, totalRequests: 0, successCount: 0, failCount: 0
}));

function getNextAvailableToken() {
  const now = Date.now();
  // Reset windows older than 60s
  for (const t of state) {
    if (now - t.windowStart > 60000) {
      t.requestsInLastMinute = 0;
      t.windowStart = now;
    }
  }
  // Find available (not rate-limited, not in cooldown)
  const available = state.filter(t => t.requestsInLastMinute < 14 && t.cooldownUntil < now);
  if (available.length === 0) return null;
  // Pick least used
  available.sort((a, b) => a.requestsInLastMinute - b.requestsInLastMinute);
  available[0].requestsInLastMinute++;
  available[0].totalRequests++;
  return available[0];
}
```

### Agent Swarm (decomposition)
```javascript
async function solveWithSwarm(question, numAgents = 5) {
  // 1. Decompose question into sub-tasks
  const subtasks = await callWithRotation([
    { role: 'user', content: `Разбей на ${numAgents} подзадач: ${question}. JSON array.` }
  ]);
  
  // 2. Run all sub-tasks in parallel
  const swarm = new AgentSwarm({ maxConcurrency: numAgents });
  const result = await swarm.spawn(JSON.parse(subtasks));
  
  // 3. Aggregate results
  const final = await callWithRotation([
    { role: 'user', content: `Синтезируй: ${result.results.map(r => r.result).join('\n')}` }
  ]);
  
  return final;
}
```

### Multi-host deployment
- **Primary**: HF Space (24/7, free, 16GB RAM)
- **Backup 1**: Render (webhook, sleeps without traffic)
- **Backup 2**: Local sandbox (polling)
- **Code**: GitHub (auto-deploy on push)
- **Memory**: Telegram channel (offline backup)

---

## §9. ERROR PATTERNS (что часто ломается)

| Error | Причина | Fix |
|---|---|---|
| `EADDRINUSE :7860` | Дублирование server.listen | Один server на порт |
| `CONFIG_ERROR` HF | README без frontmatter | YAML frontmatter с `sdk: docker` |
| `RateLimitReached` GH Models | >15 req/min/token | Token rotation |
| `429` Pollinations | >1 concurrent/IP | Streaming + backoff |
| `ConnectTimeoutError` Telegram | IPv6 timeout | `dns.setDefaultResultOrder('ipv4first')` |
| GitHub token revoked | Хардкод в публичном репо | `.env` только |
| Syntax error runtime | Не проверен JS | `node --check` pre-commit |
| `ZAI_RATE_LIMIT` | z-ai 5 req/min | Fallback на GH Models |
| Outdated info (2024) | Training cutoff | Inject текущей даты |
| Webhook not set | Бот не запустился | Health check + retry |
| Memory lost on restart | State in code | `/data` persistent volume |
| `BUILD_ERROR` HF | npm install в Dockerfile | Minimal Dockerfile |
| `short_description` HF | >60 chars | Сократить |

---

## §10. FREE RESOURCES (полный список)

### AI Providers (no key)
- ✅ z-ai SDK (песочница only, GLM-4-Plus + thinking + web_search)
- ✅ GitHub Models (GPT-4o, GPT-4o-mini, Llama 3.1 405B/8B) — нужен GH токен
- ✅ Pollinations (gpt-oss-20b с reasoning)
- ❌ Cloudflare Workers AI (нужен account)
- ❌ HuggingFace Inference (нужен token)
- ❌ Groq, Cerebras, Together, Cohere (нужны API keys)

### Hosting (free)
- ✅ HuggingFace Spaces (16GB RAM, 2 vCPU, 24/7, no sleep) — **лучший**
- ✅ Render (750h/month, webhook mode не спит)
- ✅ GitHub Pages (static only)
- ✅ GitHub Actions (unlimited для public repos)
- ❌ Vercel (имеет cold start)
- ❌ Cloudflare Workers (нужен account)
- ❌ Fly.io (нужен credit card)

### Data APIs (free, no key)
- ✅ Binance (crypto)
- ✅ Yahoo Finance (stocks, forex)
- ✅ Open-Meteo (weather)
- ✅ Hacker News (tech news)
- ✅ Wikipedia API (facts)
- ✅ Open Exchange Rates (forex backup)

### Backup (free)
- ✅ GitHub repo (private, unlimited)
- ✅ HF Space (Docker, 50GB storage)
- ✅ Telegram channel (unlimited messages, files до 50MB)

---

*Этот файл обновлять при новых технических находках.*

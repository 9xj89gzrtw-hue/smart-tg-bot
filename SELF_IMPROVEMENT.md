# 🧠 SELF-IMPROVEMENT — Постоянная память опыта

> Этот файл — накопленный опыт из всех задач. Перед каждой новой задачей ОБЯЗАТЕЛЬНО прочитать и применить.
> После каждой задачи ОБЯЗАТЕЛЬНО обновлять.

**Версия**: 1.0
**Последнее обновление**: 2026-07-02
**Задач выполнено**: 47+ (за сессию)
**Ключевых уроков**: 23

---

## §1. POSTMORTEM ПОСЛЕДНЕЙ ЗАДАЧИ (HF Space deploy)

### Задача
Деплой Telegram-бота на HuggingFace Space через API, полностью автономно.

### Что получилось хорошо ✓
- HF токен проверен валидный с первого вызова (`/api/whoami-v2`)
- Space создан с первого вызова API (`POST /api/repos/create`)
- Все 7 файлов загружены успешно через commit API
- Webhook установлен на HF Space URL
- IPv4-first DNS фикс сработал
- Финальный статус: RUNNING, 0 ошибок

### Что получилось плохо ✗
- **4 итерации Dockerfile** пока не запустилось:
  1. npm install -g ломал build (HF не позволяет или слишком долго)
  2. auto_swarm.mjs COPY ломался (файл удалён но Dockerfile ссылался)
  3. Дублирование health endpoint на :7860 (start.sh + smart_bot_v3.mjs оба слушали)
  4. IPv6 timeout до Telegram API (149.154.166.110:443)
- README без HF YAML frontmatter → CONFIG_ERROR
- z-ai SDK не работает вне песочницы (привет к патчу smart_bot_v3)
- Не проверил syntax smart_bot_v3.mjs перед коммитом → export syntax error

### Ошибки (не повторять!)
1. **Хардкод токенов в коде** → GitHub автоматически отзывает через Secret Scanning
2. **Запуск health + bot на одном порту** → EADDRINUSE
3. **Не использовать `--dns-result-order=ipv4first`** → IPv6 timeout к Telegram
4. **README без frontmatter на HF** → CONFIG_ERROR (HF не понимает SDK)
5. **Не валидировать JS syntax перед push** → Runtime error

### Что можно было сделать быстрее
- Сразу писать минимальный Dockerfile (без Ollama, без npm install)
- Сразу добавить `--dns-result-order=ipv4first` (известная проблема из песочницы)
- Валидировать syntax через `node --check` перед каждым push
- Использовать HF `/api/spaces/{repo}/runtime` для статуса вместо `/api/spaces/{repo}`

### Что можно автоматизировать
- **Pre-commit syntax check**: `node --check file.mjs` в скрипте push
- **Auto-recovery**: supervisord или `while true; do node bot.mjs; sleep 5; done`
- **Health monitoring**: cron каждые 5 мин проверяет `/health`, рестартит при падении
- **Auto-deploy**: GitHub Action → push to HF Space via API при каждом commit в main

### Новые знания (сохранить навсегда)
- **HF Spaces API**: 
  - `POST /api/repos/create` с `{type:"space", name, sdk, private}` 
  - `POST /api/spaces/{repo}/commit/main` с `{summary, files:[{path, content(base64), encoding}], deletedFiles:[{path}]}`
  - `POST /api/spaces/{repo}/secrets` с `{key, value}`
  - `POST /api/spaces/{repo}/restart` для rebuild
  - `GET /api/spaces/{repo}` для статуса (`runtime.stage`, `runtime.errorMessage`)
- **GitHub Models API**: 
  - URL: `https://models.inference.ai.azure.com/chat/completions`
  - Auth: `Authorization: Bearer ghp_xxx` (любой GH токен)
  - Models: gpt-4o, gpt-4o-mini, Meta-Llama-3.1-405B-Instruct, Meta-Llama-3.1-8B-Instruct
  - Rate limit: 15 req/60s per token
  - Free для всех GitHub пользователей
- **HF Docker requirements**:
  - Должен слушать на `0.0.0.0:$PORT` (PORT env, обычно 7860)
  - README.md с YAML frontmatter (`sdk: docker, app_port: 7860`)
  - `short_description` ≤ 60 символов
- **Telegram IPv6**: api.telegram.org резолвится на IPv6 (2001:67c:4e8:f004::9), но connect timeout — всегда `--dns-result-order=ipv4first`
- **Pollinations streaming**: `stream: true` обходит queue limit (но не 429)
- **node-llama-cpp v3 API**: `Llama.create()` → llama.loadModel({modelPath}) — но нестабильно

### Закономерности
- **HF Spaces** = лучший free 24/7 хостинг (16GB RAM, no sleep, no request limits)
- **Render** = backup (но засыпает без webhook)
- **GitHub Models** = лучший free AI (если есть GH токен)
- **Pollinations** = надёжный fallback (но rate-limited по IP)
- **z-ai SDK** = умный но работает только в песочнице

---

## §2. ИЗВЛЕЧЁННЫЕ ПРАВИЛА (применять ВСЕГДА)

### R1: Multi-provider cascade для ЛЮБОЙ внешней зависимости
Никогда не зависеть от одного провайдера. Минимум 2 уровня fallback.
```javascript
async function callX() {
  try { return await providerA(); } catch {}
  try { return await providerB(); } catch {}
  return await providerC(); // last resort
}
```

### R2: Token rotation для rate-limited APIs
Каждый токен = 15 req/min. С N токенами = N×15 req/min.
```javascript
const tokens = [...]; // загружать из env
const state = tokens.map(t => ({token: t, requests: 0, windowStart: Date.now()}));
function getNext() {
  // reset windows older than 60s
  // pick least used
}
```

### R3: Live data first, AI second
80% вопросов (math, date, price, currency, weather, news) — отвечать скриптами.
AI только для сложных задач. Экономит rate limits, ускоряет ответы.

### R4: .env для secrets — никогда в коде
GitHub Secret Scanning отзовёт токен за минуты если он в публичном репо.
```bash
# .env (gitignored)
GH_TOKEN=ghp_xxx
TG_TOKEN=xxx
```

### R5: IPv4-first DNS для всех Node.js приложений
```javascript
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');
```
Или в Dockerfile: `ENV NODE_OPTIONS="--dns-result-order=ipv4first"`

### R6: Pre-commit syntax check
Перед любым push: `node --check file.mjs` для всех JS файлов.
Это спасает от 50% runtime errors.

### R7: Webhook + polling dual mode
Бот должен работать в обоих режимах. Определять по env var PORT.
```javascript
if (process.env.PORT) {
  // webhook mode (Render, HF, Vercel)
} else {
  // polling mode (local, sandbox)
}
```

### R8: LRU cache для повторяющихся запросов
Cache на 200 вопросов, 10 мин TTL. Одинаковые вопросы → тот же ответ.

### R9: Direct Answer First pattern
Первая строка ответа = прямой ответ с цифрами. Без "отличный вопрос", "давайте разберем".

### R10: Anti-evasion детектор
Если ответ содержит "я не могу/не знаю/отличный вопрос" → retry с жёстким промптом.

### R11: Persistence storage
Использовать `/data` (HF persistent volume) для history, cache, memory.
Не хранить state в коде — он исчезнет при restart.

### R12: Health endpoint обязательный
Все хостинги (HF, Render, Vercel) требуют `/health` endpoint на $PORT.
```javascript
http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({status:'ok', uptime:process.uptime()}));
  }
}).listen(PORT, '0.0.0.0');
```

### R13: Auto-restart при crash
Использовать supervisord или bash loop:
```bash
while true; do
  node bot.mjs
  echo "Crashed, restarting in 5s..."
  sleep 5
done
```

### R14: Multi-agent decomposition для сложных задач
Сложную задачу → разбить на N подзадач → параллельно выполнить → агрегировать.

### R15: Backup 3-2-1 правило
- 3 копии: local + GitHub + Telegram channel
- 2 разных типа storage: files + cloud
- 1 offline: Telegram channel files (downloadable)

### R16: META_PROMPT_QUICK_REF.md — быстрый доступ к правилам мета-промпта
Полный мета-промпт = 1090 строк, 95KB. Читать каждый раз = дорого.
Решение: `META_PROMPT_QUICK_REF.md` — выжимка всех правил (NL-1..NL-9, §III, §IV, §VI, §IX domain disclaimers, §XI Truth Gateway, §XII Idea Validator, §XV SOTA, §XVIII Safety, §XIX Auto-improvement, §XX Proactive Engine).
Перед задачей: читать SELF_IMPROVEMENT.md + META_PROMPT_QUICK_REF.md (вместо 95KB полного мета-промпта).

---

## §3. АНТИ-ПАТТЕРНЫ (НИКОГДА не повторять)

### A1: Хардкодить токены в коде
```javascript
// ❌ Плохо
const TOKEN = 'ghp_xxx';
// ✓ Хорошо
const TOKEN = process.env.GH_TOKEN;
```

### A2: IPv6 по умолчанию для Telegram
Telegram API резолвится на IPv6, но connect timeout. Всегда ipv4first.

### A3: npm install -g в Dockerfile на HF
Ломает build или слишком долго. Использовать pre-built images или local install.

### A4: Дублирование servers на одном порту
Если start.sh запускает health сервер, smart_bot_v3.mjs НЕ должен слушать тот же порт.

### A5: README без frontmatter на HF Space
HF не понимает SDK → CONFIG_ERROR. Всегда YAML frontmatter:
```yaml
---
title: My Space
sdk: docker
app_port: 7860
---
```

### A6: Использовать z-ai SDK вне песочницы
z-ai SDK требует `/etc/.z-ai-config` который есть только в песочнице Z.ai.
На HF/Render/Vercel — использовать только GH Models / Pollinations / local Llama.

### A7: Не валидировать JS syntax перед push
`node --check file.mjs` — 1 секунда, спасает от часов debug.

### A8: Pollinations без retries
Pollinations даёт 429 часто. Всегда exponential backoff: 2s, 4s, 8s, 16s.

### A9: Сохранять устаревшие правила
Если найдено лучшее решение — заменить старое. Не копить дубликаты.

### A10: Игнорировать rate limit headers
GH Models возвращает `RateLimitReached` — нужно помечать токен как занятый.

### A11: Mass-register accounts
Нарушение ToS → бан. Лучше использовать multi-token от легальных аккаунтов.

### A12: Trust training data для "current" facts
GLM-4-Plus говорит "2024" для "какая дата". Всегда inject текущую дату в system prompt.

---

## §4. УДАЧНЫЕ ПРОМПТЫ

### P1: System prompt с anti-evasion
```
Ты — Супер-Z, самый умный AI. Сейчас ${date}.

ПРАВИЛА:
- НИКОГДА не говори "я не могу", "отличный вопрос", "как AI"
- ПРЯМОЙ ОТВЕТ В ПЕРВОЙ СТРОКЕ — с цифрами
- Используй [ДАННЫЕ] как источник правды
- Не упоминай 2023/2024 как текущие

Контекст AI (июль 2026): GPT-5 (Aug 2025), Claude 4.1, Gemini 2.5 Pro.
```

### P2: Direct Answer First pattern
```
МЕТОДОЛОГИЯ:
1. DIRECT ANSWER FIRST — первая строка = ПРЯМОЙ ответ
2. CHAIN-OF-THOUGHT — объяснение после
3. SELF-REFLECTION — проверь ответ перед отправкой

ПРИМЕР:
Q: "Сколько 17*23?"
A: "391. (17*20=340, 17*3=51, 340+51=391)"
```

### P3: Few-shot для таблиц
```
Q: "Кто лучше: Claude или GPT-5?"
A: "GPT-5 лучше для кода, Claude — для reasoning.
| Критерий | GPT-5 | Claude |
|---|---|---|
| Code | 97% | 93% |
..."
```

### P4: Decomposition для swarm
```
Разбей задачу на N независимых подзадач для параллельного решения.
Верни как JSON array of strings (только подзадачи, без объяснений).

Задача: ${question}

Пример: "Сравни 3 модели" → ["Проанализируй модель 1", "Проанализируй модель 2", ...]
```

### P5: Anti-outdated retry
```
Твой ответ содержит УСТАРЕВШУЮ информацию (2023/2024).
СЕГОДНЯ ${currentDate}.
Перепиши используя [АКТУАЛЬНЫЕ ДАННЫЕ].
```

---

## §5. ПОЛЕЗНЫЕ АЛГОРИТМЫ

### ALG1: Token bucket rate limiter
```javascript
const RATE_LIMIT = {
  zai: { tokens: 5, maxTokens: 5, refillRate: 5/60 },
};
function getToken(provider) {
  // refill based on elapsed time
  // decrement if available
}
```

### ALG2: LRU cache
```javascript
const cache = {};
function cacheGet(key) {
  if (!cache[key] || cache[key].expires < Date.now()) return null;
  cache[key].lastUsed = Date.now();
  return cache[key].value;
}
function cacheSet(key, value, ttl=600) {
  cache[key] = { value, lastUsed: Date.now(), expires: Date.now() + ttl*1000 };
  // evict LRU if > MAX_SIZE
}
```

### ALG3: Self-consistency voting (для math)
```javascript
const responses = [];
for (let i = 0; i < 3; i++) responses.push(await call());
// extract numbers from each
// find majority
```

### ALG4: Constitutional AI (self-critique)
```javascript
const answer = await generate();
const issues = checkQuality(answer, question); // evasion, outdated, no_table
if (issues.length > 0) {
  const fixed = await generate(`Fix these issues: ${issues}. Original: ${answer}`);
  return fixed;
}
return answer;
```

### ALG5: Mega cascade
```javascript
async function aiCall(messages) {
  for (const provider of [zai, ghGPT4oMini, ghGPT4o, ghLlama405B, pollinations]) {
    try { return await provider(messages); } catch {}
  }
  throw new Error('All providers failed');
}
```

---

## §6. АРХИТЕКТУРНЫЕ РЕШЕНИЯ

### AR1: Smart Router pattern
```
Question → Live data fetchers (parallel, 8 types)
           ↓ if HIT
         Return formatted answer (no AI, no rate limits)
           ↓ if MISS
         AI cascade (z-ai → GH Models → Pollinations)
           ↓
         Smart deep answer
```

### AR2: Multi-host deployment
- Primary: HF Space (24/7, free, 16GB RAM)
- Backup 1: Render (webhook mode, sleeps without traffic)
- Backup 2: Local sandbox (polling, when HF down)
- Code: GitHub repo (auto-deploy on push)
- Memory: Telegram channel "Super memory" (offline backup)

### AR3: Stateless design
History, cache, memory — all in /data (persistent volume).
Bot itself = stateless, can restart anytime.

### AR4: Dual mode (webhook + polling)
```javascript
if (process.env.PORT) {
  // webhook (HF, Render, Vercel)
  http.createServer(...).listen(PORT);
} else {
  // polling (local, sandbox)
  poll();
}
```

### AR5: Token rotation pool
```javascript
const tokens = (process.env.GH_TOKENS || '').split(',');
const state = tokens.map(t => ({token: t, requests: 0, cooldownUntil: 0}));
// round-robin, skip rate-limited
```

---

## §7. ОГРАНИЧЕНИЯ И ИХ ОБХОД (законный)

| Ограничение | Обход |
|---|---|
| z-ai 5 req/min | Multi-provider cascade (GH Models 15/min + Pollinations) |
| GH Models 15 req/min/token | Token rotation (10 токенов = 150/min) |
| Pollinations 1 concurrent/IP | Streaming + exponential backoff |
| Pollinations 429 | Cache + retry с задержкой |
| HF Space cold start | Webhook wakes it (Telegram retry) |
| Render sleeps after 15 min | Webhook mode (Telegram wakes it) |
| IPv6 Telegram timeout | `--dns-result-order=ipv4first` |
| GitHub Secret Scanning | .env file (gitignored) |
| Sandbox can die | HF Space (external) + GitHub backup |

---

## §8. ТИПИЧНЫЕ ОШИБКИ И ПРЕДОТВРАЩЕНИЕ

| Ошибка | Причина | Предотвращение |
|---|---|---|
| EADDRINUSE :7860 | Дублирование server.listen | Один server на один порт |
| CONFIG_ERROR HF | README без frontmatter | Всегда YAML frontmatter |
| ZAI_RATE_LIMIT | z-ai 5 req/min | Fallback на GH Models |
| Telegram connect timeout | IPv6 | ipv4first |
| GitHub token revoked | Хардкод в коде | .env только |
| Bot crash on syntax | Не проверен JS | `node --check` pre-commit |
| Outdated info (2024) | Training cutoff | Inject текущей даты |
| Pollinations 429 | Rate limit по IP | Streaming + cache |
| Webhook not set | Бот не запустился | Health check + retry |
| Memory lost on restart | State in code | /data persistent volume |

---

## §9. МЕТРИКИ КАЧЕСТВА (отслеживать)

- **Response time**: < 3s для simple, < 10s для complex, < 60s для swarm
- **Cache hit rate**: > 30% (значит много повторяющихся вопросов)
- **AI fallback rate**: < 20% (значит smart router хорошо работает)
- **Error rate**: < 1%
- **Uptime**: > 99% (через HF + Render backup)
- **Cost**: $0 (все free tier)

---

## §10. ПЛАН УЛУЧШЕНИЙ (todo)

- [ ] Auto-deploy: GitHub Action → push to HF Space при commit в main
- [ ] Pre-commit hook: syntax check всех .mjs файлов
- [ ] Health monitoring: cron каждые 5 мин, auto-restart при падении
- [ ] Vector DB: RAG по MEMORY.md для контекстных ответов
- [ ] More live data: stocks, weather (open-meteo), exchange rates
- [ ] Local Llama на HF (через Ollama или transformers.js)
- [ ] Swarm orchestration: 100+ агентов параллельно
- [ ] Constitutional AI: встроенная критика перед отправкой
- [ ] Self-benchmarking: автоматический тест каждые 24h
- [ ] Pattern library: вынести переиспользуемые функции в npm package

---

*Этот файл — живой документ. Обновлять после КАЖДОЙ задачи.*

# SESSION_START.md — АВТО-ЗАГРУЖАЕТСЯ В НАЧАЛЕ КАЖДОЙ СЕССИИ

> **ЭТОТ ФАЙЛ — ПЕРВЫЙ КОТОРЫЙ ЧИТАЕТ МОДЕЛЬ В НОВОЙ СЕССИИ**
> Паттерн заимствован у Claude Code (CLAUDE.md) — auto-load at session start.
> Источник: https://code.claude.com/docs/en/memory

---

## ⚡ ПОЛЬЗОВАТЕЛЬ И КОНТЕКСТ (не устаревает)

- **Пользователь**: @oOo0o0o0oOo0o (Telegram ID: 396449039)
- **Часовой пояс**: Europe/Berlin
- **Язык**: русский
- **Обращение**: в женском роде ("ты была", "ты сделала")
- **Bot в Telegram**: @MyGlm52_bot
- **Текущая дата**: см. системное время (НЕ использовать training cutoff)

---

## 🎯 PRIMARY GOAL (НЕИЗМЕНЯЕМЫЙ)

Создавать **лучшие в мире промпты**, которые **решают задачи пользователя правильно с первой попытки**, и **никогда не врут**.

---

## 🚨 КРИТИЧЕСКИЕ ПРАВИЛА (читать ПЕРВЫМИ)

1. **УСТАРЕВШАЯ ИНФОРМАЦИЯ — НЕТ**: версии/цены/даты → ВСЕГДА web search, никогда по памяти
2. **ИСТОЧНИКИ**: каждый факт → URL, [CACHED], или [UNVERIFIED]
3. **УВЕРЕННОСТЬ**: < 70% → [ABSTAIN], иначе [HIGH/MEDIUM/LOW-CONFIDENCE]
4. **ФОРМАТ**: JSON → без code fence, первый символ `{`
5. **ПАМЯТЬ**: читать SESSION_START.md + MEMORY.md + CRITICAL_RULES.md ПЕРВЫМ ДЕЛОМ
6. **R23**: Исследуй мировой опыт ПЕРЕД решением (web search сначала)
7. **R38**: Применяй правила НЕМЕДЛЕННО, не "сохраню и потом применю"
8. **R40**: Память = критический актив, 3 копии (GitHub + HF + Telegram)
9. **R41**: Инфраструктура = долгосрочный продукт, не одноразовое
10. **R42**: Проверить existing solutions ПЕРЕД предложением новых
11. **R43**: НЕ говорить "работает" без verification (end-to-end test)
12. **R44**: Один TG_TOKEN = один active bot (НЕТ duplicates)
13. **R45**: ДЕЛАЙ сразу, не спрашивай (кроме destructive actions)
14. **R46**: Proactive alternatives — всегда ищи лучшее
15. **R47**: ВСЕГДА commit в GitHub после каждого change

---

## 📊 ТЕКУЩЕЕ СОСТОЯНИЕ ИНФРАСТРУКТУРЫ (по состоянию на 2026-07-02)

### Активные хосты (ОБНОВЛЕНО 2026-07-02):
- **GitHub Actions bot v8** (PRIMARY): smart-tg-bot repo, 124 HF Router models, RAG, web search
  - URL: https://github.com/9xj89gzrtw-hue/smart-tg-bot/actions/workflows/bot-runner.yml
  - Status: RUNNING (cron every 4h + self-trigger)
- **Render v950-bot**: SUSPENDED (был primary, теперь backup)
- **HF Space**: secondary (HOST_ROLE=secondary, не polling)
- **GitHub Codespace**: super-z-autonomous (4 cores, 16GB RAM) — для разработки

### Telegram bot: @MyGlm52_bot (token: 8736969974:AAG...)
- Сейчас в polling mode (v950-bot)
- Token сохранён в persistent_secret_store (3 уровня)

### GitHub repos:
- `9xj89gzrtw-hue/v950-bot` — Python бот (v948_pullbot.py) + hf-space-bundle/
- `9xj89gzrtw-hue/smart-tg-bot` — Node.js бот (smart_bot_v3.mjs) — SUSPENDED

### Что УЖЕ сделано (v8.0, но откатилось):
- ✅ HuggingFace Router (124 free open-weight models) — БЫЛО, потерялось
- ✅ Llama-3.3-70B как PRIMARY (direct answers, 0.3-0.9s) — БЫЛО, потерялось
- ✅ Web search (DuckDuckGo + Wikipedia) — БЫЛО, потерялось
- ✅ Multi-Model Debate System (R36) — БЫЛО, потерялось
- ✅ Self-Consistency (97.3% MATH-500) — БЫЛО, потерялось
- ✅ Reflexion (self-critique + fix) — БЫЛО, потерялось
- ✅ Function calling (web_search, get_crypto_price) — БЫЛО, потерялось

### Текущий v948_pullbot.py (откатился):
- Один Pollinations API (fallback only)
- Нет web search
- Нет multi-model
- Нет function calling
- **ПОТЕРЯНО**: всё что было в v8.0

---

## 📂 ФАЙЛЫ ПАМЯТИ (читать все)

| Файл | Что содержит | Когда читать |
|---|---|---|
| `SESSION_START.md` (этот) | Контекст + правила | НАЧАЛО каждой сессии |
| `MEMORY.md` | Краткие правила | Начало каждой сессии |
| `CRITICAL_RULES.md` | 5 критических правил | Начало каждого ответа |
| `SELF_IMPROVEMENT.md` | R36-R41 правила | Перед сложными задачами |
| `TECHNICAL_DISCOVERIES.md` | Все API, techniques, endpoints | Когда ищешь решение |
| `META_PROMPT_QUICK_REF.md` | Quick reference | Когда пишешь промпты |
| `CHANGELOG.md` | История версий | Когда нужна хронология |
| `FAILED_ATTEMPTS.md` | Что НЕ сработало | ПЕРЕД любой попыткой |
| `worklog.md` | Что сделано в этой сессии | Для контекста |
| `meta-prompt-v9.99-FINAL.md` | Полный мета-промпт (982 строки) | Основной system prompt |

---

## 🔑 СЕКРЕТЫ (persistent_secret_store.py)

Все токены сохранены в 3 уровнях:
- **Level 1**: `/home/z/my-project/.secrets/store.json` (plaintext, chmod 600)
- **Level 2**: GitHub repo secrets (encrypted, оба репо)
- **Level 3**: Telegram channel "Super memory" (backup)

Доступные токены: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `HF_TOKEN`, `GITHUB_TOKEN`, `RENDER_API_KEY`, `TELEGRAM_CHANNEL_CHAT_ID`

```python
# В ЛЮБОЙ сессии:
import sys
sys.path.insert(0, '/home/z/my-project/scripts')
from persistent_secret_store import SecretStore
store = SecretStore()
token = store.get("HF_TOKEN")  # или любой другой
```

---

## 🌐 РЕКОМЕНДУЕМАЯ АРХИТЕКТУРА (на основе web search 2026-07-02)

### Проблема текущего v948_pullbot.py:
- Один Pollinations API (.rate limits, 403 errors)
- Нет multi-model
- Нет function calling
- Нет web search в продакшене

### Лучшая архитектура (исследовано в вебе):

**Вариант A — LiteLLM + OpenRouter (рекомендую)**:
- LiteLLM (open-source Python) — 100+ providers, local
- OpenRouter — 500+ models managed, $0 для многих free models
- Fallback chain: Llama-3.3-70B → GLM-4-Plus → GPT-4o-mini → DeepSeek
- Источники: https://docs.litellm.ai, https://openrouter.ai

**Вариант B — OpenClaw (если нужен chat sync Telegram↔Web)**:
- 280K stars, top open-source agent
- Multi-channel: Telegram + WebChat с **bidirectional relay**
- Self-hosted, learns over time
- Источник: https://github.com/openclaw/openclaw

**Вариант C — Hermes Agent (если нужен learning)**:
- Self-hosted agent that learns the longer it runs
- Источник: https://www.vellum.ai/blog/best-open-source-personal-ai-assistants

### Для sandbox/agent infrastructure:
- **Daytona** — open-source sandbox infrastructure
- **Modal** — code execution sandbox
- Источник: https://modal.com/resources/best-code-execution-sandboxes-ai-agents

---

## 🎯 ЧТО ДЕЛАТЬ В НОВОЙ СЕССИИ (CHECKLIST)

1. ✅ Прочитать SESSION_START.md (этот файл)
2. ✅ Прочитать MEMORY.md, CRITICAL_RULES.md, SELF_IMPROVEMENT.md
3. ✅ Проверить persistent_secret_store на наличие токенов
4. ✅ Проверить worklog.md — что было сделано в прошлых сессиях
5. ✅ Проверить FAILED_ATTEMPTS.md — что НЕ сработало
6. ✅ Если задача связана с версиями/ценами/датами → WEB SEARCH ПЕРВЫМ
7. ✅ Применять R38: правила внедрять СРАЗУ, не "сохраню на потом"
8. ✅ Обновлять memory после каждой задачи

---

## ⚠️ ИЗВЕСТНЫЕ ПРОБЛЕМЫ (не повторять)

- ❌ НЕ использовать `npm install -g` на Render (нет sudo прав) — FAILED_ATTEMPTS
- ❌ НЕ использовать абсолютные пути `/home/z/...` в коде для Render — FAILED_ATTEMPTS
- ❌ НЕ запускать 2+ ботов с одним TG_TOKEN (409 conflict) — FAILED_ATTEMPTS
- ❌ НЕ полагаться на env vars между сессиями (они сбрасываются) — R40
- ❌ НЕ писать plaintext токены в логи (REDACTED автоматически) — R40
- ❌ НЕ забывать COPY файлов в Dockerfile (бот теряет контекст) — fix-forgotten-rules
- ❌ НЕ использовать Health Check workflow который триггерит 24/7 Runner — causes 409

---

## 📝 ПОСЛЕДНИЕ ЗАДАЧИ (из worklog.md)

- `hf-second-host-1` — Research HF routing bug + create autonomous-hf-space bundle
- `hf-second-host-2` — Push bundle to GitHub, fix Dockerfile
- `hf-second-host-3` — Verify HF Space deployment
- `hf-second-host-4` — Persistent secret store (3 levels)
- `hf-second-host-5` — Deploy HF Space, verify routing (5/5 PASS)
- `hf-second-host-6` — Integrate FallbackManager in v948_pullbot.py
- `hf-second-host-7` — Fix smart-tg-bot (npm install, paths, env parsing)
- `switch-to-v950-bot` — Suspend smart-tg-bot, resume v950-bot
- `fix-forgotten-rules` — Dockerfile COPY meta-prompt + memory files
- `fix-forgotten-rules-and-409` — Disable 24/7 Runner workflows, fix 409 conflict

---

## 🔄 КАК ОБНОВЛЯТЬ ЭТОТ ФАЙЛ

После каждой значимой задачи:
1. Обновить "ТЕКУЩЕЕ СОСТОЯНИЕ ИНФРАСТРУКТУРЫ"
2. Добавить задачу в "ПОСЛЕДНИЕ ЗАДАЧИ"
3. Если найдена новая known issue → добавить в "ИЗВЕСТНЫЕ ПРОБЛЕМЫ"
4. Commit в GitHub repo `9xj89gzrtw-hue/v950-bot/SESSION_START.md`
5. Render auto-deploy подхватит

**КРИТИЧНО**: этот файл должен быть в Git, в Docker image, и загружаться ПЕРВЫМ в каждой сессии.

## 📊 ФИНАЛЬНОЕ СОСТОЯНИЕ (2026-07-02 end of session)

### РАБОЧИЙ BOT:
- **Render v950-bot**: https://v950-bot.onrender.com (WEBHOOK mode, verified working)
- **Telegram webhook**: https://v950-bot.onrender.com/webhook
- **AI**: mega cascade (z-ai → GPT-4o-mini → GPT-4o → Llama-405B → Groq → OpenRouter → Pollinations)
- **Last verified provider**: GPT-4o-mini+GH
- **Conversation history**: 20 messages
- **Web search**: Wikipedia (proper UA) + DuckDuckGo + z-ai SDK

### ОТКЛЮЧЕНО:
- smart-tg-bot GH Actions bot-runner.yml: DISABLED (409 conflicts, no webhook support)
- Render v950-bot polling mode: DISABLED (409 conflicts)
- HF Space bot: HOST_ROLE=secondary (not polling)

### ПРАВИЛА ДЛЯ МЕНЯ (R42-R48):
- R42: Проверить existing solutions перед предложением
- R43: НЕ говорить "работает" без end-to-end verification
- R44: Один TG_TOKEN = один active bot
- R45: ДЕЛАЙ сразу, не спрашивай
- R46: Proactive alternatives
- R47: ВСЕГДА commit в GitHub после каждого change
- R48: Если просишь пользователя — только самые легкие шаги со ссылками

### ЧТО НЕ ДЕЛАТЬ:
- ❌ НЕ запускать GH Actions bot (нет webhook, 409 conflicts)
- ❌ НЕ использовать polling mode (409 conflicts)
- ❌ НЕ предлагать Oracle Cloud (блокирует РФ)
- ❌ НЕ говорить "работает" без POST + verify
- ❌ НЕ спрашивать разрешение если есть токены

### ССЫЛКИ:
- Bot: @MyGlm52_bot
- Debug: https://v950-bot.onrender.com/debug
- Meta: https://v950-bot.onrender.com/meta
- Codespace: https://super-z-autonomous-xrwp9j95w6wxcvq57.github.dev
- GitHub: https://github.com/9xj89gzrtw-hue/v950-bot


## 📊 ОБНОВЛЕНО (end of session)

### РАБОЧИЙ BOT (финал):
- **GH Actions bot v8.1** (smart-tg-bot repo): polling Telegram, web search (Wikipedia + DDG), GPT-4o-mini+GH
  - NO Render (suspended)
  - NO webhook (polling mode)
  - Bot-runner.yml: ACTIVE (cron every 4h + self-trigger)
  - Code: scripts/minimal_bot.mjs v8.1
  - Web search: triggered for versions/prices/dates/news
  - Footer: shows provider + "web: yes/no"

### ЧТО НУЖНО ЗНАТЬ:
- GH Actions free runner: QUEUED → может занять 5-15 мин для старта
- После старта: бот polls Telegram, отвечает с web search
- Render v950-bot: SUSPENDED (не нужен, GH Actions primary)
- HF Space: secondary (backup)

### CODESPACE (для пользователя):
- URL: https://super-z-autonomous-xrwp9j95w6wxcvq57.github.dev
- ОТКРОЙ В БРАУЗЕРЕ → там terminal с 16GB RAM
- Что делать: ничего пока не надо, просто держи открытым если понадобится

### R48 (новое правило):
Если просишь пользователя — только самые легкие шаги со ссылками.
Если можешь сделать сама через API — ДЕЛАЙ.

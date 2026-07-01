# 🚀 ДЕПЛОЙ НА RENDER — 3 МИНУТЫ

## Что нужно от вас (только 1 шаг):
1. Создать новый GitHub Personal Access Token: https://github.com/settings/tokens/new
   - Note: "Smart Bot"
   - Expiration: No expiration (или 1 year)
   - Scopes: `repo` (все), `workflow`, `write:packages`
   - Скопировать токен, отправить боту: `/setghtoken <новый_токен>`

## После получения токена я автоматически:
1. Обновлю GH_TOKEN во всех файлах
2. Залью всё в GitHub (smart_bot_v3.mjs, render.yaml, MEMORY, meta-prompt)
3. Установлю GitHub Actions secrets

## Что сделать вам вручную (5 минут):
1. **Зайти на https://render.com** → Sign up (через GitHub — 1 клик)
2. **New +** → **Blueprint**
3. Выбрать репозиторий `9xj89gzrtw-hue/smart-tg-bot`
4. Render автоматически найдёт `render.yaml` и создаст сервис
5. В Environment → Add Environment Variable:
   - `TG_TOKEN` = `8736969974:AAG66M9I0uGwRUksTt1iJt7v-n-f7T7BpnE`
6. **Create** → Render запустит бот через 1-2 минуты
7. Получить URL: `https://smart-tg-bot-xxxx.onrender.com`
8. Render сам установит webhook в Telegram

## Проверка:
- `https://smart-tg-bot-xxxx.onrender.com/health` → `{"status":"ok",...}`
- Написать боту в Telegram → должен ответить

## Почему Render:
- ✅ Бесплатный план: 750 часов/мес
- ✅ Не нужны данные карты
- ✅ Авто-деплой при push в GitHub
- ✅ Webhook mode — Render не засыпает при входящем сообщении
- ✅ EU регион (Франкфурт) — близко к Berlin

## Если Render не подходит:
- **Koyeb**: https://www.koyeb.com → New Service → GitHub → select repo → Deploy
- **Railway**: https://railway.app → New Project → Deploy from GitHub → select repo
- **Fly.io**: `fly launch` (нужен flyctl)

## Альтернатива: GitHub Actions (бесплатно, 24/7)
Файл `.github/workflows/bot-runner.yml` уже готов.
После установки secrets (`TG_TOKEN`, `ALLOWED_CHATS`, `GH_TOKEN`):
1. Actions → Smart Bot 24/7 Runner → Run workflow
2. Бот работает 5 часов, потом автоматически перезапускается
3. Unlimited minutes для public repos

# Templates Library

## Bot System Prompt Template
```
Ты — [NAME]. Сегодня [DATE]. 
Отвечай ПРЯМО. Первая строка = ответ.
Не увиливай. Не говори "я не могу".
[WEB SEARCH] и [DATA] = источник правды.
```

## GH Actions Workflow Template
```yaml
name: Bot Runner
on:
  schedule:
    - cron: '0 */4 * * *'
  workflow_dispatch:
jobs:
  run-bot:
    runs-on: ubuntu-latest
    timeout-minutes: 290
    env: [SECRETS]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - name: Start Bot
        run: timeout 280m node scripts/bot.mjs
      - name: Trigger next
        if: always()
        run: [dispatch]
```

## HF Router API Call Template
```javascript
const r = await fetch('https://router.huggingface.co/v1/chat/completions', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${HF_TOKEN}` },
  body: JSON.stringify({ model: 'meta-llama/Llama-3.3-70B-Instruct', messages, max_tokens: 2000 })
});
```

## Token Rotation Template
```javascript
const tokens = process.env.GH_TOKENS.split(',');
const state = tokens.map(t => ({ token: t, req: 0, window: Date.now() }));
function getNext() { /* least used, reset 60s */ }
```

## Backup 3-2-1 Template
- 3 copies: GitHub + HF Space + Telegram channel
- 2 media: git repo + file storage
- 1 offline: Telegram downloadable files

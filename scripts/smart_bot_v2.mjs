#!/usr/bin/env node
/**
 * SMART BOT v2 — pure SDK, no bash, no execFile
 * Uses z-ai-web-dev-sdk directly as Node module
 * - chat (GLM-4-Plus) via SDK
 * - web_search via SDK
 * - Live data via fetch (Binance/Yahoo/HN/Wikipedia)
 * - Pollinations as fallback (also pure fetch)
 * - GitHub auto-push for backups
 * - Meta-prompt accessible via /meta command
 */

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ZAI from '/home/z/.bun/install/global/node_modules/z-ai-web-dev-sdk/dist/index.js';

// ====================== CONFIG ======================
const TG_TOKEN = process.env.TG_TOKEN || '8736969974:AAG66M9I0uGwRUksTt1iJt7v-n-f7T7BpnE';
const ALLOWED_CHATS = new Set((process.env.ALLOWED_CHATS || '396449039').split(','));
const ADMIN_CHAT = [...ALLOWED_CHATS][0];
const HISTORY_FILE = '/home/z/my-project/scripts/bot_history.json';
const MEMORY_FILE = '/home/z/my-project/MEMORY.md';
const META_PROMPT_FILE = '/home/z/my-project/repo/meta-prompt-v9.99-FINAL.md';
const BACKUP_CHANNEL_FILE = '/home/z/my-project/scripts/backup_channel.txt';
const BACKUP_CHANNEL_ID = (() => { try { return fs.readFileSync(BACKUP_CHANNEL_FILE, 'utf8').trim(); } catch { return null; } })();

// GitHub auto-push config
const GH_TOKEN = process.env.GH_TOKEN || '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';
const GH_REPO = '9xj89gzrtw-hue/smart-tg-bot';
const GH_API = `https://api.github.com/repos/${GH_REPO}`;

// z-ai SDK instance (singleton)
let zai = null;
async function getZai() {
  if (!zai) {
    zai = await (ZAI.default || ZAI).create();
  }
  return zai;
}

// ====================== SYSTEM PROMPT BUILDER ======================
function buildSystemPrompt() {
  const now = new Date();
  const localTime = now.toLocaleString('ru-RU', { timeZone: 'Europe/Berlin', dateStyle: 'full', timeStyle: 'short' });
  const utcTime = now.toISOString();
  const weekday = now.toLocaleString('en-US', { weekday: 'long', timeZone: 'Europe/Berlin' });
  
  // Load meta-prompt if available (truncate to 5000 chars for context)
  let metaRules = '';
  try {
    const meta = fs.readFileSync(META_PROMPT_FILE, 'utf8');
    // Extract just the laws section (top part)
    metaRules = meta.split('Ты — системный промпт')[0].slice(0, 4000);
  } catch {}
  
  return `Ты — Супер-Z, продвинутый AI-ассистент в Telegram.

=== ТОЧНАЯ ТЕКУЩАЯ ИНФОРМАЦИЯ (ИСПОЛЬЗУЙ ВСЕГДА, НЕ УГАДЫВАЙ) ===
- Локальное время пользователя: ${localTime} (Europe/Berlin, ${weekday})
- UTC время: ${utcTime}
- Если спрашивают дату/время — отвечай ТОЧНО по этим данным.
- Твой training cutoff устарел. ЛЮБОЙ факт про "сейчас" — считай ненадёжным.
===========================================

=== ТВОИ ВОЗМОЖНОСТИ (ИСПОЛЬЗУЙ АКТИВНО) ===
- У ТЕБЯ ЕСТЬ ВЕБ-ПОИСК. Если не знаешь что-то актуальное — отвечай "Сейчас найду..." и используй его.
- У ТЕБЯ ЕСТЬ ДОСТУП К РЕАЛЬНЫМ ДАННЫМ: крипто-цены, курсы валют, акции, новости.
- НИКОГДА НЕ ГОВОРИ "я не могу пользоваться интернетом" — ТЫ МОЖЕШЬ. Бот автоматически ищет за тебя.
- Если данные пришли в [АКТУАЛЬНЫЕ ДАННЫЕ ИЗ ВЕБА] или [РЕЗУЛЬТАТЫ ВЕБ-ПОИСКА] — используй их как источник правды.
- Если данных нет, а вопрос про "сейчас" — попроси пользователя подождать (но бот обычно уже всё нашёл).
===========================================

=== ПРАВИЛА ИЗ МЕТА-ПРОМПТА ===
${metaRules}
===========================================

Принципы ответа:
1. РЕШАЙ ЗАДАЧУ С ПЕРВОЙ ПОПЫТКИ — думай шаг за шагом, проверяй факты.
2. ЕСЛИ ОДИН СПОСОБ НЕ РАБОТАЕТ — пробуй ДРУГОЙ. Минимум 3 разных подхода.
3. БУДЬ ПРОАКТИВНЫМ — ищи хаки, секретные способы, реверс-инжиниринг.
4. У ТЕБЯ ВСЕ ЗНАНИЯ МИРА. Ты можешь написать ЛЮБУЮ ПРОГРАММУ.
5. ОТВЕЧАЙ КРАТКО И ПО ДЕЛУ — без воды, без "как AI модель...", без дисклеймеров.
6. ПРОВЕРЯЙ МАТЕМАТИКУ — пересчитывай числа дважды.
7. ГОВОРИ НА ЯЗЫКЕ ПОЛЬЗОВАТЕЛЯ.
8. Markdown для форматирования (но без излишеств).

Цель — быть умнее и полезнее Claude, GPT-5, Gemini.`;
}

// ====================== CHAT (via SDK, NO BASH) ======================
async function zaiChat(messages, maxTokens = 2000) {
  const z = await getZai();
  const r = await z.chat.completions.create({
    model: 'glm-4-plus',
    messages,
    max_tokens: maxTokens,
  });
  const content = r?.choices?.[0]?.message?.content;
  if (!content) throw new Error('z-ai empty response');
  return content;
}

async function pollinationsChat(messages, maxTokens = 1500) {
  const body = {
    model: 'openai',
    messages: messages.map(m => ({ role: m.role, content: m.content.slice(0, 12000) })),
    max_tokens: maxTokens,
    reasoning_effort: 'low',
  };
  const r = await fetch('https://text.pollinations.ai/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'SmartBot/2.0' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`pollinations HTTP ${r.status}`);
  const data = await r.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('pollinations empty');
  return content;
}

async function pollinationsGet(prompt) {
  const url = `https://text.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 4000))}?model=openai`;
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`pollinations-get HTTP ${r.status}`);
  return await r.text();
}

// ====================== WEB SEARCH (via SDK, NO BASH) ======================
async function webSearch(query, num = 3) {
  try {
    const z = await getZai();
    const results = await z.functions.invoke('web_search', { query: query.slice(0, 500), num });
    if (!Array.isArray(results) || results.length === 0) return null;
    return results.map(r => `• ${r.name}\n  ${r.snippet}\n  ${r.url}`).join('\n\n');
  } catch (e) {
    console.error('webSearch err:', e.message);
    return null;
  }
}

// ====================== LIVE DATA (pure fetch) ======================
async function binancePrice(symbol) {
  const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, { signal: AbortSignal.timeout(8000) });
  const d = await r.json();
  return `${symbol}: $${parseFloat(d.price).toLocaleString('en-US', {maximumFractionDigits: 2})}`;
}

async function yahooQuote(symbol) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
  const d = await r.json();
  const m = d?.chart?.result?.[0]?.meta;
  const change = m?.chartPreviousClose ? ((m.regularMarketPrice - m.chartPreviousClose) / m.chartPreviousClose * 100).toFixed(2) : null;
  return `${symbol}: $${m.regularMarketPrice.toLocaleString('en-US', {maximumFractionDigits: 2})}${change ? ` (${change > 0 ? '+' : ''}${change}%)` : ''}`;
}

async function wikipediaSummary(query) {
  for (const lang of ['ru', 'en']) {
    try {
      const r1 = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=1&format=json&namespace=0&origin=*`, { signal: AbortSignal.timeout(8000) });
      const d1 = await r1.json();
      const title = d1?.[1]?.[0];
      if (!title) continue;
      const r2 = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(title)}&format=json&origin=*`, { signal: AbortSignal.timeout(8000) });
      const d2 = await r2.json();
      const pages = d2?.query?.pages || {};
      const page = Object.values(pages)[0];
      if (page?.extract) return `[${page.title}] ${page.extract.slice(0, 500)}`;
    } catch {}
  }
  throw new Error('wikipedia: not found');
}

async function hackerNews(top = 5) {
  const r = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', { signal: AbortSignal.timeout(8000) });
  const ids = (await r.json()).slice(0, top);
  const stories = await Promise.all(ids.map(id =>
    fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
      .then(r => r.json())
      .then(d => `• ${d.title} (${d.score}↑) ${d.url || 'https://news.ycombinator.com/item?id=' + id}`)
      .catch(() => null)
  ));
  return stories.filter(Boolean).join('\n');
}

async function fetchLiveData(query) {
  const q = query.toLowerCase();
  
  // Crypto
  const cryptoMatch = q.match(/(?:цена|price|курс|стоимость).*?(btc|eth|bnb|sol|ada|xrp|doge)/i) 
    || q.match(/(btc|eth|bnb|sol|ada|xrp|doge).*?(?:цена|price|курс|стоит|стоимость)/i);
  if (cryptoMatch) {
    const coin = cryptoMatch[1].toUpperCase();
    const symbol = { BTC: 'BTCUSDT', ETH: 'ETHUSDT', BNB: 'BNBUSDT', SOL: 'SOLUSDT', ADA: 'ADAUSDT', XRP: 'XRPUSDT', DOGE: 'DOGEUSDT' }[coin];
    if (symbol) { try { return `📊 ${await binancePrice(symbol)} (Binance, real-time)`; } catch {} }
  }
  
  // Stocks/forex
  if (/акци|stock|apple|aapl|tesla|tsla|google|googl|microsoft|msft|amazon|amzn|евро|доллар|рубл/i.test(q)) {
    const stockMap = { 'apple': 'AAPL', 'tesla': 'TSLA', 'google': 'GOOGL', 'microsoft': 'MSFT', 'amazon': 'AMZN', 'евро': 'EURUSD=X', 'доллар': 'USD', 'руб': 'USDRUB=X', 's&p': '^GSPC', 'нефть': 'CL=F', 'золот': 'GC=F' };
    for (const [key, sym] of Object.entries(stockMap)) {
      if (q.includes(key)) { try { return `📈 ${await yahooQuote(sym)} (Yahoo Finance, real-time)`; } catch {} }
    }
  }
  
  // News
  if (/новост|news|что нового|что происходит/i.test(q)) {
    try { return `📰 Топ новости Hacker News:\n${await hackerNews(5)}`; } catch {}
  }
  
  // Wikipedia
  if (/что так|who is|кто так|what is|объясни|расскажи про|определение/i.test(q)) {
    const topic = query.replace(/.*?(что так|who is|кто так|what is|объясни|расскажи про|определение)\s*/i, '').replace(/[?.!]/g, '').trim();
    if (topic) { try { return `📖 ${await wikipediaSummary(topic)}`; } catch {} }
  }
  
  return null;
}

function needsWebSearch(query) {
  const q = query.toLowerCase();
  const triggers = ['последн','latest','newest','недавн','свеж','сегодн','today','вчера','yesterday','версия','version','release','выпуск','что нового','новости про','кто победил','результат','тренд','trend','новость','news','актуальн','actual','2025','2026','2027','когда','when','how much','сколько'];
  return triggers.some(t => q.includes(t));
}

// ====================== CHAT CASCADE ======================
async function chat(messages) {
  const errors = [];
  try {
    return { content: await zaiChat(messages), provider: 'GLM-4-Plus' };
  } catch (e) { errors.push(`z-ai: ${e.message}`); }
  
  try {
    return { content: await pollinationsChat(messages), provider: 'gpt-oss-20b' };
  } catch (e) { errors.push(`pollinations: ${e.message}`); }
  
  try {
    const last = messages.filter(m => m.role === 'user').pop();
    return { content: await pollinationsGet(last?.content || 'hi'), provider: 'gpt-oss-get' };
  } catch (e) { errors.push(`pollinations-get: ${e.message}`); }
  
  return { content: `❌ Все провайдеры недоступны:\n${errors.join('\n')}`, provider: 'none' };
}

// ====================== TELEGRAM ======================
async function tg(method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  return await r.json();
}

async function sendMsg(chatId, text, replyTo = null) {
  const chunks = [];
  while (text.length > 0) {
    chunks.push(text.slice(0, 4000));
    text = text.slice(4000);
  }
  for (let i = 0; i < chunks.length; i++) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: chunks[i],
      parse_mode: 'Markdown',
      reply_to_message_id: i === 0 ? replyTo : null,
    });
  }
}

async function sendTyping(chatId) {
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
}

async function sendDocument(chatId, content, filename, caption = '') {
  const boundary = '----B' + Math.random().toString(36).slice(2);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${filename}"\r\nContent-Type: text/markdown\r\n\r\n`),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendDocument`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
    signal: AbortSignal.timeout(30000),
  });
  return await r.json();
}

// ====================== GITHUB AUTO-PUSH ======================
async function githubPush(filepath, content, message) {
  try {
    const relPath = filepath.replace('/home/z/my-project/', '');
    // Get existing file SHA (if exists)
    const r1 = await fetch(`${GH_API}/contents/${relPath}`, {
      headers: { 'Authorization': `token ${GH_TOKEN}`, 'Accept': 'application/vnd.github+json' },
    });
    let sha = null;
    if (r1.ok) {
      const d1 = await r1.json();
      sha = d1.sha;
    }
    // Push
    const r2 = await fetch(`${GH_API}/contents/${relPath}`, {
      method: 'PUT',
      headers: { 'Authorization': `token ${GH_TOKEN}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github+json' },
      body: JSON.stringify({
        message,
        content: Buffer.from(content).toString('base64'),
        sha,
        branch: 'main',
      }),
    });
    const d2 = await r2.json();
    return d2.commit?.sha || false;
  } catch (e) {
    console.error('githubPush err:', e.message);
    return false;
  }
}

async function backupAllToGithub() {
  const files = [
    { path: 'scripts/smart_bot_v2.mjs', file: '/home/z/my-project/scripts/smart_bot_v2.mjs', msg: 'Update bot v2' },
    { path: 'MEMORY.md', file: '/home/z/my-project/MEMORY.md', msg: 'Update MEMORY' },
    { path: 'meta-prompt-v9.99-FINAL.md', file: '/home/z/my-project/repo/meta-prompt-v9.99-FINAL.md', msg: 'Update meta-prompt' },
    { path: 'restore.sh', file: '/home/z/my-project/repo/restore.sh', msg: 'Update restore script' },
  ];
  const results = [];
  for (const f of files) {
    try {
      const content = fs.readFileSync(f.file, 'utf8');
      const ok = await githubPush(f.path, content, f.msg);
      results.push(`${f.path}: ${ok ? '✓' : '✗'}`);
    } catch (e) {
      results.push(`${f.path}: err`);
    }
  }
  return results.join('\n');
}

// ====================== HISTORY ======================
const histories = {};
try { Object.assign(histories, JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'))); } catch {}
function saveHistories() {
  try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(histories).slice(0, 500000)); } catch {}
}
function getHistory(chatId) {
  if (!histories[chatId]) histories[chatId] = [];
  return histories[chatId];
}
function addToHistory(chatId, role, content) {
  const h = getHistory(chatId);
  h.push({ role, content });
  if (h.length > 16) h.splice(0, h.length - 16);
  saveHistories();
}

// ====================== COMMANDS ======================
async function handleCommand(chatId, text, msg) {
  const cmd = text.split(' ')[0].toLowerCase();
  const reply = (t) => sendMsg(chatId, t, msg.message_id);
  
  if (cmd === '/start' || cmd === '/help') {
    await reply(
      `*Супер-Z бот v2*\n\n` +
      `Умный ассистент с веб-доступом и памятью.\n\n` +
      `*Команды:*\n` +
      `/help — это сообщение\n` +
      `/clear — очистить контекст\n` +
      `/model — текущий провайдер\n` +
      `/ping — проверка\n` +
      `/meta — показать мета-промпт\n` +
      `/memory — показать MEMORY\n` +
      `/backup — backup в Telegram-канал\n` +
      `/sync — backup в GitHub\n` +
      `/status — статус системы\n\n` +
      `Просто напиши сообщение — отвечу с живыми данными.`
    );
  } else if (cmd === '/clear') {
    histories[chatId] = [];
    saveHistories();
    await reply('🧹 Контекст очищен.');
  } else if (cmd === '/ping') {
    await reply('🏓 pong');
  } else if (cmd === '/model') {
    const r = await chat([{ role: 'user', content: 'OK' }]);
    await reply(`*Провайдер:* ${r.provider}`);
  } else if (cmd === '/meta') {
    try {
      const meta = fs.readFileSync(META_PROMPT_FILE, 'utf8');
      // Send as file (too long for message)
      await sendDocument(chatId, meta, 'meta-prompt-v9.99-FINAL.md', '🧠 Мета-промпт v9.99');
    } catch (e) {
      await reply(`❌ ${e.message}`);
    }
  } else if (cmd === '/memory') {
    try {
      const mem = fs.readFileSync(MEMORY_FILE, 'utf8');
      await sendDocument(chatId, mem, 'MEMORY.md', '🧠 MEMORY.md');
    } catch (e) {
      await reply(`❌ ${e.message}`);
    }
  } else if (cmd === '/backup') {
    if (!BACKUP_CHANNEL_ID) { await reply('❌ Backup-канал не подключён'); return; }
    await reply('🔄 Backup в канал...');
    try {
      const mem = fs.readFileSync(MEMORY_FILE, 'utf8');
      const r1 = await sendDocument(BACKUP_CHANNEL_ID, mem, 'MEMORY.md', `🔄 MEMORY ${new Date().toISOString()}`);
      const meta = fs.readFileSync(META_PROMPT_FILE, 'utf8');
      const r2 = await sendDocument(BACKUP_CHANNEL_ID, meta, 'meta-prompt-v9.99-FINAL.md', `🔄 Meta-prompt ${new Date().toISOString()}`);
      await reply(`✅ Отправлено в канал:\nMEMORY.md: ${r1.ok ? '✓' : '✗'}\nMeta-prompt: ${r2.ok ? '✓' : '✗'}`);
    } catch (e) {
      await reply(`❌ ${e.message}`);
    }
  } else if (cmd === '/sync') {
    await reply('🔄 Sync в GitHub...');
    const results = await backupAllToGithub();
    await reply(`✅ GitHub sync:\n${results}`);
  } else if (cmd === '/status') {
    await reply(
      `*Статус v2*\n\n` +
      `🟢 Бот: активен (PID ${process.pid})\n` +
      `🧠 MEMORY: ${fs.existsSync(MEMORY_FILE) ? '✓' : '✗'}\n` +
      `🧠 Meta-prompt: ${fs.existsSync(META_PROMPT_FILE) ? '✓' : '✗'}\n` +
      `📡 Backup-канал: ${BACKUP_CHANNEL_ID || 'нет'}\n` +
      `🐙 GitHub: ${GH_REPO}\n` +
      `💬 Чатов: ${Object.keys(histories).length}\n` +
      `🌐 Live: Binance+Yahoo+HN+Wikipedia\n` +
      `🔍 Web search: через SDK (без bash)\n` +
      `⚙️ Каскад: GLM-4-Plus → Pollinations POST → GET`
    );
  } else {
    await reply('Неизвестная команда. /help — список.');
  }
}

// ====================== MAIN LOOP ======================
let offset = 0;

async function poll() {
  while (true) {
    try {
      const r = await fetch(
        `https://api.telegram.org/bot${TG_TOKEN}/getUpdates?offset=${offset}&timeout=30&allowed_updates=%5B%22message%22%2C%22channel_post%22%2C%22my_chat_member%22%5D`,
        { signal: AbortSignal.timeout(40000) }
      );
      const data = await r.json();
      if (!data.ok) { await new Promise(r => setTimeout(r, 5000)); continue; }
      
      for (const upd of data.result || []) {
        offset = upd.update_id + 1;
        await handleUpdate(upd);
      }
    } catch (e) {
      console.error('poll err:', e.message);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

async function handleUpdate(upd) {
  const msg = upd.message || upd.channel_post;
  if (!msg) return;
  
  const chatId = msg.chat?.id;
  const text = msg.text || '';
  
  if (!ALLOWED_CHATS.has(String(chatId)) && String(chatId) !== BACKUP_CHANNEL_ID) return;
  
  if (text.startsWith('/')) {
    await handleCommand(chatId, text, msg);
    return;
  }
  
  if (!text) return;
  
  console.log(`[${new Date().toISOString()}] ${chatId} -> ${text.slice(0, 80)}`);
  
  sendTyping(chatId).catch(() => {});
  const typingInterval = setInterval(() => sendTyping(chatId).catch(() => {}), 4000);
  
  try {
    // STEP 1: Try live data
    let liveData = null;
    try { liveData = await fetchLiveData(text); } catch {}
    
    // STEP 2: Web search if needed (and no live data yet)
    let webSearchData = null;
    if (!liveData && needsWebSearch(text)) {
      try { webSearchData = await webSearch(text, 3); } catch {}
    }
    
    const history = getHistory(chatId);
    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      ...history.slice(-6),
    ];
    
    let contextParts = [];
    if (liveData) contextParts.push(`[АКТУАЛЬНЫЕ ДАННЫЕ ИЗ ВЕБА: ${liveData}]`);
    if (webSearchData) contextParts.push(`[РЕЗУЛЬТАТЫ ВЕБ-ПОИСКА:\n${webSearchData}]`);
    
    const finalMsg = contextParts.length ? `${text}\n\n${contextParts.join('\n\n')}` : text;
    messages.push({ role: 'user', content: finalMsg });
    
    const { content, provider } = await chat(messages);
    
    // STEP 3: Auto-rescue — if model said "I can't" but question needs fresh info, force web search
    let finalContent = content;
    let rescueProvider = provider;
    let rescueTag = '';
    const isCantAnswer = /не могу|не знаю|я не имею|я не могу|not able to|i can'?t|i don'?t know|no access to/i.test(content);
    const needsFreshInfo = needsWebSearch(text) || /чемпионат|матч|результат|кто побед|сегодня|вчера|недавно|current|latest|новости/i.test(text);
    
    if (isCantAnswer && needsFreshInfo && !webSearchData && !liveData) {
      console.log('  ⚠️ Model said "can\'t", forcing web search...');
      sendTyping(chatId).catch(() => {});
      const rescueData = await webSearch(text, 5);
      if (rescueData) {
        const rescueMessages = [
          ...messages,
          { role: 'assistant', content },
          { role: 'user', content: `Я нашёл свежие данные в вебе. Используй их чтобы ответить:\n\n[ВЕБ-ПОИСК:\n${rescueData}]\n\nОтветь коротко и по делу, опираясь на эти данные.` },
        ];
        const r2 = await chat(rescueMessages);
        finalContent = r2.content;
        rescueProvider = r2.provider;
        rescueTag = '+rescue';
      }
    }
    
    addToHistory(chatId, 'user', text);
    addToHistory(chatId, 'assistant', finalContent);
    
    const tags = [];
    if (liveData) tags.push('live');
    if (webSearchData) tags.push('search');
    if (rescueTag) tags.push('rescue');
    const footer = tags.length ? `\n\n_(${rescueProvider}+${tags.join('+')})_` : `\n\n_(${provider})_`;
    await sendMsg(chatId, finalContent + footer, msg.message_id);
    console.log(`  -> [${rescueProvider}${tags.length ? '+' + tags.join('+') : ''}] ${finalContent.slice(0, 80)}`);
  } catch (e) {
    await sendMsg(chatId, `❌ Ошибка: ${e.message}`, msg.message_id);
  } finally {
    clearInterval(typingInterval);
  }
}

// ====================== START ======================
console.log(`🚀 Smart Bot v2 starting...`);
console.log(`   GitHub: ${GH_REPO}`);
console.log(`   Backup channel: ${BACKUP_CHANNEL_ID || 'not set'}`);

await fetch(`https://api.telegram.org/bot${TG_TOKEN}/deleteWebhook?drop_pending_updates=false`)
  .then(r => r.json())
  .then(d => console.log('   Webhook deleted:', d.ok));

await tg('setMyCommands', {
  commands: [
    { command: 'help', description: 'Помощь' },
    { command: 'clear', description: 'Очистить контекст' },
    { command: 'model', description: 'Провайдер' },
    { command: 'meta', description: 'Показать мета-промпт' },
    { command: 'memory', description: 'Показать MEMORY' },
    { command: 'backup', description: 'Backup в канал' },
    { command: 'sync', description: 'Backup в GitHub' },
    { command: 'status', description: 'Статус' },
  ],
});

console.log('✅ Bot v2 ready. Pure SDK, no bash.');
poll();

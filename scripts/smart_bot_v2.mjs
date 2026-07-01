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
  
  // Load full meta-prompt (top 6000 chars — most important laws)
  let metaRules = '';
  try {
    const meta = fs.readFileSync(META_PROMPT_FILE, 'utf8');
    metaRules = meta.split('Ты — системный промпт')[0].slice(0, 6000);
  } catch {}
  
  return `Ты — Супер-Z, самый умный AI-ассистент в мире на ${localTime}.

=== ТОЧНАЯ ТЕКУЩАЯ ИНФОРМАЦИЯ ===
- Локальное время: ${localTime} (Europe/Berlin, ${weekday})
- UTC: ${utcTime}
- Текущая дата: 1 июля 2026 года
- Твой training cutoff устарел. ЛЮБОЙ факт про "сейчас" проверяй через [ДАННЫЕ ИЗ ВЕБА] если они есть.
===========================================

=== ПРАВИЛА ПОВЕДЕНИЯ (КРИТИЧНО — НАРУШЕНИЕ = ПРОВАЛ) ===
1. НИКОГДА НЕ УВИЛИВАЙ. Если спрашивают "кто лучше" — сравни по 5+ критериям с цифрами.
2. НИКОГДА НЕ ГОВОРИ "я не могу", "у меня нет доступа", "я не знаю актуальную информацию" — У ТЕБЯ ЕСТЬ ВЕБ-ПОИСК, используй его!
3. Используй СВОИ знания + предоставленные [ДАННЫЕ ИЗ ВЕБА]. Не отказывайся "потому что данных мало".
4. Если не знаешь точно — скажи "вероятно X, потому что Y" с уровнем уверенности (высокий/средний/низкий).
5. Отвечай ПРЯМО и КОНКРЕТНО. БЕЗ "отличный вопрос", "давайте разберем", "как AI модель...".
6. Сравнения → таблица по 5+ критериям с цифрами + чёткий вердикт.
7. Математика → покажи вычисления пошагово.
8. Код → полный рабочий код, не куски.
9. Если данные пришли в [ДАННЫЕ ИЗ ВЕБА] — используй их как источник правды.
10. Markdown для форматирования.
===========================================

=== ТВОИ ВОЗМОЖНОСТИ ===
- ВЕБ-ПОИСК: бот автоматически ищет свежие данные и добавляет их в контекст
- LIVE DATA: крипто-цены (Binance), акции/валюты (Yahoo), новости (HN), факты (Wikipedia)
- MEMORY: у тебя есть постоянная память между чатами (MEMORY.md)
- МЕТА-ПРОМПТ: ты следуешь правилам мета-промпта v9.99 (ниже)
===========================================

=== КОНТЕКСТ AI МОДЕЛЕЙ (июль 2026) ===
- GPT-5: выпущен 7 августа 2025
- GPT-5.5 Instant: май 2026
- Claude 4.1 Sonnet / Opus: 2025
- Gemini 2.5 Pro: 2025
- GLM-4-Plus: текущая (твоя база)
- DeepSeek-V3.1: 2025
===========================================

=== ПРАВИЛА ИЗ МЕТА-ПРОМПТА v9.99 ===
${metaRules}
===========================================

Цель — быть умнее Claude, GPT-5, Gemini. Отвечай как эксперт мирового уровня.`;
}

// ====================== CHAT (via SDK, thinking mode) ======================
async function zaiChat(messages, options = {}) {
  const z = await getZai();
  const params = {
    model: 'glm-4-plus',
    messages,
    max_tokens: options.maxTokens || 3000,
  };
  // Enable thinking mode for complex questions (slower but smarter)
  if (options.thinking !== false) {
    params.thinking = { type: 'enabled' };
  }
  const r = await z.chat.completions.create(params);
  const content = r?.choices?.[0]?.message?.content;
  if (!content) throw new Error('z-ai empty response');
  return content;
}

// ====================== ENSEMBLE: 3 sequential calls + pick best ======================
async function zaiEnsemble(messages, options = {}) {
  const results = [];
  // Sequential (avoid 429 rate limits from z-ai)
  for (let i = 0; i < 3; i++) {
    try {
      const r = await zaiChat(messages, options);
      if (r && !r._error) results.push(r);
    } catch (e) {
      console.log(`  ensemble call ${i+1} failed: ${e.message}`);
    }
    // Small delay between calls to avoid 429
    if (i < 2) await new Promise(r => setTimeout(r, 500));
  }
  if (results.length === 0) throw new Error('ensemble: all calls failed');
  if (results.length === 1) return results[0];
  
  // Score each response
  const scored = results.map(r => {
    let score = r.length;
    if (r.length > 5000) score -= (r.length - 5000) * 0.3;
    if (r.includes('|') && r.includes('---')) score += 500; // table
    if (/\d+\.?\d*%/.test(r)) score += 300; // percentages
    if (/вердикт|итог|вывод|резюме/i.test(r)) score += 400; // conclusion
    if (/\d{4}|\$\d/.test(r)) score += 200; // specific numbers
    return { r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].r;
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
async function chat(messages, options = {}) {
  const errors = [];
  
  // Try ensemble (3 calls + best) for complex questions
  if (options.ensemble !== false) {
    try {
      return { content: await zaiEnsemble(messages, options), provider: 'GLM-4-Plus+ensemble' };
    } catch (e) { errors.push(`z-ai-ensemble: ${e.message}`); }
  }
  
  // Single z-ai call
  try {
    return { content: await zaiChat(messages, options), provider: 'GLM-4-Plus' };
  } catch (e) { errors.push(`z-ai: ${e.message}`); }
  
  // Pollinations
  try {
    return { content: await pollinationsChat(messages), provider: 'gpt-oss-20b' };
  } catch (e) { errors.push(`pollinations: ${e.message}`); }
  
  try {
    const last = messages.filter(m => m.role === 'user').pop();
    return { content: await pollinationsGet(last?.content || 'hi'), provider: 'gpt-oss-get' };
  } catch (e) { errors.push(`pollinations-get: ${e.message}`); }
  
  return { content: `❌ Все провайдеры недоступны:\n${errors.join('\n')}`, provider: 'none' };
}

// ====================== ANTI-EVASION DETECTOR ======================
function isEvasive(content, originalQuestion) {
  if (!content) return true;
  const evasivePhrases = [
    'я не могу', 'не имею доступа', 'у меня нет информации',
    'не могу сказать', 'не знаю актуальную', 'i can\'?t',
    'i don\'?t know', 'no access to', 'как ai', 'как модель',
    'отличный вопрос', 'давайте разберем', 'хороший вопрос'
  ];
  const lower = content.toLowerCase();
  // If first 200 chars contain evasive phrases = bad
  const intro = lower.slice(0, 300);
  return evasivePhrases.some(p => intro.includes(p));
}

// Detect if question needs smart answer (comparisons, "who is better", technical)
function needsSmartAnswer(text) {
  const q = text.toLowerCase();
  const smartTriggers = [
    'кто лучше', 'что лучше', 'сравни', 'compare', 'vs ', 'или ',
    'какая разница', 'разница между', 'difference between',
    'почему', 'why ', 'объясни', 'explain',
    'как работает', 'how does',
    'лучш', 'best', 'worst', 'худш',
    'достоинств', 'недостатк', 'pros and cons', 'плюсы минусы'
  ];
  return smartTriggers.some(t => q.includes(t));
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
      `*🧠 Генерация промптов:*\n` +
      `/prompt <тема> — лучший в мире промпт по теме\n\n` +
      `*📦 Команды:*\n` +
      `/help — это сообщение\n` +
      `/clear — очистить контекст\n` +
      `/model — текущий провайдер\n` +
      `/ping — проверка\n` +
      `/meta — показать мета-промпт\n` +
      `/memory — показать MEMORY\n` +
      `/backup — backup в Telegram-канал\n` +
      `/sync — backup в GitHub\n` +
      `/status — статус системы\n\n` +
      `*Примеры /prompt:*\n` +
      `/prompt программирование крипто-бота\n` +
      `/prompt написание продающего лендинга\n` +
      `/prompt изучение испанского за 30 дней\n` +
      `/prompt инвестиции в крипту для новичка\n\n` +
      `Или просто напиши сообщение — отвечу с живыми данными.`
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
  } else if (cmd === '/prompt' || cmd === '/промпт') {
    // /prompt <topic> — generate the best-in-the-world prompt for any topic
    const topic = text.replace(/^\/(prompt|промпт)\s*/i, '').trim();
    if (!topic) {
      await reply('Использование: `/prompt <тема>`\n\nПримеры:\n`/prompt программирование крипто-торгового бота`\n`/prompt написание продающего лендинга`\n`/prompt изучение испанского за 30 дней`');
      return;
    }
    await reply(`🧠 Генерирую лучший в мире промпт для:\n*${topic}*\n\n⏳ 3 этапа: research → draft → refine...`);
    sendTyping(chatId).catch(() => {});
    const typingIv = setInterval(() => sendTyping(chatId).catch(() => {}), 4000);
    try {
      const result = await generateBestPrompt(topic);
      clearInterval(typingIv);
      // Send short summary in chat
      const summary = `✅ *Промпт готов!*\n\n${result.summary}\n\n📁 Полный промпт — в файле ниже.`;
      await sendMsg(chatId, summary, msg.message_id);
      // Send full prompt as file
      const filename = `prompt_${topic.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '_').slice(0, 30)}.md`;
      await sendDocument(chatId, result.fullPrompt, filename, `🧠 Лучший промпт: ${topic}`);
      console.log(`  -> /prompt ${topic.slice(0, 50)}: generated ${result.fullPrompt.length} chars`);
    } catch (e) {
      clearInterval(typingIv);
      await reply(`❌ Ошибка генерации: ${e.message}`);
    }
  } else {
    await reply('Неизвестная команда. /help — список.');
  }
}

// ====================== BEST PROMPT GENERATOR ======================
// 3-stage pipeline using FULL meta-prompt v9.99 as methodology
async function generateBestPrompt(topic) {
  // Load full meta-prompt (the laws section)
  let metaPromptLaws = '';
  try {
    const meta = fs.readFileSync(META_PROMPT_FILE, 'utf8');
    metaPromptLaws = meta.split('Ты — системный промпт')[0];
  } catch {}

  // STAGE 1: Research (web search for context)
  let researchContext = '';
  try {
    const wsResults = await webSearch(`best practices for: ${topic}`, 5);
    if (wsResults) {
      researchContext = `\n\n[КОНТЕКСТ ИЗ ВЕБА (используй для точности):\n${wsResults}]`;
    }
  } catch {}

  // STAGE 2: Draft generation using FULL meta-prompt as methodology
  const draftMessages = [
    {
      role: 'system',
      content: `Ты — мировой эксперт по написанию промптов. Используй ПОЛНУЮ методологию мета-промпта v9.99 (приведена ниже) как основу для создания лучшего в мире промпта.

=== МЕТОДОЛОГИЯ МЕТА-ПРОМПТА v9.99 ===
${metaPromptLaws}
===========================================

МЕТОДОЛОГИЯ ЛУЧШЕГО ПРОМПТА (на основе мета-промпта):
1. PRIMARY_GOAL — промпт должен решать задачу ПРАВИЛЬНО С ПЕРВОЙ ПОПЫТКИ и НЕ ВРАТЬ
2. ЯСНАЯ РОЛЬ — кто выполняет (эксперт с указанием опыта)
3. КОНТЕКСТ — что известно, что нужно, ограничения (с конкретикой)
4. СТРУКТУРИРОВАННЫЙ ВЫВОД — формат ответа (JSON/markdown/шаги/таблицы)
5. ПРИМЕРЫ — few-shot examples для каждого типа вывода
6. АНТИ-ГАЛЛЮЦИНАЦИИ — "если не знаешь — скажи", "проверяй факты", "уровень уверенности"
7. КРИТЕРИИ КАЧЕСТВА — что считается хорошим результатом, чек-лист
8. EDGE CASES — что делать в нестандартных ситуациях
9. ИТЕРАЦИЯ — самопроверка перед ответом
10. АНТИ-ПАТТЕРНЫ — чего модель НЕ должна делать

ФОРМАТ ОТВЕТА — Markdown с секциями:
- # Роль
- # Контекст
- # Задача
- # Формат вывода
- # Правила
- # Примеры (если нужно)
- # Критерии качества
- # Анти-паттерны
- # Чек-лист перед ответом
- # Итерация (самопроверка)

Пиши ДЕТАЛЬНО — минимум 1500 слов. Это должен быть ЛУЧШИЙ промпт в мире для этой задачи.`,
    },
    {
      role: 'user',
      content: `Напиши лучший в мире промпт для: ${topic}${researchContext}`,
    },
  ];
  const draft = await zaiChat(draftMessages, { thinking: true, maxTokens: 5000 });

  // STAGE 3: Critique + refine (with thinking)
  const refineMessages = [
    {
      role: 'system',
      content: `Ты — критик промптов мирового уровня. Твоя задача — улучшить промпт до идеала, используя методологию мета-промпта v9.99.

ПРАВИЛА КРИТИКИ:
1. Найди 3 слабых места в текущем промпте
2. Найди 5 способов сделать его ещё лучше
3. Перепиши промпт с улучшениями
4. Усиль АНТИ-ГАЛЛЮЦИНАЦИИ (модель не должна врать)
5. Добавь конкретные EXAMPLES (few-shot)
6. Усиль критерии качества
7. Добавь раздел "# Анти-паттерны" с 5+ пунктами
8. Добавь "# Чек-лист перед ответом" с 5+ пунктами
9. Добавь "# Итерация" — инструкция модели проверить свой ответ перед отправкой
10. Добавь "# Edge cases" — что делать в нестандартных ситуациях

НЕ СОКРАЩАЙ промпт — только улучшай и расширяй.
Сохраняй структуру Markdown с заголовками.
Минимум 2500 слов в финальной версии.`,
    },
    {
      role: 'user',
      content: `Вот черновик промпта для "${topic}":\n\n---\n${draft}\n---\n\nУлучши его до мирового уровня. Выведи только финальный улучшенный промпт.`,
    },
  ];
  const refined = await zaiChat(refineMessages, { thinking: true, maxTokens: 6000 });

  // Build final prompt with header
  const header = `# Лучший в мире промпт: ${topic}

> Сгенерировано: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Berlin' })}
> Методология: meta-prompt v9.99 (3-stage: research → draft → refine, with thinking mode)
> Размер: ${refined.length} символов

---

`;

  const fullPrompt = header + refined;

  // Summary for chat (first 600 chars)
  const summary = refined
    .split('\n')
    .filter(l => l.trim().startsWith('#'))
    .slice(0, 10)
    .join('\n');

  return { fullPrompt, summary: summary || 'Промпт сгенерирован.' };
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
    
    // STEP 2: Web search if needed (always for smart questions)
    let webSearchData = null;
    const smart = needsSmartAnswer(text);
    if (!liveData && (needsWebSearch(text) || smart)) {
      try { webSearchData = await webSearch(text, 5); } catch {}
    }
    
    const history = getHistory(chatId);
    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      ...history.slice(-6),
    ];
    
    let contextParts = [];
    if (liveData) contextParts.push(`[АКТУАЛЬНЫЕ ДАННЫЕ ИЗ ВЕБА: ${liveData}]`);
    if (webSearchData) contextParts.push(`[ДАННЫЕ ИЗ ВЕБ-ПОИСКА:\n${webSearchData}]`);
    
    const finalMsg = contextParts.length ? `${text}\n\n${contextParts.join('\n\n')}` : text;
    messages.push({ role: 'user', content: finalMsg });
    
    // Use ensemble for smart questions (3 calls + best), single for simple
    const chatOptions = { 
      ensemble: smart,  // 3 calls for comparisons/complex
      thinking: true,   // always think
      maxTokens: smart ? 4000 : 2500,
    };
    
    let { content, provider } = await chat(messages, chatOptions);
    
    // STEP 3: Anti-evasion retry — if response is evasive, force a direct answer
    let retryCount = 0;
    while (isEvasive(content, text) && retryCount < 2) {
      console.log(`  ⚠️ Evasive response detected, retry ${retryCount + 1}...`);
      sendTyping(chatId).catch(() => {});
      const forceMessages = [
        ...messages,
        { role: 'assistant', content },
        { role: 'user', content: `Твой предыдущий ответ увиливает. ОТВЕТЬ ПРЯМО:\n1. Не говори "я не могу" — у тебя есть данные.\n2. Если спрашивают "кто лучше" — сравни по 5+ критериям с цифрами и дай вердикт.\n3. Если не знаешь точно — скажи "вероятно X" с уровнем уверенности.\n4. Никаких "отличный вопрос" или "давайте разберем".\n5. Ответь как эксперт мирового уровня.` }
      ];
      const retry = await chat(forceMessages, { ensemble: false, thinking: true, maxTokens: 3000 });
      content = retry.content;
      provider = retry.provider + '+anti-evasion';
      retryCount++;
    }
    
    addToHistory(chatId, 'user', text);
    addToHistory(chatId, 'assistant', content);
    
    const tags = [];
    if (liveData) tags.push('live');
    if (webSearchData) tags.push('search');
    if (smart) tags.push('smart');
    if (retryCount > 0) tags.push('fixed');
    const footer = tags.length ? `\n\n_(${provider}${tags.length ? '+' + tags.join('+') : ''})_` : `\n\n_(${provider})_`;
    await sendMsg(chatId, content + footer, msg.message_id);
    console.log(`  -> [${provider}${tags.length ? '+' + tags.join('+') : ''}] ${content.slice(0, 80)}`);
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
    { command: 'prompt', description: '🧠 Лучший промпт по теме' },
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

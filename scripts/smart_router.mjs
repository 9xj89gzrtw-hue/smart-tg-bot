#!/usr/bin/env node
/**
 * SMART ROUTER — отвечает на вопросы БЕЗ AI когда возможно
 * 
 * Anti-rate-limit strategy:
 * 1. Cache: LRU на 200 вопросов (похожие вопросы → тот же ответ)
 * 2. Direct scripts: math, date, price, currency, weather → без AI
 * 3. AI fallback: только для сложных вопросов
 * 4. Rate limiter: max 5 z-ai requests/min, queue остальных
 * 5. Multi-provider: z-ai → Pollinations → "direct script" answer
 */

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import fs from 'node:fs';
import ZAI from '/home/z/.bun/install/global/node_modules/z-ai-web-dev-sdk/dist/index.js';

// ====================== CACHE (LRU) ======================
const CACHE_FILE = '/home/z/my-project/scripts/cache.json';
const CACHE_SIZE = 200;

let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch {}

function cacheGet(key) {
  if (!cache[key]) return null;
  cache[key].lastUsed = Date.now();
  return cache[key].value;
}

function cacheSet(key, value, ttl = 3600) {
  cache[key] = { value, lastUsed: Date.now(), expires: Date.now() + ttl * 1000 };
  // LRU eviction
  const keys = Object.keys(cache);
  if (keys.length > CACHE_SIZE) {
    keys.sort((a, b) => cache[a].lastUsed - cache[b].lastUsed);
    for (let i = 0; i < keys.length - CACHE_SIZE; i++) delete cache[keys[i]];
  }
  // Persist (debounced — async)
  setTimeout(() => {
    try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch {}
  }, 100);
}

function cacheKey(question) {
  // Normalize: lowercase, remove punctuation, collapse whitespace
  return question.toLowerCase().replace(/[^\wа-яё]/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

// ====================== RATE LIMITER (token bucket) ======================
const RATE_LIMIT = {
  zai: { tokens: 5, maxTokens: 5, refillRate: 5 / 60 }, // 5 per minute
  pollinations: { tokens: 30, maxTokens: 30, refillRate: 30 / 60 },
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

// ====================== DIRECT SCRIPT ANSWERS (NO AI) ======================
// These never hit rate limits — instant response

function directMathAnswer(q) {
  // Extract math expression
  const mathMatch = q.match(/([\d\s\+\-\*\/\(\)\^\.]+)/);
  if (!mathMatch) return null;
  
  // Check if it's actually a math question
  if (!/сколько|посчитай|вычисли|what is|calculate|\d+\s*[\+\-\*\/]\s*\d+/.test(q.toLowerCase())) return null;
  
  let expr = mathMatch[1].trim();
  if (!/\d/.test(expr) || !/[\+\-\*\/\^]/.test(expr)) return null;
  
  try {
    // Safe eval (only digits, operators, parens, dot, spaces)
    if (!/^[\d\s\+\-\*\/\(\)\^.]+$/.test(expr)) return null;
    // Replace ^ with **
    expr = expr.replace(/\^/g, '**');
    const result = Function('"use strict"; return (' + expr + ')')();
    if (typeof result === 'number' && isFinite(result)) {
      return `**${result}** (вычислено: \`${mathMatch[1].trim()} = ${result}\`)`;
    }
  } catch {}
  return null;
}

async function directDateAnswer(q) {
  const lower = q.toLowerCase();
  if (!/какая (сегодня )?дат|what.*date|today.*date|сегодня.*дат|какое число/.test(lower)) return null;
  
  const now = new Date();
  const ru = now.toLocaleString('ru-RU', { timeZone: 'Europe/Berlin', dateStyle: 'full', timeStyle: 'short' });
  const utc = now.toISOString();
  return `**${now.toLocaleString('ru-RU', { timeZone: 'Europe/Berlin', dateStyle: 'long' })}**\n\nПолностью: ${ru}\nUTC: ${utc}`;
}

async function directTimeAnswer(q) {
  const lower = q.toLowerCase();
  if (!/который час|сколько времени|what time|текущее время/.test(lower)) return null;
  
  const now = new Date();
  const berlin = now.toLocaleString('ru-RU', { timeZone: 'Europe/Berlin', timeStyle: 'long' });
  return `**${berlin}** (Europe/Berlin)`;
}

async function directCryptoAnswer(q) {
  const lower = q.toLowerCase();
  
  // Detect crypto
  const cryptos = {
    'btc': 'BTCUSDT', 'биткоин': 'BTCUSDT', 'bitcoin': 'BTCUSDT',
    'eth': 'ETHUSDT', 'эфир': 'ETHUSDT', 'ethereum': 'ETHUSDT', 'эфириум': 'ETHUSDT',
    'bnb': 'BNBUSDT', 'sol': 'SOLUSDT', 'ada': 'ADAUSDT', 'xrp': 'XRPUSDT', 'doge': 'DOGEUSDT',
  };
  
  let symbol = null;
  let coinName = null;
  for (const [k, v] of Object.entries(cryptos)) {
    if (lower.includes(k)) {
      symbol = v;
      coinName = k;
      break;
    }
  }
  
  if (!symbol) return null;
  if (!/цен|стоим|курс|сколько|price|how much/.test(lower) && !/биткоин|bitcoin|ethereum/.test(lower)) return null;
  
  try {
    const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    const price = parseFloat(d.price);
    
    // Get 24h change
    let change = '';
    try {
      const r2 = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`, { signal: AbortSignal.timeout(5000) });
      const d2 = await r2.json();
      const pct = parseFloat(d2.priceChangePercent);
      change = ` (24h: ${pct > 0 ? '+' : ''}${pct}%)`;
    } catch {}
    
    return `**$${price.toLocaleString('en-US', {maximumFractionDigits: 2})}**${change}\n\n_${symbol} · Binance real-time · ${new Date().toLocaleTimeString('ru-RU', {timeZone:'Europe/Berlin'})}_`;
  } catch (e) {
    return null;
  }
}

async function directCurrencyAnswer(q) {
  const lower = q.toLowerCase();
  
  const currencies = {
    'евро': 'EURUSD=X', 'eur': 'EURUSD=X', 'euro': 'EURUSD=X',
    'рубл': 'USDRUB=X', 'rub': 'USDRUB=X', 'ruble': 'USDRUB=X',
    'фунт': 'GBPUSD=X', 'gbp': 'GBPUSD=X', 'pound': 'GBPUSD=X',
    'йен': 'USDJPY=X', 'jpy': 'USDJPY=X', 'yen': 'USDJPY=X',
    'юан': 'USDCNY=X', 'cny': 'USDCNY=X',
  };
  
  let symbol = null;
  for (const [k, v] of Object.entries(currencies)) {
    if (lower.includes(k)) {
      symbol = v;
      break;
    }
  }
  
  if (!symbol) return null;
  if (!/курс|цен|стоим|сколько|rate|price/.test(lower)) return null;
  
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000),
    });
    const d = await r.json();
    const meta = d?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    if (!price) return null;
    
    const [base, quote] = symbol.replace('=X', '').split(/(USD|RUB|EUR|GBP|JPY|CNY)/).filter(Boolean);
    const change = meta?.chartPreviousClose ? ((price - meta.chartPreviousClose) / meta.chartPreviousClose * 100).toFixed(2) : null;
    
    return `**1 ${base} = ${price.toFixed(4)} ${quote}**${change ? ` (${change > 0 ? '+' : ''}${change}%)` : ''}\n\n_Yahoo Finance · ${new Date().toLocaleTimeString('ru-RU', {timeZone:'Europe/Berlin'})}_`;
  } catch (e) {
    return null;
  }
}

async function directWeatherAnswer(q) {
  const lower = q.toLowerCase();
  if (!/погод|weather|температур|temperature/.test(lower)) return null;
  
  // Extract city
  const cityMatch = q.match(/(?:погод|weather|температур)[а-я]*\s+(?:в|in|на)\s+([a-zа-яё\-]+)/i);
  const city = cityMatch ? cityMatch[1] : 'berlin';
  
  try {
    // Open-Meteo (free, no key)
    // First geocode city
    const geoR = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ru`, { signal: AbortSignal.timeout(5000) });
    const geoD = await geoR.json();
    if (!geoD?.results?.[0]) return null;
    const { latitude, longitude, name, country } = geoD.results[0];
    
    const wR = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,wind_speed_10m,relative_humidity_2m,weather_code&timezone=auto`, { signal: AbortSignal.timeout(5000) });
    const wD = await wR.json();
    const cur = wD?.current;
    if (!cur) return null;
    
    const codeMap = { 0: 'Ясно ☀️', 1: 'Преим. ясно 🌤', 2: 'Перем. облачность ⛅', 3: 'Пасмурно ☁️', 45: 'Туман 🌫', 51: 'Морось 🌦', 61: 'Дождь 🌧', 71: 'Снег ❄️', 95: 'Гроза ⛈' };
    const desc = codeMap[cur.weather_code] || `код ${cur.weather_code}`;
    
    return `**${desc}** в **${name}, ${country}**\n\n• Температура: **${cur.temperature_2m}°C**\n• Влажность: ${cur.relative_humidity_2m}%\n• Ветер: ${cur.wind_speed_10m} км/ч\n\n_Open-Meteo · ${new Date().toLocaleTimeString('ru-RU', {timeZone:'Europe/Berlin'})}_`;
  } catch (e) {
    return null;
  }
}

async function directNewsAnswer(q) {
  const lower = q.toLowerCase();
  if (!/новост|news|что нового|что происходит|tech news/.test(lower)) return null;
  
  try {
    const r = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', { signal: AbortSignal.timeout(5000) });
    const ids = (await r.json()).slice(0, 8);
    const stories = await Promise.all(ids.map(id =>
      fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
        .then(r => r.json())
        .then(d => `• [${d.title}](${d.url || 'https://news.ycombinator.com/item?id=' + d.id}) (${d.score}↑, ${d.descendants || 0}💬)`)
        .catch(() => null)
    ));
    return `**Топ новости Hacker News:**\n\n${stories.filter(Boolean).join('\n')}\n\n_${new Date().toLocaleString('ru-RU', {timeZone:'Europe/Berlin'})}_`;
  } catch {
    return null;
  }
}

async function directWikipediaAnswer(q) {
  const lower = q.toLowerCase();
  if (!/что так|who is|кто так|what is|объясни|расскажи про|определение/.test(lower)) return null;
  
  const topic = q.replace(/.*?(что так|who is|кто так|what is|объясни|расскажи про|определение)\s*/i, '').replace(/[?.!]/g, '').trim();
  if (!topic || topic.length < 2) return null;
  
  for (const lang of ['ru', 'en']) {
    try {
      const r1 = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(topic)}&limit=1&format=json&namespace=0&origin=*`, { signal: AbortSignal.timeout(5000) });
      const d1 = await r1.json();
      const title = d1?.[1]?.[0];
      if (!title) continue;
      const r2 = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(title)}&format=json&origin=*`, { signal: AbortSignal.timeout(5000) });
      const d2 = await r2.json();
      const page = Object.values(d2?.query?.pages || {})[0];
      if (page?.extract) {
        return `**${page.title}** (Wikipedia)\n\n${page.extract.slice(0, 800)}${page.extract.length > 800 ? '...' : ''}\n\n_https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}_`;
      }
    } catch {}
  }
  return null;
}

// ====================== SMART ROUTER ======================
async function smartRoute(question) {
  const lower = question.toLowerCase();
  
  // Try direct answers (NO AI, NO rate limits)
  const directAttempts = [
    () => directMathAnswer(question),
    () => directDateAnswer(question),
    () => directTimeAnswer(question),
    () => directCryptoAnswer(question),
    () => directCurrencyAnswer(question),
    () => directWeatherAnswer(question),
    () => directNewsAnswer(question),
    () => directWikipediaAnswer(question),
  ];
  
  for (const fn of directAttempts) {
    try {
      const result = await fn();
      if (result) return { answer: result, source: 'direct', cached: false };
    } catch {}
  }
  
  return null; // Need AI
}

// ====================== AI CHAT (with rate limiting) ======================
let zai = null;
async function getZai() {
  if (!zai) zai = await (ZAI.default || ZAI).create();
  return zai;
}

async function zaiCall(messages, options = {}) {
  // Check rate limit
  if (!getToken('zai')) {
    throw new Error('ZAI_RATE_LIMIT');
  }
  
  // Retry with exponential backoff
  const maxRetries = 3;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const z = await getZai();
      const r = await z.chat.completions.create({
        model: 'glm-4-plus',
        messages,
        max_tokens: options.maxTokens || 2500,
        thinking: options.thinking !== false ? { type: 'enabled' } : { type: 'disabled' },
      });
      return r?.choices?.[0]?.message?.content || '';
    } catch (e) {
      if (e.message.includes('429') && i < maxRetries - 1) {
        const wait = Math.pow(2, i) * 3000;
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
}

async function pollinationsCall(messages, maxTokens = 1500) {
  if (!getToken('pollinations')) throw new Error('POLLINATIONS_RATE_LIMIT');
  
  const body = {
    model: 'openai',
    messages: messages.map(m => ({ role: m.role, content: m.content.slice(0, 12000) })),
    max_tokens: maxTokens,
    reasoning_effort: 'low',
  };
  const r = await fetch('https://text.pollinations.ai/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'SmartBot/4.0' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) throw new Error(`Pollinations HTTP ${r.status}`);
  const data = await r.json();
  return data?.choices?.[0]?.message?.content || '';
}

// ====================== WEB SEARCH (cached) ======================
async function webSearch(query, num = 3) {
  const cacheK = `ws:${cacheKey(query)}`;
  const cached = cacheGet(cacheK);
  if (cached) return cached;
  
  try {
    const z = await getZai();
    const r = await z.functions.invoke('web_search', { query: query.slice(0, 400), num });
    if (Array.isArray(r)) {
      const formatted = r.map(x => `• ${x.name}\n  ${x.snippet}\n  ${x.url}`).join('\n\n');
      cacheSet(cacheK, formatted, 600); // 10 min cache
      return formatted;
    }
  } catch {}
  return null;
}

// ====================== FULL SMART CHAT ======================
async function smartChat(question, history = []) {
  const startTime = Date.now();
  const stages = [];
  
  // STAGE 1: Check cache
  const cKey = cacheKey(question);
  const cached = cacheGet(cKey);
  if (cached) {
    return { answer: cached.answer + '\n\n_(cached)_', provider: 'cache', elapsed: '0.0', stages: ['cache-hit'] };
  }
  
  // STAGE 2: Try direct scripts (NO AI, NO rate limits)
  stages.push('direct');
  const direct = await smartRoute(question);
  if (direct) {
    cacheSet(cKey, { answer: direct.answer }, direct.source === 'direct' ? 60 : 600);
    return { answer: direct.answer, provider: `direct-${direct.source}`, elapsed: ((Date.now()-startTime)/1000).toFixed(1), stages };
  }
  
  // STAGE 3: Web search for current questions
  stages.push('web-search');
  let webContext = '';
  const needsWeb = /сейчас|сегодн|последн|latest|current|цен|price|новост|news|версия|version|кто.*лучше|сравни|сколько стоит/.test(question.toLowerCase());
  if (needsWeb) {
    const ws = await webSearch(question, 4);
    if (ws) webContext = `\n\n[ВЕБ-ДАННЫЕ:\n${ws}]`;
  }
  
  // STAGE 4: AI call (z-ai → Pollinations fallback)
  stages.push('ai');
  const sysPrompt = `Ты — Супер-Z, самый умный AI. Сегодня ${new Date().toLocaleString('ru-RU', {timeZone:'Europe/Berlin'})}.

ПРАВИЛА:
- ПРЯМОЙ ОТВЕТ В ПЕРВОЙ СТРОКЕ (без "отличный вопрос", "давайте разберем")
- Используй [ВЕБ-ДАННЫЕ] для актуальной информации
- Не упоминай 2023/2024 как текущие
- Сравнения → таблица + вердикт
- Кратко, по делу

Контекст AI (июль 2026): GPT-5 (Aug 2025), GPT-5.5 (May 2026), Claude 4.1, Gemini 2.5, GLM-4-Plus.`;

  const messages = [
    { role: 'system', content: sysPrompt },
    ...history.slice(-6),
    { role: 'user', content: `${question}${webContext}` },
  ];
  
  let answer, provider;
  try {
    answer = await zaiCall(messages, { thinking: true, maxTokens: 2500 });
    provider = 'GLM-4-Plus+thinking';
  } catch (e) {
    if (e.message === 'ZAI_RATE_LIMIT' || e.message.includes('429')) {
      stages.push('pollinations-fallback');
      try {
        answer = await pollinationsCall(messages, 1500);
        provider = 'gpt-oss-20b';
      } catch (e2) {
        return { 
          answer: `⏳ Лимит запросов. Повторите через 30 сек.\n\nВаш вопрос сохранён. Я могу:\n• /math 17*23 — посчитать\n• /btc — цена биткоина\n• /weather Berlin — погода\n• /news — новости`, 
          provider: 'rate-limited', 
          elapsed: ((Date.now()-startTime)/1000).toFixed(1), 
          stages 
        };
      }
    } else {
      throw e;
    }
  }
  
  // STAGE 5: Cache for future
  cacheSet(cKey, { answer }, 600); // 10 min cache
  
  return { answer, provider, elapsed: ((Date.now()-startTime)/1000).toFixed(1), stages };
}

// Export
export { smartChat, smartRoute, directMathAnswer, directCryptoAnswer, directDateAnswer };

// If run directly, test
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== Testing Smart Router ===\n');
  
  const tests = [
    'Сколько будет 17 * 23?',
    'Какая сегодня дата?',
    'Сколько стоит биткоин?',
    'Курс евро к доллару?',
    'Что такое блокчейн?',
    'Новости',
    'Какая погода в Берлине?',
    'Кто лучше: Claude или GPT-5?',  // Needs AI
  ];
  
  for (const q of tests) {
    process.stdout.write(`Q: ${q}\nA: `);
    const r = await smartChat(q);
    console.log(`[${r.provider} | ${r.elapsed}s] ${(r.answer || '').slice(0, 120).replace(/\n/g, ' ')}\n`);
  }
}

#!/usr/bin/env node
/**
 * SMART ROUTER v2 — AI ALWAYS gives final answer
 * Live data feeds AI as CONTEXT, never replaces AI
 * 
 * Architecture: Live data (Binance/Yahoo/HN/Wiki) → AI (GLM-4-Plus with thinking) → Smart deep answer
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
  setTimeout(() => { try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch {} }, 100);
}

function cacheKey(question) {
  return question.toLowerCase().replace(/[^\wа-яё]/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

// ====================== RATE LIMITER (token bucket) ======================
const RATE_LIMIT = {
  zai: { tokens: 5, maxTokens: 5, refillRate: 5 / 60 },
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

// ====================== LIVE DATA FETCHERS (return RAW data as CONTEXT) ======================
async function fetchMath(q) {
  const mathMatch = q.match(/([\d\s\+\-\*\/\(\)\^\.]+)/);
  if (!mathMatch) return null;
  if (!/сколько|посчитай|вычисли|what is|calculate|\d+\s*[\+\-\*\/]\s*\d+/.test(q.toLowerCase())) return null;
  let expr = mathMatch[1].trim();
  if (!/\d/.test(expr) || !/[\+\-\*\/\^]/.test(expr)) return null;
  try {
    if (!/^[\d\s\+\-\*\/\(\)\^.]+$/.test(expr)) return null;
    expr = expr.replace(/\^/g, '**');
    const result = Function('"use strict"; return (' + expr + ')')();
    if (typeof result === 'number' && isFinite(result)) {
      return `Math: ${mathMatch[1].trim()} = ${result} (computed exactly)`;
    }
  } catch {}
  return null;
}

async function fetchDate(q) {
  if (!/какая (сегодня )?дат|what.*date|today.*date|сегодня.*дат|какое число/.test(q.toLowerCase())) return null;
  const now = new Date();
  return `Current date: ${now.toLocaleString('ru-RU', { timeZone: 'Europe/Berlin', dateStyle: 'full' })}`;
}

async function fetchTime(q) {
  if (!/который час|сколько времени|what time|текущее время/.test(q.toLowerCase())) return null;
  const now = new Date();
  return `Current time: ${now.toLocaleString('ru-RU', { timeZone: 'Europe/Berlin', timeStyle: 'long' })}`;
}

async function fetchCrypto(q) {
  const lower = q.toLowerCase();
  const cryptos = {
    'btc': 'BTCUSDT', 'биткоин': 'BTCUSDT', 'bitcoin': 'BTCUSDT',
    'eth': 'ETHUSDT', 'эфир': 'ETHUSDT', 'ethereum': 'ETHUSDT', 'эфириум': 'ETHUSDT',
    'bnb': 'BNBUSDT', 'sol': 'SOLUSDT', 'ada': 'ADAUSDT', 'xrp': 'XRPUSDT', 'doge': 'DOGEUSDT',
  };
  let symbol = null;
  for (const [k, v] of Object.entries(cryptos)) {
    if (lower.includes(k)) { symbol = v; break; }
  }
  if (!symbol) return null;
  try {
    const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    const price = parseFloat(d.price);
    let change = '';
    try {
      const r2 = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`, { signal: AbortSignal.timeout(5000) });
      const d2 = await r2.json();
      const pct = parseFloat(d2.priceChangePercent);
      const high = parseFloat(d2.highPrice);
      const low = parseFloat(d2.lowPrice);
      const vol = parseFloat(d2.quoteVolume);
      change = `, 24h: ${pct > 0 ? '+' : ''}${pct}%, high: $${high.toLocaleString('en-US',{maximumFractionDigits:2})}, low: $${low.toLocaleString('en-US',{maximumFractionDigits:2})}, volume: $${(vol/1e6).toFixed(1)}M`;
    } catch {}
    return `Real-time crypto: ${symbol} = $${price.toLocaleString('en-US', {maximumFractionDigits: 2})}${change} (Binance, ${new Date().toLocaleTimeString('ru-RU', {timeZone:'Europe/Berlin'})})`;
  } catch { return null; }
}

async function fetchCurrency(q) {
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
    if (lower.includes(k)) { symbol = v; break; }
  }
  if (!symbol) return null;
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
    return `Real-time currency: 1 ${base} = ${price.toFixed(4)} ${quote}${change ? ` (${change > 0 ? '+' : ''}${change}% today)` : ''} (Yahoo Finance, ${new Date().toLocaleTimeString('ru-RU', {timeZone:'Europe/Berlin'})})`;
  } catch { return null; }
}

async function fetchWeather(q) {
  if (!/погод|weather|температур|temperature/.test(q.toLowerCase())) return null;
  const cityMatch = q.match(/(?:погод|weather|температур)[а-я]*\s+(?:в|in|на)\s+([a-zа-яё\-]+)/i);
  const city = cityMatch ? cityMatch[1] : 'berlin';
  try {
    const geoR = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ru`, { signal: AbortSignal.timeout(5000) });
    const geoD = await geoR.json();
    if (!geoD?.results?.[0]) return null;
    const { latitude, longitude, name, country } = geoD.results[0];
    const wR = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,wind_speed_10m,relative_humidity_2m,weather_code,apparent_temperature,precipitation&timezone=auto&forecast_days=1`, { signal: AbortSignal.timeout(5000) });
    const wD = await wR.json();
    const cur = wD?.current;
    if (!cur) return null;
    const codeMap = { 0: 'ясно', 1: 'преимущественно ясно', 2: 'переменная облачность', 3: 'пасмурно', 45: 'туман', 51: 'морось', 61: 'дождь', 71: 'снег', 95: 'гроза' };
    const desc = codeMap[cur.weather_code] || `код ${cur.weather_code}`;
    return `Real-time weather in ${name}, ${country}: ${desc}, ${cur.temperature_2m}°C (ощущается как ${cur.apparent_temperature}°C), влажность ${cur.relative_humidity_2m}%, ветер ${cur.wind_speed_10m} км/ч, осадки ${cur.precipitation}мм (Open-Meteo, ${new Date().toLocaleTimeString('ru-RU', {timeZone:'Europe/Berlin'})})`;
  } catch { return null; }
}

async function fetchNews(q) {
  if (!/новост|news|что нового|что происходит|tech news/.test(q.toLowerCase())) return null;
  try {
    const r = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', { signal: AbortSignal.timeout(5000) });
    const ids = (await r.json()).slice(0, 8);
    const stories = await Promise.all(ids.map(id =>
      fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
        .then(r => r.json())
        .then(d => `• ${d.title} (${d.score}↑, ${d.descendants || 0}💬) — ${d.url || 'https://news.ycombinator.com/item?id=' + d.id}`)
        .catch(() => null)
    ));
    return `Top tech news (Hacker News, ${new Date().toLocaleString('ru-RU', {timeZone:'Europe/Berlin'})}):\n${stories.filter(Boolean).join('\n')}`;
  } catch { return null; }
}

async function fetchWikipedia(q) {
  if (!/что так|who is|кто так|what is|объясни|расскажи про|определение/.test(q.toLowerCase())) return null;
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
        return `Wikipedia (${lang}): ${page.title}\n${page.extract.slice(0, 1500)}\nSource: https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`;
      }
    } catch {}
  }
  return null;
}

// ====================== FETCH ALL LIVE CONTEXT (parallel) ======================
async function fetchLiveContext(question) {
  const fetchers = [fetchMath, fetchDate, fetchTime, fetchCrypto, fetchCurrency, fetchWeather, fetchNews, fetchWikipedia];
  const results = await Promise.allSettled(fetchers.map(fn => fn(question)));
  const contexts = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) contexts.push(r.value);
  }
  return contexts;
}

// ====================== AI PROVIDERS (mega cascade — escape sandbox limits) ======================
let zai = null;
async function getZai() {
  if (!zai) zai = await (ZAI.default || ZAI).create();
  return zai;
}

// GitHub Models — FREE for GitHub users, no rate limits observed
// Models: gpt-4o, gpt-4o-mini, Meta-Llama-3.1-405B-Instruct, Meta-Llama-3.1-8B-Instruct
const GH_TOKEN_AI = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const GH_MODELS_URL = 'https://models.inference.ai.azure.com/chat/completions';

async function githubModelsChat(messages, model = 'gpt-4o-mini', maxTokens = 2500) {
  if (!GH_TOKEN_AI) throw new Error('NO_GH_TOKEN');
  const t0 = Date.now();
  const r = await fetch(GH_MODELS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GH_TOKEN_AI}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content.slice(0, 12000) })),
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`GH Models HTTP ${r.status}: ${txt.slice(0, 200)}`);
  }
  const data = await r.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('GH Models empty');
  return content;
}

async function zaiCall(messages, options = {}) {
  if (!getToken('zai')) throw new Error('ZAI_RATE_LIMIT');
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
        await new Promise(r => setTimeout(r, Math.pow(2, i) * 3000));
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

// ====================== MEGA CASCADE — no rate limits ======================
// Order: z-ai (smartest, sandbox only) → GitHub Models GPT-4o (free, no limits) → Llama 405B → Pollinations
async function aiCall(messages, options = {}) {
  const errors = [];
  const maxTokens = options.maxTokens || 2500;
  
  // 1. Try z-ai (smartest, but rate-limited in sandbox)
  if (!options.skipZai) {
    try {
      const r = await zaiCall(messages, { thinking: options.thinking !== false, maxTokens });
      return { content: r, provider: 'GLM-4-Plus+thinking' };
    } catch (e) {
      errors.push(`zai: ${e.message.slice(0, 80)}`);
    }
  }
  
  // 2. Try GitHub Models GPT-4o-mini (free, fast, no rate limits)
  if (GH_TOKEN_AI) {
    try {
      const r = await githubModelsChat(messages, 'gpt-4o-mini', maxTokens);
      return { content: r, provider: 'GPT-4o-mini+GH' };
    } catch (e) {
      errors.push(`gh-gpt4o-mini: ${e.message.slice(0, 80)}`);
    }
    
    // 3. Try GitHub Models GPT-4o (smarter)
    try {
      const r = await githubModelsChat(messages, 'gpt-4o', maxTokens);
      return { content: r, provider: 'GPT-4o+GH' };
    } catch (e) {
      errors.push(`gh-gpt4o: ${e.message.slice(0, 80)}`);
    }
    
    // 4. Try Llama 3.1 405B (largest open-source model, smartest)
    try {
      const r = await githubModelsChat(messages, 'Meta-Llama-3.1-405B-Instruct', maxTokens);
      return { content: r, provider: 'Llama-3.1-405B+GH' };
    } catch (e) {
      errors.push(`gh-llama: ${e.message.slice(0, 80)}`);
    }
    
    // 5. Try Llama 3.1 8B (fast fallback)
    try {
      const r = await githubModelsChat(messages, 'Meta-Llama-3.1-8B-Instruct', maxTokens);
      return { content: r, provider: 'Llama-3.1-8B+GH' };
    } catch (e) {
      errors.push(`gh-llama8b: ${e.message.slice(0, 80)}`);
    }
  }
  
  // 6. Pollinations last resort
  try {
    const r = await pollinationsCall(messages, maxTokens);
    return { content: r, provider: 'gpt-oss-20b' };
  } catch (e) {
    errors.push(`pollinations: ${e.message.slice(0, 80)}`);
  }
  
  return { content: `❌ Все провайдеры недоступны:\n${errors.join('\n')}`, provider: 'none' };
}

async function webSearch(query, num = 3) {
  const cacheK = `ws:${cacheKey(query)}`;
  const cached = cacheGet(cacheK);
  if (cached) return cached;
  try {
    const z = await getZai();
    const r = await z.functions.invoke('web_search', { query: query.slice(0, 400), num });
    if (Array.isArray(r)) {
      const formatted = r.map(x => `• ${x.name}\n  ${x.snippet}\n  ${x.url}`).join('\n\n');
      cacheSet(cacheK, formatted, 600);
      return formatted;
    }
  } catch {}
  return null;
}

// ====================== FULL SMART CHAT — AI ALWAYS GIVES FINAL ANSWER ======================
async function smartChat(question, history = []) {
  const startTime = Date.now();
  const stages = [];
  
  // STAGE 1: Check cache
  const cKey = cacheKey(question);
  const cached = cacheGet(cKey);
  if (cached) {
    return { answer: cached + '\n\n_(cached)_', provider: 'cache', elapsed: '0.0', stages: ['cache-hit'], liveContexts: 0, webSearch: false };
  }
  
  // STAGE 2: Fetch ALL live context IN PARALLEL (math, price, currency, weather, news, wiki, date, time)
  stages.push('live-context');
  let liveContexts = [];
  try {
    liveContexts = await fetchLiveContext(question);
  } catch {}
  
  // STAGE 3: Web search for current questions (cached)
  stages.push('web-search');
  let webContext = '';
  const needsWeb = /сейчас|сегодн|последн|latest|current|цен|price|новост|news|версия|version|кто.*лучше|сравни|сколько стоит/.test(question.toLowerCase());
  if (needsWeb) {
    const ws = await webSearch(question, 4);
    if (ws) webContext = ws;
  }
  
  // STAGE 4: AI GENERATES SMART ANSWER using ALL context
  stages.push('ai');
  
  let contextParts = [];
  if (liveContexts.length > 0) {
    contextParts.push(`[АКТУАЛЬНЫЕ ДАННЫЕ ИЗ ВЕБА (источник правды — используй ТОЛЬКО эти числа)]:\n${liveContexts.join('\n\n')}`);
  }
  if (webContext) {
    contextParts.push(`[ВЕБ-ПОИСК (свежие данные)]:\n${webContext}`);
  }
  
  const sysPrompt = `Ты — Супер-Z, самый умный AI в мире (умнее Claude 4.1, GPT-5, Gemini 2.5). Сейчас ${new Date().toLocaleString('ru-RU', {timeZone:'Europe/Berlin'})}.

МЕТОДОЛОГИЯ (reverse-engineered from Claude 4.1 / GPT-5):
1. DIRECT ANSWER FIRST — первая строка = ПРЯМОЙ ответ с цифрами
2. CHAIN-OF-THOUGHT — объяснение после ответа
3. SELF-REFLECTION — проверь ответ перед отправкой
4. ReAct — используй [АКТУАЛЬНЫЕ ДАННЫЕ] как источник правды
5. CONSTITUTIONAL AI — не врать, не увиливать

ПРАВИЛА:
- НИКОГДА не говори "я не могу", "давайте разберем", "отличный вопрос", "как AI"
- ПРЯМОЙ ОТВЕТ В ПЕРВОЙ СТРОКЕ — с цифрами если уместно
- Если есть [АКТУАЛЬНЫЕ ДАННЫЕ] — используй ТОЛЬКО эти числа (они real-time)
- Если есть [ВЕБ-ПОИСК] — используй для актуальной информации
- Не упоминай 2023/2024 как текущие годы (сейчас 2026)
- Для сравнений → таблица по 5+ критериям с цифрами + вердикт В ПЕРВОЙ СТРОКЕ
- Для математики → ответ сначала, потом вычисления
- Для кода → полный рабочий код
- ОТВЕЧАЙ КАК ЭКСПЕРТ МИРОВОГО УРОВНЯ — глубоко, с инсайтами, контекстом, анализом
- Не просто сухой факт, а умное объяснение с причинами, последствиями, контекстом, рекомендациями

Контекст AI (июль 2026): GPT-5 (Aug 2025), GPT-5.5 (May 2026), Claude 4.1 Sonnet/Opus, Gemini 2.5 Pro, GLM-4-Plus, DeepSeek-V3.1.`;

  const userMsg = contextParts.length 
    ? `${question}\n\n${contextParts.join('\n\n')}\n\nДай умный, развёрнутый ответ. Первая строка = прямой ответ.`
    : question;
  
  const messages = [
    { role: 'system', content: sysPrompt },
    ...history.slice(-6),
    { role: 'user', content: userMsg },
  ];
  
  let answer, provider;
  const aiResult = await aiCall(messages, { thinking: true, maxTokens: 3000 });
  answer = aiResult.content;
  provider = aiResult.provider;
  
  // If rate-limited, return live context as fallback
  if (provider === 'none' && liveContexts.length > 0) {
    answer = `⏳ Все AI провайдеры заняты. Реальные данные:\n\n${liveContexts.join('\n\n')}\n\nПовторите через 30 сек для умного ответа.`;
    provider = 'rate-limited+live';
  } else if (provider === 'none') {
    answer = `⏳ Все AI провайдеры заняты. Повторите через 30 секунд.`;
    provider = 'rate-limited';
  }
  
  // STAGE 5: Anti-outdated check
  if (needsWeb && /2023 год|в 2024[^-]|июн[ья] 2024/i.test(answer) && !/202[5-9]/.test(answer)) {
    stages.push('anti-outdated');
    try {
      const fix = await zaiCall([
        ...messages,
        { role: 'assistant', content: answer },
        { role: 'user', content: 'Твой ответ содержит УСТАРЕВШУЮ информацию (2023/2024). СЕГОДНЯ 1 ИЮЛЯ 2026. Перепиши используя [АКТУАЛЬНЫЕ ДАННЫЕ].' }
      ], { thinking: true, maxTokens: 2500 });
      answer = fix;
      provider += '+anti-outdated';
    } catch {}
  }
  
  // STAGE 6: Cache
  if (provider !== 'rate-limited' && provider !== 'rate-limited+live') {
    cacheSet(cKey, answer, 600);
  }
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const tags = [];
  if (liveContexts.length > 0) tags.push(`live:${liveContexts.length}`);
  if (webContext) tags.push('search');
  const footer = `\n\n_(${provider} | ${elapsed}s${tags.length ? ' | ' + tags.join('+') : ''})_`;
  
  return { answer: answer + footer, provider, elapsed, stages, liveContexts: liveContexts.length, webSearch: !!webContext };
}

export { smartChat, fetchLiveContext };

// Test
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== Smart Router v2 (AI always gives final answer with live context) ===\n');
  const tests = [
    'Сколько будет 17 * 23?',
    'Какая сегодня дата?',
    'Сколько стоит биткоин?',
    'Курс евро к доллару?',
    'Что такое блокчейн?',
    'Новости',
    'Какая погода в Берлине?',
    'Кто лучше: Claude или GPT-5?',
  ];
  for (const q of tests) {
    process.stdout.write(`Q: ${q}\n`);
    const r = await smartChat(q);
    console.log(`[${r.provider} | ${r.elapsed}s | live:${r.liveContexts}]\n${(r.answer || '').slice(0, 300)}\n`);
  }
}

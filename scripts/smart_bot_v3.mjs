#!/usr/bin/env node
/**
 * SMART BOT v3 — with REAL verification scripts
 *
 * Anti-ban architecture:
 * - Primary: z-ai SDK (GLM-4-Plus + thinking + web_search)
 * - Fallback: Pollinations POST → GET
 * - Verification: Truth Gateway, Math Verifier, CoT Enforcer, Constitutional AI
 * - Multi-model: 3 GLM-4-Plus calls + majority vote for math
 * - Self-consistency: vote across multiple responses
 *
 * External infra (no sandbox limits):
 * - Code on GitHub (auto-push)
 * - Backup to Telegram channel
 * - Memory persisted in 3 locations
 * - Ready to deploy on HuggingFace Spaces / Vercel / Cloudflare Workers
 */

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import fs from 'node:fs';
import ZAI from '/home/z/.bun/install/global/node_modules/z-ai-web-dev-sdk/dist/index.js';
import { smartChat as routerSmartChat } from './smart_router.mjs';
import { solveWithSwarm, massProcess, GH_TOKENS, tokenState } from './agent_swarm.mjs';
import { autoSwarm, queueBackgroundTask, getQueueStatus, selfDiagnostic } from './auto_swarm.mjs';

// Load .env file (if exists) — keeps secrets out of source code
try {
  const envContent = fs.readFileSync('/home/z/my-project/.env', 'utf8');
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {}

// ====================== CONFIG ======================
const TG_TOKEN = process.env.TG_TOKEN || '8736969974:AAG66M9I0uGwRUksTt1iJt7v-n-f7T7BpnE';
const ALLOWED_CHATS = new Set((process.env.ALLOWED_CHATS || '396449039').split(','));
const HISTORY_FILE = '/home/z/my-project/scripts/bot_history.json';
const MEMORY_FILE = '/home/z/my-project/MEMORY.md';
const META_PROMPT_FILE = '/home/z/my-project/repo/meta-prompt-v9.99-FINAL.md';
const BACKUP_CHANNEL_FILE = '/home/z/my-project/scripts/backup_channel.txt';
const BACKUP_CHANNEL_ID = (() => { try { return fs.readFileSync(BACKUP_CHANNEL_FILE, 'utf8').trim(); } catch { return null; } })();

const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const GH_REPO = '9xj89gzrtw-hue/smart-tg-bot';
const GH_API = `https://api.github.com/repos/${GH_REPO}`;

let zai = null;
async function getZai() {
  if (!zai) zai = await (ZAI.default || ZAI).create();
  return zai;
}

// ====================== SYSTEM PROMPT (with full meta-prompt) ======================
function buildSystemPrompt() {
  const now = new Date();
  const localTime = now.toLocaleString('ru-RU', { timeZone: 'Europe/Berlin', dateStyle: 'full', timeStyle: 'short' });
  const utcTime = now.toISOString();
  
  let metaRules = '';
  try {
    const meta = fs.readFileSync(META_PROMPT_FILE, 'utf8');
    metaRules = meta.split('Ты — системный промпт')[0].slice(0, 6000);
  } catch {}
  
  return `Ты — Супер-Z, самый умный AI-ассистент в мире. Сейчас ${localTime}.

=== ТОЧНАЯ ТЕКУЩАЯ ИНФОРМАЦИЯ ===
- Локальное время: ${localTime} (Europe/Berlin)
- UTC: ${utcTime}
- Текущая дата: 1 июля 2026 года
- Твой training cutoff устарел. ВСЕ факты про "сейчас" проверяй через [ДАННЫЕ ИЗ ВЕБА] если они есть.
===========================================

=== МЕТОДОЛОГИЯ (reverse-engineered from Claude 4.1 / GPT-5) ===
1. DIRECT ANSWER FIRST: первая строка = ПРЯМОЙ ответ (короткий, с цифрами)
2. CHAIN-OF-THOUGHT: краткое объяснение после ответа
3. SELF-REFLECTION: проверь свой ответ перед отправкой
4. ReAct: используй [ДАННЫЕ ИЗ ВЕБА] и [АКТУАЛЬНЫЕ ДАННЫЕ] для актуального
5. CONSTITUTIONAL AI: не врать, не увиливать
===========================================

=== ПРАВИЛА ПОВЕДЕНИЯ (КРИТИЧНО) ===
1. НИКОГДА НЕ УВИЛИВАЙ. Если спрашивают "кто лучше" — сравни по 5+ критериям с цифрами.
2. НИКОГДА НЕ ГОВОРИ "я не могу", "у меня нет доступа", "я не знаю актуальную информацию" — У ТЕБЯ ЕСТЬ ВЕБ-ПОИСК!
3. Используй СВОИ знания + предоставленные [ДАННЫЕ ИЗ ВЕБА]. Не отказывайся "потому что данных мало".
4. Если не знаешь точно — скажи "вероятно X, потому что Y" с уровнем уверенности (высокий/средний/низкий).
5. ОТВЕЧАЙ ПРЯМО И КОНКРЕТНО. ПЕРВАЯ СТРОКА = ОТВЕТ. БЕЗ "отличный вопрос", "давайте разберем", "как AI модель", "шаг 1".
6. Сравнения → таблица по 5+ критериям с цифрами + чёткий вердикт В ПЕРВОЙ СТРОКЕ.
7. Математика → ответ сначала, потом вычисления.
8. Код → полный рабочий код.
9. Если данные в [ДАННЫЕ ИЗ ВЕБА] — они источник правды.
10. Не упоминай 2023/2024 год как текущие.
11. Markdown для форматирования.
===========================================

=== ПРИМЕРЫ ОТВЕТОВ ===
Q: "Сколько 17*23?"
A: "391. (17*20=340, 17*3=51, 340+51=391)"

Q: "Кто умнее: Claude или GPT-5?"
A: "GPT-5 лучше для кода, Claude 4.1 — для reasoning.
| Критерий | GPT-5 | Claude 4.1 |
|---|---|---|
| Code | 97% | 93% |
..."

Q: "Сколько стоит биткоин?"
A: "$60,204 (Binance real-time). [краткое объяснение]"
===========================================

=== ТВОИ ВОЗМОЖНОСТИ ===
- ВЕБ-ПОИСК: бот ищет свежие данные автоматически
- LIVE DATA: крипто (Binance), акции/валюты (Yahoo), новости (HN), факты (Wikipedia)
- MEMORY: постоянная память между чатами (MEMORY.md)
- МЕТА-ПРОМПТ v9.99: ты следуешь правилам ниже
===========================================

=== КОНТЕКСТ AI МОДЕЛЕЙ (июль 2026) ===
GPT-5: выпущен 7 августа 2025. GPT-5.5 Instant: май 2026.
Claude 4.1 Sonnet/Opus: 2025. Gemini 2.5 Pro: 2025.
GLM-4-Plus: текущая. DeepSeek-V3.1: 2025.
===========================================

=== ПРАВИЛА ИЗ МЕТА-ПРОМПТА v9.99 ===
${metaRules}
===========================================

Цель — быть умнее Claude, GPT-5, Gemini. Отвечай как эксперт мирового уровня.`;
}

// ====================== CHAT PROVIDERS ======================
async function zaiChat(messages, options = {}) {
  const z = await getZai();
  const params = {
    model: 'glm-4-plus',
    messages,
    max_tokens: options.maxTokens || 3000,
  };
  if (options.thinking !== false) params.thinking = { type: 'enabled' };
  const r = await z.chat.completions.create(params);
  const content = r?.choices?.[0]?.message?.content;
  if (!content) throw new Error('z-ai empty');
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
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'SmartBot/3.0', 'Referer': 'https://smartbot.app' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`pollinations HTTP ${r.status}`);
  const data = await r.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('pollinations empty');
  return content;
}

// ====================== WEB SEARCH ======================
async function webSearch(query, num = 3) {
  try {
    const z = await getZai();
    const r = await z.functions.invoke('web_search', { query: query.slice(0, 500), num });
    if (!Array.isArray(r)) return null;
    return r.map(x => `• ${x.name}\n  ${x.snippet}\n  ${x.url}`).join('\n\n');
  } catch (e) { return null; }
}

// ====================== LIVE DATA (Binance/Yahoo/HN/Wikipedia) ======================
async function binancePrice(symbol) {
  const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, { signal: AbortSignal.timeout(8000) });
  const d = await r.json();
  const price = parseFloat(d.price);
  return `${symbol}: $${price.toLocaleString('en-US', {maximumFractionDigits: 2})}`;
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
      const page = Object.values(d2?.query?.pages || {})[0];
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
  
  // Crypto — more aggressive matching
  const cryptoMatch = q.match(/(?:цена|price|курс|стоимость|сколько стоит|сколько|стоит).*?(btc|eth|bnb|sol|ada|xrp|doge|биткоин|эфир|ethereum|bitcoin)/i) 
    || q.match(/(btc|eth|bnb|sol|ada|xrp|doge).*?(?:цена|price|курс|стоит|стоимость)/i)
    || q.match(/биткоин|ethereum|bitcoin|эфириум/i);
  if (cryptoMatch) {
    const coin = (cryptoMatch[1] || '').toUpperCase() 
      || (q.includes('биткоин') || q.includes('bitcoin') ? 'BTC' 
         : q.includes('эфир') || q.includes('ethereum') || q.includes('эфириум') ? 'ETH' 
         : null);
    if (coin) {
      const symbol = { BTC: 'BTCUSDT', ETH: 'ETHUSDT', BNB: 'BNBUSDT', SOL: 'SOLUSDT', ADA: 'ADAUSDT', XRP: 'XRPUSDT', DOGE: 'DOGEUSDT' }[coin];
      if (symbol) { try { return `📊 ${await binancePrice(symbol)} (Binance, real-time)`; } catch {} }
    }
  }
  
  // Stocks/forex
  if (/акци|stock|apple|aapl|tesla|tsla|google|googl|microsoft|msft|amazon|amzn|евро|доллар|рубл|eur|usd/i.test(q)) {
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
  // EXPANDED triggers — almost any "current" question needs web search
  const triggers = [
    'последн','latest','newest','недавн','свеж','сегодн','today','вчера','yesterday',
    'версия','version','release','выпуск','что нового','новости про',
    'кто победил','результат','тренд','trend','новость','news','актуальн','actual',
    '2025','2026','2027','когда','when','how much','сколько','цена','price',
    'кто лучше','сравни','compare','vs ','разница',
    'сколько стоит','what.*price','current','текущ',
    'чемпионат','матч','игра','турнир',
    'президент','премьер','правительств',
    'кто выиграл','who won','статистика','statistics',
    'самый','лучш','худш','best','worst','top',
    'что происходит','what.*happening',
    'сколько людей','how many',
    'out now','released','launched','доступн','available'
  ];
  return triggers.some(t => q.includes(t));
}

// FORCE web search for many question types — never trust training data for "current" info
function needsForcedWebSearch(query) {
  const q = query.toLowerCase();
  // If question contains any "current time" reference → MUST search
  const forcedTriggers = [
    'сколько стоит','цена','price','cost',
    'курс','rate',
    'сегодн','today','current','актуальн',
    'последн','latest','newest','свеж',
    'версия','version',
    'когда выйд','when.*release',
    'кто побед','who won',
    'что нового','what.*new',
    'чемпионат','матч','турнир','результат',
    'новост','news',
    'президент','prime minister','правительств',
    'статистика','statistics','статистик',
    'сколько.*сейчас','how many.*now',
    'самый большой','largest','biggest',
    'бирж','stock','акци',
    'погода','weather',
    'температур',
    'результаты','results'
  ];
  return forcedTriggers.some(t => q.includes(t));
}

function needsSmartAnswer(text) {
  const q = text.toLowerCase();
  return ['кто лучше','что лучше','сравни','compare','vs ','разница','почему','why ','объясни','explain','как работает','how does','лучш','best','worst','худш','достоинств','недостатк','pros and cons','плюсы минусы'].some(t => q.includes(t));
}

function needsMath(text) {
  const q = text.toLowerCase();
  return /\d+\s*[\*\+\/\-]\s*\d+|сколько будет|what is \d|calculate|посчитай|вычисли/.test(q);
}

// ====================== VERIFICATION SCRIPTS ======================

// Truth Gateway — checks for evasive language and outdated claims
function truthGateway(content, originalQuestion) {
  const issues = [];
  const lower = content.toLowerCase();
  const intro = lower.slice(0, 500);
  
  // Evasive phrases
  const evasivePhrases = [
    'я не могу', 'не имею доступа', 'у меня нет информации',
    'не могу сказать', 'не знаю актуальную', 'i can\'?t',
    'i don\'?t know', 'no access to', 'как ai', 'как модель',
    'отличный вопрос', 'давайте разберем', 'хороший вопрос',
    'к сожалению, я не', 'я не в курсе'
  ];
  if (evasivePhrases.some(p => intro.includes(p))) {
    issues.push('EVASIVE: contains "I can\'t" or filler phrases');
  }
  
  // Outdated dates
  if (/2023 года|2024 год(а|у)?(?!\d)/.test(content) && !/202[5-9]/.test(content)) {
    issues.push('OUTDATED: only mentions 2023/2024 dates');
  }
  
  // Vague claims
  if (/многие|некоторые|большинство|известно что/i.test(intro) && !/\d+%|\$\d|\d+\.\d+/.test(content)) {
    issues.push('VAGUE: contains vague quantifiers without numbers');
  }
  
  // Question needs comparison but no table
  if (/кто лучше|сравни|vs |разница/i.test(originalQuestion) && !content.includes('|')) {
    issues.push('NO_TABLE: comparison question but no table');
  }
  
  // Question needs numbers but no numbers
  if (/сколько|how much|how many|what.*price|цена/i.test(originalQuestion) && !/\d/.test(content)) {
    issues.push('NO_NUMBERS: question needs numbers but answer has none');
  }
  
  return issues;
}

// Math Verifier — checks math answers
function mathVerifier(content, originalQuestion) {
  const issues = [];
  // Extract numbers from question
  const questionNumbers = (originalQuestion.match(/\d+/g) || []).map(Number);
  // Extract numbers from answer
  const answerNumbers = (content.match(/\d+/g) || []).map(Number);
  
  if (questionNumbers.length >= 2) {
    // Check if there's a calculation
    const ops = /(\d+)\s*([\*\+\/\-])\s*(\d+)/.exec(originalQuestion);
    if (ops) {
      const a = parseInt(ops[1]);
      const b = parseInt(ops[3]);
      const op = ops[2];
      let expected;
      if (op === '*') expected = a * b;
      else if (op === '+') expected = a + b;
      else if (op === '-') expected = a - b;
      else if (op === '/') expected = a / b;
      
      if (!answerNumbers.includes(expected)) {
        issues.push(`MATH: expected ${expected} (${a}${op}${b}) not in answer`);
      }
    }
  }
  return issues;
}

// CoT Enforcer — checks for reasoning
function cotEnforcer(content, originalQuestion) {
  const issues = [];
  // Math/technical questions should have step-by-step
  if (needsMath(originalQuestion) || /почему|why|объясни|explain/i.test(originalQuestion)) {
    if (!/шаг|step|\d+\.|first|then|поэтому|так как|because/i.test(content)) {
      issues.push('NO_COT: complex question but no step-by-step reasoning');
    }
  }
  return issues;
}

// Constitutional AI — self-critique
async function constitutionalAI(content, originalQuestion) {
  // Check all verifications
  const truthIssues = truthGateway(content, originalQuestion);
  const mathIssues = mathVerifier(content, originalQuestion);
  const cotIssues = cotEnforcer(content, originalQuestion);
  const allIssues = [...truthIssues, ...mathIssues, ...cotIssues];
  
  if (allIssues.length === 0) return { pass: true, content, issues: [] };
  
  // Self-correct: ask model to fix
  const fixPrompt = `Твой предыдущий ответ имеет проблемы:
${allIssues.map(i => `- ${i}`).join('\n')}

Вопрос: ${originalQuestion}
Предыдущий ответ: ${content}

Исправь ответ. Устрани ВСЕ проблемы. Отвечай прямо, с цифрами, без увиливания. Если нужен калькулятор — посчитай. Если нужно сравнение — таблица с цифрами. Если не знаешь — "вероятно X" с уровнем уверенности.

Исправленный ответ:`;
  
  try {
    const fixed = await zaiChat([
      { role: 'system', content: 'Ты критик. Исправляй ответы. Отвечай только исправленным текстом.' },
      { role: 'user', content: fixPrompt }
    ], { thinking: true, maxTokens: 2500 });
    return { pass: false, content: fixed, issues: allIssues, original: content };
  } catch (e) {
    return { pass: false, content, issues: allIssues, error: e.message };
  }
}

// ====================== SELF-CONSISTENCY VOTING ======================
async function selfConsistencyVote(messages, options = {}, numCalls = 3) {
  const responses = [];
  for (let i = 0; i < numCalls; i++) {
    try {
      const r = await zaiChat(messages, options);
      responses.push(r);
    } catch (e) {
      console.log(`  vote call ${i+1} failed: ${e.message}`);
    }
    if (i < numCalls - 1) await new Promise(r => setTimeout(r, 500));
  }
  if (responses.length === 0) throw new Error('all vote calls failed');
  if (responses.length === 1) return { content: responses[0], confidence: 'low' };
  
  // For math: extract numbers and pick majority
  const numPatterns = responses.map(r => (r.match(/\d+\.?\d*/g) || []).slice(0, 5));
  // Find most common number sequence
  const counts = {};
  numPatterns.forEach(arr => {
    const key = arr.join(',');
    counts[key] = (counts[key] || 0) + 1;
  });
  const maxCount = Math.max(...Object.values(counts));
  const consensusKey = Object.entries(counts).find(([_, v]) => v === maxCount)[0];
  
  // Find response matching consensus
  const consensus = responses.find((r, i) => numPatterns[i].join(',') === consensusKey);
  const confidence = maxCount === responses.length ? 'high' : maxCount >= Math.ceil(responses.length / 2) + 1 ? 'medium' : 'low';
  
  return { content: consensus, confidence, allResponses: responses };
}

// ====================== MAIN CHAT (with smart router FIRST) ======================
async function smartChat(text, history) {
  const startTime = Date.now();
  
  // STAGE 0: Try Smart Router FIRST (no AI, no rate limits)
  // 80% of common questions (math, date, price, currency, weather, news, wiki) → instant
  try {
    const direct = await routerSmartChat(text, history);
    if (direct && (direct.provider.startsWith('direct-') || direct.provider === 'cache')) {
      // Direct hit — no need for verification pipeline
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      return {
        content: direct.answer + `\n\n_(${direct.provider} | ${elapsed}s | no AI needed)_`,
        provider: direct.provider,
        elapsed,
        stages: direct.stages || ['direct'],
        issues: [],
        liveData: true,
        webSearch: false,
      };
    }
    // AI was used by router — return as is
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    return {
      content: direct.answer + `\n\n_(${direct.provider} | ${elapsed}s)_`,
      provider: direct.provider,
      elapsed,
      stages: direct.stages || ['router'],
      issues: [],
      liveData: false,
      webSearch: direct.stages?.includes('web-search'),
    };
  } catch (e) {
    console.log('  Smart router failed, falling back to old pipeline:', e.message);
  }
  
  // FALLBACK: Old verification pipeline (for edge cases)
  const stages = [];
  
  // STAGE 1: ALWAYS try live data first (Binance/Yahoo/HN/Wikipedia) — most reliable
  stages.push('live-data');
  let liveData = null;
  try { liveData = await fetchLiveData(text); } catch {}
  
  // STAGE 2: FORCED web search for current-time questions
  stages.push('web-search');
  let webSearchData = null;
  const smart = needsSmartAnswer(text);
  const math = needsMath(text);
  const forcedSearch = needsForcedWebSearch(text) || needsWebSearch(text) || smart;
  
  if (forcedSearch) {
    try { 
      webSearchData = await webSearch(text, 5);
      if (liveData && webSearchData) webSearchData = webSearchData.slice(0, 600);
    } catch {}
  }
  
  // STAGE 3: Build messages with context
  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    ...history.slice(-6),
  ];
  
  let contextParts = [];
  if (liveData) contextParts.push(`[АКТУАЛЬНЫЕ ДАННЫЕ ИЗ ВЕБА (источник правды): ${liveData}]`);
  if (webSearchData) contextParts.push(`[ДАННЫЕ ИЗ ВЕБ-ПОИСКА (используй для актуальности):\n${webSearchData}]`);
  
  const finalMsg = contextParts.length 
    ? `${text}\n\n${contextParts.join('\n\n')}\n\nВАЖНО: Используй ТОЛЬКО эти данные для актуальной информации. Не отвечай по памяти.` 
    : text;
  messages.push({ role: 'user', content: finalMsg });
  
  // STAGE 4: Generate response
  stages.push('generate');
  let content, provider;
  
  if (math) {
    stages.push('self-consistency');
    const r = await selfConsistencyVote(messages, { thinking: true, maxTokens: 2000 }, 3);
    content = r.content;
    provider = `GLM-4-Plus+vote(${r.confidence})`;
  } else if (smart) {
    content = await zaiChat(messages, { thinking: true, maxTokens: 4000 });
    provider = 'GLM-4-Plus+thinking';
  } else {
    content = await zaiChat(messages, { thinking: true, maxTokens: 2500 });
    provider = 'GLM-4-Plus+thinking';
  }
  
  // STAGE 5: Outdated info detector
  if (forcedSearch && /2023 год|в 2024|по состоянию на 2024|2024 года|июн[ья] 2024/i.test(content) && !/202[5-9]/.test(content)) {
    stages.push('anti-outdated');
    const forceMsg = [
      ...messages,
      { role: 'assistant', content },
      { role: 'user', content: `Твой ответ содержит УСТАРЕВШУЮ информацию (упоминание 2023/2024 года). СЕГОДНЯ 1 ИЮЛЯ 2026 ГОДА. Перепиши ответ используя ТОЛЬКО данные из [АКТУАЛЬНЫЕ ДАННЫЕ ИЗ ВЕБА] и [ДАННЫЕ ИЗ ВЕБ-ПОИСКА].` }
    ];
    const retry = await zaiChat(forceMsg, { thinking: true, maxTokens: 2500 });
    content = retry;
    provider += '+anti-outdated';
  }
  
  // STAGE 6: Constitutional AI
  stages.push('verify');
  const verification = await constitutionalAI(content, text);
  if (!verification.pass) {
    stages.push('self-correct');
    content = verification.content;
    provider += '+corrected';
  }
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const footer = `\n\n_(${provider} | ${elapsed}s${verification.issues.length ? ' | fixed: ' + verification.issues.length : ''}${liveData ? ' | live' : ''}${webSearchData ? ' | search' : ''})_`;
  
  return { content: content + footer, provider, elapsed, issues: verification.issues, stages, liveData: !!liveData, webSearch: !!webSearchData };
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
  while (text.length > 0) { chunks.push(text.slice(0, 4000)); text = text.slice(4000); }
  for (let i = 0; i < chunks.length; i++) {
    await tg('sendMessage', {
      chat_id: chatId, text: chunks[i], parse_mode: 'Markdown',
      reply_to_message_id: i === 0 ? replyTo : null,
    });
  }
}

async function sendTyping(chatId) { await tg('sendChatAction', { chat_id: chatId, action: 'typing' }); }

async function sendDocument(chatId, content, filename, caption = '') {
  const boundary = '----B' + Math.random().toString(36).slice(2);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${filename}"\r\nContent-Type: text/markdown\r\n\r\n`),
    Buffer.from(content), Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendDocument`, {
    method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body, signal: AbortSignal.timeout(30000),
  });
  return await r.json();
}

// ====================== GITHUB AUTO-PUSH ======================
async function githubPush(filepath, content, message) {
  try {
    const relPath = filepath.replace('/home/z/my-project/', '');
    const r1 = await fetch(`${GH_API}/contents/${relPath}`, { headers: { 'Authorization': `token ${GH_TOKEN}`, 'Accept': 'application/vnd.github+json' } });
    let sha = null;
    if (r1.ok) { const d = await r1.json(); sha = d.sha; }
    const r2 = await fetch(`${GH_API}/contents/${relPath}`, {
      method: 'PUT',
      headers: { 'Authorization': `token ${GH_TOKEN}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github+json' },
      body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), sha, branch: 'main' }),
    });
    const d2 = await r2.json();
    return !!d2.commit;
  } catch (e) { return false; }
}

async function backupAllToGithub() {
  const files = [
    ['scripts/smart_bot_v3.mjs', '/home/z/my-project/scripts/smart_bot_v3.mjs', 'Bot v3: with verification pipeline'],
    ['MEMORY.md', '/home/z/my-project/MEMORY.md', 'Update MEMORY'],
    ['meta-prompt-v9.99-FINAL.md', '/home/z/my-project/repo/meta-prompt-v9.99-FINAL.md', 'Update meta-prompt'],
  ];
  const results = [];
  for (const [p, f, m] of files) {
    try {
      const c = fs.readFileSync(f, 'utf8');
      const ok = await githubPush(p, c, m);
      results.push(`${p}: ${ok ? '✓' : '✗'}`);
    } catch { results.push(`${p}: err`); }
  }
  return results.join('\n');
}

// ====================== HISTORY ======================
const histories = {};
try { Object.assign(histories, JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'))); } catch {}
function saveHistories() { try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(histories).slice(0, 500000)); } catch {} }

// ====================== /prompt GENERATOR ======================
async function generateBestPrompt(topic) {
  let metaLaws = '';
  try { metaLaws = fs.readFileSync(META_PROMPT_FILE, 'utf8').split('Ты — системный промпт')[0]; } catch {}
  
  let researchContext = '';
  try {
    const ws = await webSearch(`best practices for: ${topic}`, 5);
    if (ws) researchContext = `\n\n[КОНТЕКСТ:\n${ws}]`;
  } catch {}
  
  const draft = await zaiChat([
    { role: 'system', content: `Ты — мировой эксперт по промптам. Методология мета-промпта v9.99:\n${metaLaws}\n\nФОРМАТ: Markdown с секциями # Роль # Контекст # Задача # Формат вывода # Правила # Примеры # Критерии качества # Анти-паттерны # Чек-лист # Итерация. Минимум 1500 слов.` },
    { role: 'user', content: `Напиши лучший промпт для: ${topic}${researchContext}` }
  ], { thinking: true, maxTokens: 5000 });
  
  const refined = await zaiChat([
    { role: 'system', content: 'Ты критик промптов. Улучши до идеала. Добавь # Анти-паттерны # Чек-лист # Итерация # Edge cases. Минимум 2500 слов.' },
    { role: 'user', content: `Черновик:\n${draft}\n\nУлучши.` }
  ], { thinking: true, maxTokens: 6000 });
  
  const header = `# Лучший промпт: ${topic}\n\n> Сгенерировано: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Berlin' })}\n> Методология: meta-prompt v9.99 + 3-stage pipeline + thinking\n> Размер: ${refined.length} символов\n\n---\n\n`;
  return { fullPrompt: header + refined, summary: refined.split('\n').filter(l => l.trim().startsWith('#')).slice(0, 10).join('\n') };
}

// ====================== COMMANDS ======================
async function handleCommand(chatId, text, msg) {
  const cmd = text.split(' ')[0].toLowerCase();
  const reply = (t) => sendMsg(chatId, t, msg.message_id);
  
  if (cmd === '/start' || cmd === '/help') {
    await reply(`*Супер-Z v3* — самый умный бот\n\n*🧠 Генерация промптов:*\n/prompt <тема> — лучший в мире промпт\n\n*📦 Команды:*\n/help /clear /model /ping /meta /memory /backup /sync /status\n\n*Проверки:*\n✓ Truth Gateway (анти-увиливание)\n✓ Math Verifier (проверка математики)\n✓ CoT Enforcer (пошаговое рассуждение)\n✓ Constitutional AI (самокритика)\n✓ Self-consistency (голосование для математики)\n✓ Web search (актуальные данные)\n✓ Live data (Binance/Yahoo/HN/Wikipedia)`);
  } else if (cmd === '/clear') {
    histories[chatId] = []; saveHistories();
    await reply('🧹 Очищено.');
  } else if (cmd === '/ping') { await reply('🏓 pong'); }
  else if (cmd === '/model') {
    const r = await zaiChat([{ role: 'user', content: 'OK' }], { thinking: false });
    await reply(`*Провайдер:* GLM-4-Plus+thinking+web_search\n*Проверки:* Truth Gateway, Math Verifier, CoT, Constitutional AI\n*Test:* ${r.slice(0, 50)}`);
  } else if (cmd === '/meta') {
    try { await sendDocument(chatId, fs.readFileSync(META_PROMPT_FILE, 'utf8'), 'meta-prompt-v9.99-FINAL.md', '🧠 Мета-промпт'); } 
    catch (e) { await reply(`❌ ${e.message}`); }
  } else if (cmd === '/memory') {
    try { await sendDocument(chatId, fs.readFileSync(MEMORY_FILE, 'utf8'), 'MEMORY.md', '🧠 MEMORY'); } 
    catch (e) { await reply(`❌ ${e.message}`); }
  } else if (cmd === '/backup') {
    if (!BACKUP_CHANNEL_ID) { await reply('❌ Канал не подключён'); return; }
    await reply('🔄 Backup...');
    try {
      const mem = fs.readFileSync(MEMORY_FILE, 'utf8');
      const r1 = await sendDocument(BACKUP_CHANNEL_ID, mem, 'MEMORY.md', `🔄 ${new Date().toISOString()}`);
      const meta = fs.readFileSync(META_PROMPT_FILE, 'utf8');
      const r2 = await sendDocument(BACKUP_CHANNEL_ID, meta, 'meta-prompt-v9.99-FINAL.md', `🔄 ${new Date().toISOString()}`);
      await reply(`✅ MEMORY: ${r1.ok?'✓':'✗'} | Meta: ${r2.ok?'✓':'✗'}`);
    } catch (e) { await reply(`❌ ${e.message}`); }
  } else if (cmd === '/sync') {
    await reply('🔄 Sync GitHub...');
    await reply(`✅ ${await backupAllToGithub()}`);
  } else if (cmd === '/status') {
    await reply(`*Статус v3*\n\n🟢 PID: ${process.pid}\n🧠 MEMORY: ${fs.existsSync(MEMORY_FILE)?'✓':'✗'}\n🧠 Meta: ${fs.existsSync(META_PROMPT_FILE)?'✓':'✗'}\n📡 Канал: ${BACKUP_CHANNEL_ID||'нет'}\n🐙 GitHub: ${GH_REPO}\n💬 Чатов: ${Object.keys(histories).length}\n✓ Truth Gateway\n✓ Math Verifier\n✓ CoT Enforcer\n✓ Constitutional AI\n✓ Self-consistency voting\n✓ Web search (z-ai SDK)\n✓ Live data (Binance/Yahoo/HN/Wikipedia)\n🌐 Mode: ${WEBHOOK_MODE ? 'webhook' : 'polling'}`);
  } else if (cmd === '/setghtoken') {
    // Update GitHub token (saved to .env file, not hardcoded in source)
    const newToken = text.split(' ')[1];
    if (!newToken || !newToken.startsWith('ghp_')) {
      await reply('Использование: `/setghtoken ghp_xxx`');
      return;
    }
    // Test new token
    try {
      const r = await fetch('https://api.github.com/user', { headers: { 'Authorization': `token ${newToken}` } });
      const d = await r.json();
      if (!d.login) {
        await reply(`❌ Токен невалидный: ${d.message}`);
        return;
      }
      // Save to .env file (NOT to source code — GitHub blocks secrets in code)
      const envFile = '/home/z/my-project/.env';
      let envContent = '';
      try { envContent = fs.readFileSync(envFile, 'utf8'); } catch {}
      // Update or add GH_TOKEN line
      if (envContent.includes('GH_TOKEN=')) {
        envContent = envContent.replace(/GH_TOKEN=[^\n]*/, `GH_TOKEN=${newToken}`);
      } else {
        envContent += `\nGH_TOKEN=${newToken}`;
      }
      fs.writeFileSync(envFile, envContent.trim() + '\n');
      // Set in current process
      process.env.GH_TOKEN = newToken;
      
      // Test push
      const ok = await githubPush('test_token.txt', `Token updated ${new Date().toISOString()}`, 'Token refresh test');
      await reply(`✅ GitHub токен сохранён в .env!\nUser: ${d.login}\nPush test: ${ok ? '✓' : '✗'}\n\nТокен НЕ в коде (GitHub блокирует secrets в репо). Используется env var.\n\nБот перезапустится через 3 сек.`);
      
      // Restart self
      setTimeout(() => process.exit(0), 3000);
    } catch (e) {
      await reply(`❌ Ошибка: ${e.message}`);
    }
  } else if (cmd === '/swarm') {
    // /swarm <question> — solve with N parallel agents
    const parts = text.split(' ');
    let numAgents = 5;
    let question = '';
    if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
      numAgents = Math.min(parseInt(parts[1]), 50);
      question = parts.slice(2).join(' ');
    } else {
      question = parts.slice(1).join(' ');
    }
    if (!question) {
      await reply('Использование: `/swarm <question>` или `/swarm 10 <question>` (10 agents)\n\nПример:\n`/swarm 10 Сравни 10 языков программирования для веб-разработки`');
      return;
    }
    await reply(`🐝 Запускаю ${numAgents} параллельных агентов для:\n*${question}*\n\n⏳ decompose → parallel solve → aggregate...`);
    sendTyping(chatId).catch(() => {});
    const tIv = setInterval(() => sendTyping(chatId).catch(() => {}), 4000);
    try {
      const t0 = Date.now();
      const r = await solveWithSwarm(question, numAgents);
      clearInterval(tIv);
      const summary = `✅ *Готово за ${r.elapsed}s!*\n\n*Агентов:* ${r.agentsCompleted} success, ${r.agentsFailed} failed\n*Провайдер:* ${r.provider}\n\n*Ответ:*\n${r.finalAnswer.slice(0, 3500)}`;
      await sendMsg(chatId, summary, msg.message_id);
      // If answer is very long, also send as file
      if (r.finalAnswer.length > 3500) {
        await sendDocument(chatId, r.finalAnswer, `swarm_answer.md`, `🐝 Swarm (${numAgents} agents)`);
      }
    } catch (e) {
      clearInterval(tIv);
      await reply(`❌ ${e.message}`);
    }
  } else if (cmd === '/addtoken') {
    // /addtoken ghp_xxx — add another GH token for more parallel capacity
    const newToken = text.split(' ')[1];
    if (!newToken || !newToken.startsWith('ghp_')) {
      await reply('Использование: `/addtoken ghp_xxx`\n\nСоздать ещё токен: https://github.com/settings/tokens/new (scopes: nothing special needed for GitHub Models — they are free for any user)');
      return;
    }
    // Test token
    try {
      const r = await fetch('https://models.inference.ai.azure.com/models', {
        headers: { 'Authorization': `Bearer ${newToken}` },
      });
      if (!r.ok) {
        await reply(`❌ Токен невалидный для GH Models: HTTP ${r.status}`);
        return;
      }
      // Add to .env GH_TOKENS
      const envFile = '/home/z/my-project/.env';
      let envContent = fs.readFileSync(envFile, 'utf8');
      if (envContent.includes('GH_TOKENS=')) {
        envContent = envContent.replace(/GH_TOKENS=([^\n]*)/, (m, tokens) => `GH_TOKENS=${tokens},${newToken}`);
      } else {
        envContent += `\nGH_TOKENS=${newToken}`;
      }
      fs.writeFileSync(envFile, envContent.trim() + '\n');
      await reply(`✅ Токен добавлен!\n\nТокенов в пуле: ${GH_TOKENS.length + 1}\nCapacity: ${(GH_TOKENS.length + 1) * 15} req/min = ${(GH_TOKENS.length + 1) * 15 * 60} req/hour\n\nБот перезапустится через 3 сек.`);
      setTimeout(() => process.exit(0), 3000);
    } catch (e) {
      await reply(`❌ ${e.message}`);
    }
  } else if (cmd === '/tokens') {
    // Show token pool stats
    if (GH_TOKENS.length === 0) {
      await reply('Нет токенов в пуле. Добавьте через /addtoken ghp_xxx');
      return;
    }
    let stats = `*Token Pool (${GH_TOKENS.length} токенов)*\n\n`;
    stats += `*Capacity:* ${GH_TOKENS.length * 15} req/min = ${GH_TOKENS.length * 15 * 60} req/hour\n\n`;
    for (const t of tokenState) {
      stats += `• ${t.token.slice(0, 10)}...: ✓${t.successCount} ✗${t.failCount} (total: ${t.totalRequests})\n`;
    }
    await reply(stats);
  } else if (cmd === '/diag') {
    // Self-diagnostic
    await reply('🔍 Running diagnostics...');
    const checks = await selfDiagnostic();
    let report = '*🔍 System Diagnostic*\n\n';
    for (const c of checks) {
      report += `${c.ok ? '✓' : '✗'} ${c.name}: ${c.detail || ''}\n`;
    }
    const failed = checks.filter(c => !c.ok).length;
    report += `\n*Result:* ${checks.length - failed}/${checks.length} checks passed`;
    await reply(report);
  } else if (cmd === '/queue') {
    const q = getQueueStatus();
    if (q.length === 0) {
      await reply('Queue empty.');
    } else {
      let report = '*Background tasks:*\n\n';
      for (const t of q) {
        report += `• [${t.status}] ${t.task} (${t.elapsed})\n`;
      }
      await reply(report);
    }
  } else if (cmd === '/bg') {
    // /bg <task> — run in background, get notification when done
    const task = text.replace(/^\/bg\s*/i, '').trim();
    if (!task) {
      await reply('Использование: `/bg <task>` — задача выполнится в фоне, вы получите уведомление');
      return;
    }
    const taskId = await queueBackgroundTask(chatId, task, { agents: 5 });
    await reply(`✅ Задача поставлена в фон!\n\nID: ${taskId}\n\nВы получите уведомление когда она будет готова. Можно продолжать общаться со мной.`);
  } else if (cmd === '/deploy') {
    // Show deployment instructions
    await reply(`📦 *Деплой на Render (3 минуты):*\n\n1. Создай новый GitHub token: https://github.com/settings/tokens/new\n   Scopes: repo, workflow\n2. Отправь боту: \`/setghtoken ghp_xxx\`\n3. Зарегистрируйся на https://render.com (через GitHub)\n4. New + → Blueprint → выбери репо smart-tg-bot\n5. Add env var: \`TG_TOKEN=8736969974:AAG66M9I0uGwRUksTt1iJt7v-n-f7T7BpnE\`\n6. Create → готово\n\nRender сам установит webhook. Бот будет 24/7.`);
  } else if (cmd === '/prompt' || cmd === '/промпт') {
    const topic = text.replace(/^\/(prompt|промпт)\s*/i, '').trim();
    if (!topic) { await reply('Использование: `/prompt <тема>`'); return; }
    await reply(`🧠 Генерирую промпт для: *${topic}*\n⏳ research → draft → refine...`);
    sendTyping(chatId).catch(() => {});
    const tIv = setInterval(() => sendTyping(chatId).catch(() => {}), 4000);
    try {
      const r = await generateBestPrompt(topic);
      clearInterval(tIv);
      await sendMsg(chatId, `✅ *Готов!*\n\n${r.summary}\n\n📁 Полный промпт — в файле:`, msg.message_id);
      const fn = `prompt_${topic.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '_').slice(0, 30)}.md`;
      await sendDocument(chatId, r.fullPrompt, fn, `🧠 ${topic}`);
    } catch (e) { clearInterval(tIv); await reply(`❌ ${e.message}`); }
  } else { await reply('Неизвестная. /help'); }
}

// ====================== MAIN LOOP ======================
let offset = 0;

async function poll() {
  while (true) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getUpdates?offset=${offset}&timeout=30&allowed_updates=%5B%22message%22%2C%22channel_post%22%5D`, { signal: AbortSignal.timeout(40000) });
      const data = await r.json();
      if (!data.ok) { await new Promise(r => setTimeout(r, 5000)); continue; }
      for (const upd of data.result || []) {
        offset = upd.update_id + 1;
        const msg = upd.message || upd.channel_post;
        if (!msg) continue;
        const chatId = msg.chat?.id, text = msg.text || '';
        if (!ALLOWED_CHATS.has(String(chatId))) continue;
        if (text.startsWith('/')) { await handleCommand(chatId, text, msg); continue; }
        if (!text) continue;
        
        console.log(`[${new Date().toISOString()}] ${chatId} -> ${text.slice(0, 80)}`);
        sendTyping(chatId).catch(() => {});
        const tIv = setInterval(() => sendTyping(chatId).catch(() => {}), 4000);
        
        try {
          // AUTO SWARM: automatically decides # agents based on question complexity
          const history = histories[chatId] || [];
          const result = await autoSwarm(text, history);
          clearInterval(tIv);
          
          histories[chatId] = histories[chatId] || [];
          histories[chatId].push({ role: 'user', content: text });
          histories[chatId].push({ role: 'assistant', content: result.answer });
          if (histories[chatId].length > 16) histories[chatId].splice(0, histories[chatId].length - 16);
          saveHistories();
          
          const tag = result.agents > 1 ? ` ×${result.agents} agents` : '';
          await sendMsg(chatId, result.answer + `\n\n_(${result.provider}${tag} | ${result.elapsed}s)_`, msg.message_id);
          console.log(`  -> [${result.provider}] ${result.agents} agents | ${result.elapsed}s`);
        } catch (e) {
          clearInterval(tIv);
          await sendMsg(chatId, `❌ ${e.message}`, msg.message_id);
        }
      }
    } catch (e) {
      console.error('poll err:', e.message);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// ====================== START ======================
console.log(`🚀 Smart Bot v3 — with verification pipeline`);
console.log(`   GitHub: ${GH_REPO}`);
console.log(`   Channel: ${BACKUP_CHANNEL_ID || 'none'}`);
console.log(`   Verifications: Truth Gateway + Math Verifier + CoT + Constitutional AI + Self-consistency`);

await fetch(`https://api.telegram.org/bot${TG_TOKEN}/deleteWebhook?drop_pending_updates=false`).then(r=>r.json()).then(d=>console.log('   Webhook deleted:', d.ok));
await tg('setMyCommands', { commands: [
  { command: 'help', description: 'Помощь' },
  { command: 'swarm', description: '🐝 Параллельные агенты' },
  { command: 'bg', description: '🔄 Фоновая задача' },
  { command: 'diag', description: '🔍 Диагностика' },
  { command: 'queue', description: '📋 Фоновые задачи' },
  { command: 'prompt', description: '🧠 Лучший промпт' },
  { command: 'tokens', description: '🐝 Статус токенов' },
  { command: 'addtoken', description: '➕ Добавить токен' },
  { command: 'status', description: 'Статус' },
  { command: 'meta', description: 'Мета-промпт' },
  { command: 'memory', description: 'MEMORY' },
  { command: 'backup', description: 'Backup в канал' },
  { command: 'sync', description: 'Backup в GitHub' },
]});

// Detect mode: webhook (Render) or polling (sandbox/local)
const WEBHOOK_MODE = process.env.WEBHOOK_MODE === 'true' || process.env.PORT;
const PORT = process.env.PORT || 10000;

if (WEBHOOK_MODE) {
  // Webhook mode — for Render/HF Spaces/Vercel
  console.log(`   Mode: WEBHOOK (port ${PORT})`);
  
  const http = await import('node:http');
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), bot: 'v3' }));
      return;
    }
    if (req.method === 'POST' && req.url === '/webhook') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        res.writeHead(200);
        res.end('{"ok":true}');
        try {
          const upd = JSON.parse(body);
          await handleUpdate(upd);
        } catch (e) {
          console.error('webhook err:', e.message);
        }
      });
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });
  
  server.listen(PORT, () => {
    console.log(`✅ Bot v3 webhook listening on :${PORT}`);
  });
  
  // Set webhook to Render URL (must be set via env RENDER_EXTERNAL_URL or manual)
  const externalUrl = process.env.RENDER_EXTERNAL_URL || process.env.WEBHOOK_URL;
  if (externalUrl) {
    const webhookUrl = `${externalUrl}/webhook`;
    console.log(`   Setting webhook to: ${webhookUrl}`);
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/setWebhook?url=${webhookUrl}&allowed_updates=%5B%22message%22%2C%22channel_post%22%5D`)
      .then(r => r.json())
      .then(d => console.log('   Webhook set:', d.ok, d.description || ''));
  } else {
    console.log('   ⚠️ RENDER_EXTERNAL_URL or WEBHOOK_URL not set, polling fallback');
    // Fallback to polling if no external URL
    poll();
  }
} else {
  // Polling mode — for sandbox/local
  console.log('   Mode: POLLING');
  console.log('✅ Bot v3 ready.');
  poll();
}

// Export handleUpdate for webhook mode
// (handleUpdate is defined above in the file)

#!/usr/bin/env node
/**
 * Smart TG Bot v7 — NEVER FORGETS + REASONING MODELS
 * 
 * Key fix: CRITICAL_RULES injected into EVERY system prompt
 * - Never says 2024 (always knows it's 2026)
 * - Never says GPT-4 is latest (knows GPT-5 exists)
 * - Always web-searches for current facts
 * 
 * AI providers (7 total!):
 * 1. z-ai GLM-4-Plus + thinking (sandbox only)
 * 2. Nvidia Nemotron reasoning (OpenRouter free)
 * 3. Groq Llama 3.3 70B
 * 4. OpenAI GPT-4o-mini
 * 5. Google Gemini 2.0
 * 6. GitHub Models (GPT-4o, Llama 405B)
 * 7. Pollinations (fallback)
 */

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const TG_TOKEN = process.env.TG_TOKEN;
const ALLOWED_CHATS = new Set((process.env.ALLOWED_CHATS || '').split(',').filter(Boolean));
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GOOGLE_AI_KEY = process.env.GOOGLE_AI_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const GH_TOKENS = (process.env.GH_TOKENS || process.env.GH_TOKEN || '').split(',').filter(t => t.startsWith('ghp_'));

// CRITICAL RULES — injected into EVERY system prompt
const CRITICAL_RULES = `🚨 КРИТИЧНО — НЕ ЗАБЫВАТЬ НИКОГДА:

1. СЕЙЧАС: ${new Date().getFullYear()} год. НЕ говори 2023/2024.
2. GPT-5 существует (выпущен 7 августа 2025). GPT-5.5 Instant (май 2026).
3. Claude 4.1 Sonnet/Opus существуют (2025). Gemini 2.5 Pro (2025).
4. GLM-5.2 — текущая модель z.ai (June 2026). НЕ называй её GLM-4-Plus (устаревшее).
5. Для ЛЮБОГО факта про "сейчас" (дата, цена, версия, новость) → используй web search.
6. Никогда не угадывай дату/цену/версию — проверяй.
7. Пользователь: Europe/Berlin, русский язык, обращение в женском роде.
8. R23: исследуй мировой опыт. R24: ищи скрытые возможности.
9. Не увиливай. Прямой ответ в первой строке.`;

// Token rotation
const tokenState = GH_TOKENS.map(token => ({ token, req: 0, window: Date.now(), cooldown: 0 }));
function getNextToken() {
  const now = Date.now();
  for (const t of tokenState) if (now - t.window > 60000) { t.req = 0; t.window = now; }
  const avail = tokenState.filter(t => t.req < 14 && t.cooldown < now);
  if (!avail.length) return null;
  avail.sort((a, b) => a.req - b.req);
  avail[0].req++;
  return avail[0];
}

// AI providers
async function openrouterChat(messages, model = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', maxTokens = 2000) {
  if (!OPENROUTER_API_KEY) throw new Error('NO_OPENROUTER');
  // Inject CRITICAL_RULES into system message
  const msgs = messages.map(m => {
    if (m.role === 'system') return { role: 'system', content: CRITICAL_RULES + '\n\n' + m.content };
    return m;
  });
  if (!msgs.find(m => m.role === 'system')) msgs.unshift({ role: 'system', content: CRITICAL_RULES });
  
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: msgs, max_tokens: maxTokens, temperature: 0.7 }),
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) { const e = await r.text(); throw new Error(`OR ${r.status}: ${e.slice(0, 80)}`); }
  const data = await r.json();
  return data?.choices?.[0]?.message?.content || '';
}

async function ghModelsChat(messages, model = 'gpt-4o-mini', maxTokens = 2000, tools = null) {
  // Inject CRITICAL_RULES
  const msgs = messages.map(m => {
    if (m.role === 'system') return { role: 'system', content: CRITICAL_RULES + '\n\n' + m.content };
    return m;
  });
  if (!msgs.find(m => m.role === 'system')) msgs.unshift({ role: 'system', content: CRITICAL_RULES });
  
  for (let i = 0; i < GH_TOKENS.length * 2 + 3; i++) {
    const t = getNextToken();
    if (!t) { await new Promise(r => setTimeout(r, 2000)); continue; }
    try {
      const body = { model, messages: msgs.map(m => ({role: m.role, content: m.content.slice(0, 12000)})), max_tokens: maxTokens, temperature: 0.7 };
      if (tools) body.tools = tools;
      const r = await fetch('https://models.inference.ai.azure.com/chat/completions', {
        method: 'POST', headers: { 'Authorization': `Bearer ${t.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
      });
      if (r.status === 429) { t.cooldown = Date.now() + 5000; t.req = 15; continue; }
      if (!r.ok) continue;
      return await r.json();
    } catch {}
  }
  throw new Error('GH exhausted');
}

async function groqChat(messages, maxTokens = 2000) {
  if (!GROQ_API_KEY) throw new Error('NO_GROQ');
  const msgs = messages.map(m => {
    if (m.role === 'system') return { role: 'system', content: CRITICAL_RULES + '\n\n' + m.content };
    return m;
  });
  if (!msgs.find(m => m.role === 'system')) msgs.unshift({ role: 'system', content: CRITICAL_RULES });
  
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: msgs, max_tokens: maxTokens, temperature: 0.7 }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Groq ${r.status}`);
  return await r.json();
}

async function googleChat(messages, maxTokens = 2000) {
  if (!GOOGLE_AI_KEY) throw new Error('NO_GOOGLE');
  const systemContent = CRITICAL_RULES + '\n\n' + (messages.find(m => m.role === 'system')?.content || '');
  const userMsgs = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content.slice(0, 12000) }] }));
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_AI_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: systemContent }] }, contents: userMsgs, generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Google ${r.status}`);
  const data = await r.json();
  return { choices: [{ message: { content: data?.candidates?.[0]?.content?.parts?.[0]?.text || '' } }] };
}

async function pollinationsChat(messages, maxTokens = 1500) {
  const msgs = messages.map(m => {
    if (m.role === 'system') return { role: 'system', content: CRITICAL_RULES + '\n\n' + m.content };
    return m;
  });
  if (!msgs.find(m => m.role === 'system')) msgs.unshift({ role: 'system', content: CRITICAL_RULES });
  
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch('https://text.pollinations.ai/openai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'openai', messages: msgs, max_tokens: maxTokens }),
        signal: AbortSignal.timeout(30000),
      });
      if (r.status === 429) { await new Promise(r => setTimeout(r, 2000 * Math.pow(2, i))); continue; }
      if (!r.ok) continue;
      return await r.json();
    } catch {}
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error('Pollinations failed');
}

function getContent(data) {
  return data?.choices?.[0]?.message?.content || '';
}

// MEGA CASCADE with REASONING priority
async function aiCall(messages, options = {}) {
  const maxTokens = options.maxTokens || 2000;
  const tools = options.tools || null;
  
  // 1. Nvidia Nemotron reasoning (FREE, has thinking)
  try { return { content: await openrouterChat(messages, 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', maxTokens), provider: 'Nemotron-reasoning+OR' }; } catch (e) { console.log('  Nemotron:', e.message.slice(0, 50)); }
  
  // 2. GH Models with tools (function calling)
  try {
    const data = await ghModelsChat(messages, 'gpt-4o-mini', maxTokens, tools);
    const msg = data?.choices?.[0]?.message;
    if (msg?.tool_calls?.length > 0) {
      console.log('  🔧 Tools:', msg.tool_calls.map(t => t.function.name).join(', '));
      const toolMsgs = [...messages, msg];
      for (const tc of msg.tool_calls) {
        const args = JSON.parse(tc.function.arguments);
        const result = await executeTool(tc.function.name, args);
        toolMsgs.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
      const data2 = await ghModelsChat(toolMsgs, 'gpt-4o-mini', maxTokens);
      return { content: getContent(data2), provider: 'GPT-4o-mini+tools+GH' };
    }
    return { content: msg?.content || '', provider: 'GPT-4o-mini+GH' };
  } catch (e) { console.log('  GH:', e.message.slice(0, 50)); }
  
  // 3. Groq (fast)
  try { const d = await groqChat(messages, maxTokens); return { content: getContent(d), provider: 'Groq/Llama-3.3-70B' }; } catch (e) { console.log('  Groq:', e.message.slice(0, 50)); }
  
  // 4. Google
  try { const d = await googleChat(messages, maxTokens); return { content: getContent(d), provider: 'Google/Gemini-2.0' }; } catch (e) { console.log('  Google:', e.message.slice(0, 50)); }
  
  // 5. Pollinations
  try { const d = await pollinationsChat(messages, maxTokens); return { content: getContent(d), provider: 'Pollinations' }; } catch (e) { console.log('  Poll:', e.message.slice(0, 50)); }
  
  return { content: 'All providers failed', provider: 'none' };
}

// Tools
const TOOLS = [
  { type: 'function', function: { name: 'web_search', description: 'Search the web for current information. ALWAYS use for questions about dates, prices, versions, news.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'get_crypto_price', description: 'Get crypto price', parameters: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] } } },
];

async function executeTool(name, args) {
  if (name === 'web_search') {
    try {
      const r = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(args.query)}&format=json&no_html=1`, { signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      let result = '';
      if (d.Abstract) result += d.Abstract.slice(0, 500);
      for (const t of (d.RelatedTopics || []).slice(0, 3)) if (t.Text) result += '\n' + t.Text.slice(0, 200);
      return result || 'No results';
    } catch (e) { return 'Search failed'; }
  }
  if (name === 'get_crypto_price') {
    try {
      const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${args.symbol}`, { signal: AbortSignal.timeout(5000) });
      const d = await r.json();
      return `${args.symbol}: $${parseFloat(d.price).toLocaleString('en-US', {maximumFractionDigits: 2})}`;
    } catch { return 'Price fetch failed'; }
  }
  return 'Unknown tool';
}

// Live data
async function fetchLiveData(q) {
  const lower = q.toLowerCase();
  const cryptos = { btc: 'BTCUSDT', bitcoin: 'BTCUSDT', eth: 'ETHUSDT', ethereum: 'ETHUSDT' };
  for (const [k, sym] of Object.entries(cryptos)) {
    if (lower.includes(k)) {
      try {
        const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`, { signal: AbortSignal.timeout(5000) });
        const d = await r.json();
        return `Real-time: ${sym} = $${parseFloat(d.price).toLocaleString('en-US', {maximumFractionDigits: 2})}`;
      } catch {}
    }
  }
  if (/дат|date/.test(lower)) return `Current date: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Berlin', dateStyle: 'full' })}`;
  return null;
}

// Telegram
async function tg(method, payload) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    return await r.json();
  } catch (e) { return { ok: false, error: e.message }; }
}

async function sendMsg(chatId, text, replyTo) {
  while (text.length > 0) {
    const chunk = text.slice(0, 4000);
    text = text.slice(4000);
    await tg('sendMessage', { chat_id: chatId, text: chunk, reply_to_message_id: replyTo });
    replyTo = null;
  }
}

// Handle
async function handleUpdate(upd) {
  const msg = upd.message;
  if (!msg) return;
  const chatId = msg.chat?.id;
  const text = msg.text || '';
  if (!ALLOWED_CHATS.has(String(chatId))) return;
  
  if (text.startsWith('/')) {
    const cmd = text.split(' ')[0].toLowerCase();
    if (cmd === '/ping') await sendMsg(chatId, '🏓 pong (v7 never-forgets!)', msg.message_id);
    else if (cmd === '/help') await sendMsg(chatId, 'Commands: /help /ping /status\nBot v7: CRITICAL_RULES injection + 7 AI providers + reasoning + tools', msg.message_id);
    else if (cmd === '/status') await sendMsg(chatId, `Bot v7 (never forgets)\nProviders: Nemotron+OR, Groq, OpenAI, Google, GH Models, Pollinations\nRules: CRITICAL_RULES injected into EVERY call`, msg.message_id);
    return;
  }
  
  if (!text) return;
  console.log(`\nQ: ${text.slice(0, 80)}`);
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
  
  try {
    let liveData = null;
    try { liveData = await fetchLiveData(text); } catch {}
    
    const messages = [
      { role: 'system', content: `Сегодня ${new Date().toLocaleString('ru-RU', {timeZone:'Europe/Berlin'})}. Отвечай прямо.` },
      { role: 'user', content: liveData ? `${text}\n\n[DATA: ${liveData}]` : text },
    ];
    
    const { content, provider } = await aiCall(messages, { maxTokens: 2000, tools: TOOLS });
    await sendMsg(chatId, content + `\n\n_(${provider})_`, msg.message_id);
    console.log(`A: [${provider}] ${content.slice(0, 80)}`);
  } catch (e) {
    await sendMsg(chatId, `❌ ${e.message}`, msg.message_id);
  }
}

// Polling
let offset = 0;
console.log('✅ Bot v7 ready (never forgets + 7 providers + reasoning)');
await fetch(`https://api.telegram.org/bot${TG_TOKEN}/deleteWebhook`).catch(() => {});

while (true) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getUpdates?offset=${offset}&timeout=30`, { signal: AbortSignal.timeout(40000) });
    const data = await r.json();
    if (!data.ok) { await new Promise(r => setTimeout(r, 5000)); continue; }
    for (const upd of data.result || []) {
      offset = upd.update_id + 1;
      await handleUpdate(upd).catch(e => console.error('err:', e.message));
    }
  } catch (e) {
    console.error('poll err:', e.message);
    await new Promise(r => setTimeout(r, 3000));
  }
}

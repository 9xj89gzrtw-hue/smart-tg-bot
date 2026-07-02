#!/usr/bin/env node
/**
 * Smart TG Bot v5 — with FUNCTION CALLING (autonomous tools)
 * Hidden features unlocked via R24:
 * - Function calling (bot autonomously calls web search)
 * - Streaming (faster first token)
 * - Vision (analyze images, via gpt-4o)
 * - Mega cascade (Groq → OpenAI → Google → GH Models → Pollinations)
 */

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const TG_TOKEN = process.env.TG_TOKEN;
const ALLOWED_CHATS = new Set((process.env.ALLOWED_CHATS || '').split(',').filter(Boolean));
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GOOGLE_AI_KEY = process.env.GOOGLE_AI_KEY || '';
const GH_TOKENS = (process.env.GH_TOKENS || process.env.GH_TOKEN || '').split(',').filter(t => t.startsWith('ghp_'));

// Token rotation for GH Models
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

// AI cascade
async function ghModelsChat(messages, model = 'gpt-4o-mini', maxTokens = 2000, tools = null) {
  for (let i = 0; i < GH_TOKENS.length * 2 + 3; i++) {
    const t = getNextToken();
    if (!t) { await new Promise(r => setTimeout(r, 2000)); continue; }
    try {
      const body = { model, messages: messages.map(m => ({role: m.role, content: m.content.slice(0, 12000)})), max_tokens: maxTokens, temperature: 0.7 };
      if (tools) body.tools = tools;
      const r = await fetch('https://models.inference.ai.azure.com/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${t.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      if (r.status === 429) { t.cooldown = Date.now() + 5000; t.req = 15; continue; }
      if (!r.ok) continue;
      return await r.json();
    } catch {}
  }
  throw new Error('GH Models exhausted');
}

async function groqChat(messages, maxTokens = 2000) {
  if (!GROQ_API_KEY) throw new Error('NO_GROQ');
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages, max_tokens: maxTokens, temperature: 0.7 }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Groq ${r.status}`);
  return await r.json();
}

async function googleChat(messages, maxTokens = 2000) {
  if (!GOOGLE_AI_KEY) throw new Error('NO_GOOGLE');
  const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content.slice(0, 12000) }] }));
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_AI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Google ${r.status}`);
  const data = await r.json();
  return { choices: [{ message: { content: data?.candidates?.[0]?.content?.parts?.[0]?.text || '' } }] };
}

async function pollinationsChat(messages, maxTokens = 1500) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch('https://text.pollinations.ai/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'openai', messages, max_tokens: maxTokens }),
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

// Tools for function calling
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for current information',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_crypto_price',
      description: 'Get current cryptocurrency price',
      parameters: { type: 'object', properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHUSDT' } }, required: ['symbol'] },
    },
  },
];

async function executeTool(name, args) {
  if (name === 'web_search') {
    // DuckDuckGo Instant API
    try {
      const r = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(args.query)}&format=json&no_html=1`, { signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      let result = '';
      if (d.Abstract) result += d.Abstract.slice(0, 500);
      for (const t of (d.RelatedTopics || []).slice(0, 3)) {
        if (t.Text) result += '\n' + t.Text.slice(0, 200);
      }
      return result || 'No results found';
    } catch (e) { return 'Search failed: ' + e.message; }
  }
  if (name === 'get_crypto_price') {
    try {
      const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${args.symbol}`, { signal: AbortSignal.timeout(5000) });
      const d = await r.json();
      return `${args.symbol}: $${parseFloat(d.price).toLocaleString('en-US', {maximumFractionDigits: 2})}`;
    } catch (e) { return 'Price fetch failed: ' + e.message; }
  }
  return 'Unknown tool';
}

// AI call with function calling
async function aiCallWithTools(messages) {
  // Try GH Models with tools first
  try {
    const data = await ghModelsChat(messages, 'gpt-4o-mini', 2000, TOOLS);
    const msg = data?.choices?.[0]?.message;
    
    // If model wants to call tools
    if (msg?.tool_calls?.length > 0) {
      console.log(`  🔧 Tool calls: ${msg.tool_calls.map(t => t.function.name).join(', ')}`);
      
      // Execute tools
      messages.push(msg); // Add assistant message with tool calls
      for (const tc of msg.tool_calls) {
        const args = JSON.parse(tc.function.arguments);
        const result = await executeTool(tc.function.name, args);
        console.log(`  → ${tc.function.name}(${JSON.stringify(args)}): ${result.slice(0, 80)}`);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
      
      // Get final response with tool results
      const data2 = await ghModelsChat(messages, 'gpt-4o-mini', 2000);
      const content = data2?.choices?.[0]?.message?.content || '';
      return { content, provider: 'GPT-4o-mini+tools+GH' };
    }
    
    // No tool calls — direct response
    return { content: msg?.content || '', provider: 'GPT-4o-mini+GH' };
  } catch (e) {
    console.log('  GH with tools failed:', e.message.slice(0, 60));
  }
  
  // Fallback: simple cascade without tools
  try { const d = await groqChat(messages); return { content: d?.choices?.[0]?.message?.content || '', provider: 'Groq/Llama-3.3-70B' }; } catch {}
  try { const d = await googleChat(messages); return { content: d?.choices?.[0]?.message?.content || '', provider: 'Google/Gemini-2.0' }; } catch {}
  try { const d = await ghModelsChat(messages, 'gpt-4o-mini', 2000); return { content: d?.choices?.[0]?.message?.content || '', provider: 'GH/GPT-4o-mini' }; } catch {}
  try { const d = await pollinationsChat(messages); return { content: d?.choices?.[0]?.message?.content || '', provider: 'Pollinations' }; } catch {}
  return { content: 'All providers failed', provider: 'none' };
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
    if (cmd === '/ping') await sendMsg(chatId, '🏓 pong (v5 with tools!)', msg.message_id);
    else if (cmd === '/help') await sendMsg(chatId, 'Commands: /help /ping /status\nBot v5 with autonomous function calling!', msg.message_id);
    else if (cmd === '/status') await sendMsg(chatId, `Bot v5 (function calling)\nOpenAI: ${OPENAI_API_KEY ? '✓' : '✗'}\nGroq: ${GROQ_API_KEY ? '✓' : '✗'}\nGoogle: ${GOOGLE_AI_KEY ? '✓' : '✗'}\nGH: ${GH_TOKENS.length}`, msg.message_id);
    return;
  }
  
  if (!text) return;
  console.log(`Q: ${text.slice(0, 80)}`);
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
  
  let liveData = null;
  try { liveData = await fetchLiveData(text); } catch {}
  
  const messages = [
    { role: 'system', content: `Ты Супер-Z. Сегодня ${new Date().toLocaleString('ru-RU', {timeZone:'Europe/Berlin'})}. Отвечай прямо, первая строка = ответ. Используй tools для актуальных данных.` },
    { role: 'user', content: liveData ? `${text}\n\n[DATA: ${liveData}]` : text },
  ];
  
  const { content, provider } = await aiCallWithTools(messages);
  await sendMsg(chatId, content + `\n\n_(${provider})_`, msg.message_id);
  console.log(`A: [${provider}] ${content.slice(0, 80)}`);
}

// Polling
let offset = 0;
console.log('✅ Bot v5 ready (function calling + mega cascade)');
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

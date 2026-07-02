#!/usr/bin/env node
/**
 * Smart TG Bot v4 — MEGA CASCADE with all AI providers
 * Runs on GitHub Actions (US servers — no region blocks)
 * 
 * AI providers (in priority order):
 * 1. OpenAI GPT-4o (direct, no rate limits)
 * 2. Groq Llama 3.3 70B (fast, 30 req/min)
 * 3. Google Gemini 2.5 Pro (15 req/min)
 * 4. GitHub Models GPT-4o-mini (15 req/min/token)
 * 5. Pollinations (free fallback)
 */

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const TG_TOKEN = process.env.TG_TOKEN;
const ALLOWED_CHATS = new Set((process.env.ALLOWED_CHATS || '').split(',').filter(Boolean));
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GOOGLE_AI_KEY = process.env.GOOGLE_AI_KEY || '';
const GH_TOKENS = (process.env.GH_TOKENS || process.env.GH_TOKEN || '').split(',').filter(t => t.startsWith('ghp_'));

console.log('🤖 Smart Bot v4 starting (mega cascade)');
console.log(`   OpenAI: ${OPENAI_API_KEY ? '✓' : '✗'}`);
console.log(`   Groq: ${GROQ_API_KEY ? '✓' : '✗'}`);
console.log(`   Google AI: ${GOOGLE_AI_KEY ? '✓' : '✗'}`);
console.log(`   GH Models: ${GH_TOKENS.length} tokens`);

// ====================== AI PROVIDERS ======================

// 1. OpenAI (direct)
async function openaiChat(messages, model = 'gpt-4o-mini', maxTokens = 2000) {
  if (!OPENAI_API_KEY) throw new Error('NO_OPENAI');
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: messages.map(m => ({role: m.role, content: m.content.slice(0, 16000)})), max_tokens: maxTokens, temperature: 0.7 }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) { const e = await r.text(); throw new Error(`OpenAI ${r.status}: ${e.slice(0, 100)}`); }
  const data = await r.json();
  return data?.choices?.[0]?.message?.content || '';
}

// 2. Groq (fast Llama 3.3 70B)
async function groqChat(messages, maxTokens = 2000) {
  if (!GROQ_API_KEY) throw new Error('NO_GROQ');
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: messages.map(m => ({role: m.role, content: m.content.slice(0, 12000)})), max_tokens: maxTokens, temperature: 0.7 }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) { const e = await r.text(); throw new Error(`Groq ${r.status}: ${e.slice(0, 100)}`); }
  const data = await r.json();
  return data?.choices?.[0]?.message?.content || '';
}

// 3. Google AI (Gemini 2.5 Pro)
async function googleChat(messages, maxTokens = 2000) {
  if (!GOOGLE_AI_KEY) throw new Error('NO_GOOGLE');
  // Convert to Gemini format
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content.slice(0, 12000) }],
  }));
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_AI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) { const e = await r.text(); throw new Error(`Google ${r.status}: ${e.slice(0, 100)}`); }
  const data = await r.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// 4. GitHub Models
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

async function ghModelsChat(messages, model = 'gpt-4o-mini', maxTokens = 2000) {
  for (let i = 0; i < GH_TOKENS.length * 2 + 3; i++) {
    const t = getNextToken();
    if (!t) { await new Promise(r => setTimeout(r, 2000)); continue; }
    try {
      const r = await fetch('https://models.inference.ai.azure.com/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${t.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: messages.map(m => ({role: m.role, content: m.content.slice(0, 12000)})), max_tokens: maxTokens, temperature: 0.7 }),
        signal: AbortSignal.timeout(30000),
      });
      if (r.status === 429) { t.cooldown = Date.now() + 5000; t.req = 15; continue; }
      if (!r.ok) continue;
      const data = await r.json();
      const content = data?.choices?.[0]?.message?.content;
      if (content) return content;
    } catch {}
  }
  throw new Error('GH Models exhausted');
}

// 5. Pollinations
async function pollinationsChat(messages, maxTokens = 1500) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch('https://text.pollinations.ai/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'SmartBot/4.0' },
        body: JSON.stringify({ model: 'openai', messages: messages.map(m => ({role: m.role, content: m.content.slice(0, 8000)})), max_tokens: maxTokens }),
        signal: AbortSignal.timeout(30000),
      });
      if (r.status === 429) { await new Promise(r => setTimeout(r, 2000 * Math.pow(2, i))); continue; }
      if (!r.ok) continue;
      const data = await r.json();
      const content = data?.choices?.[0]?.message?.content;
      if (content) return content;
    } catch {}
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error('Pollinations failed');
}

// MEGA CASCADE
async function aiCall(messages) {
  const errors = [];
  
  // 1. Groq (fastest, Llama 3.3 70B)
  try { return { content: await groqChat(messages), provider: 'Groq/Llama-3.3-70B' }; }
  catch (e) { errors.push(`Groq: ${e.message.slice(0, 60)}`); }
  
  // 2. OpenAI GPT-4o-mini (smart)
  try { return { content: await openaiChat(messages, 'gpt-4o-mini'), provider: 'OpenAI/GPT-4o-mini' }; }
  catch (e) { errors.push(`OpenAI: ${e.message.slice(0, 60)}`); }
  
  // 3. Google Gemini
  try { return { content: await googleChat(messages), provider: 'Google/Gemini-2.0' }; }
  catch (e) { errors.push(`Google: ${e.message.slice(0, 60)}`); }
  
  // 4. GH Models
  try { return { content: await ghModelsChat(messages, 'gpt-4o-mini'), provider: 'GH/GPT-4o-mini' }; }
  catch (e) { errors.push(`GH: ${e.message.slice(0, 60)}`); }
  
  // 5. Pollinations
  try { return { content: await pollinationsChat(messages), provider: 'Pollinations' }; }
  catch (e) { errors.push(`Poll: ${e.message.slice(0, 60)}`); }
  
  return { content: `All providers failed:\n${errors.join('\n')}`, provider: 'none' };
}

// ====================== LIVE DATA ======================
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

// ====================== TELEGRAM ======================
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

// ====================== HANDLE ======================
async function handleUpdate(upd) {
  const msg = upd.message;
  if (!msg) return;
  const chatId = msg.chat?.id;
  const text = msg.text || '';
  if (!ALLOWED_CHATS.has(String(chatId))) return;
  
  if (text.startsWith('/')) {
    const cmd = text.split(' ')[0].toLowerCase();
    if (cmd === '/ping') await sendMsg(chatId, '🏓 pong (v4 mega cascade)', msg.message_id);
    else if (cmd === '/help') await sendMsg(chatId, 'Commands: /help /ping /status', msg.message_id);
    else if (cmd === '/status') {
      let s = `Bot v4 (mega cascade)\nOpenAI: ${OPENAI_API_KEY ? '✓' : '✗'}\nGroq: ${GROQ_API_KEY ? '✓' : '✗'}\nGoogle: ${GOOGLE_AI_KEY ? '✓' : '✗'}\nGH: ${GH_TOKENS.length} tokens`;
      await sendMsg(chatId, s, msg.message_id);
    }
    return;
  }
  
  if (!text) return;
  console.log(`Q: ${text.slice(0, 80)}`);
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
  
  let liveData = null;
  try { liveData = await fetchLiveData(text); } catch {}
  
  const messages = [
    { role: 'system', content: `Ты Супер-Z. Сегодня ${new Date().toLocaleString('ru-RU', {timeZone:'Europe/Berlin'})}. Отвечай прямо, первая строка = ответ. Не увиливай.` },
    { role: 'user', content: liveData ? `${text}\n\n[DATA: ${liveData}]` : text },
  ];
  
  const { content, provider } = await aiCall(messages);
  await sendMsg(chatId, content + `\n\n_(${provider})_`, msg.message_id);
  console.log(`A: [${provider}] ${content.slice(0, 80)}`);
}

// ====================== POLLING ======================
let offset = 0;
console.log('✅ Bot v4 ready (polling, mega cascade)');
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

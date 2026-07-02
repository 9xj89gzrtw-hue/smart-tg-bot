#!/usr/bin/env node
/**
 * Smart TG Bot for GitHub Actions — NO z-ai SDK (only GH Models + Pollinations)
 * Uses polling mode (no webhook needed)
 * 
 * Runs 24/7 via cron (every 5h, max job time 6h)
 */

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import fs from 'node:fs';

// Load .env if exists
try {
  const envContent = fs.readFileSync('.env', 'utf8');
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {}

const TG_TOKEN = process.env.TG_TOKEN;
const ALLOWED_CHATS = new Set((process.env.ALLOWED_CHATS || '').split(',').filter(Boolean));
const GH_TOKENS = (process.env.GH_TOKENS || process.env.GH_TOKEN || '').split(',').filter(t => t.startsWith('ghp_'));

console.log(`🤖 Bot starting (GH Actions mode)`);
console.log(`   TG_TOKEN: ${TG_TOKEN ? 'set' : 'MISSING'}`);
console.log(`   ALLOWED_CHATS: ${[...ALLOWED_CHATS].join(',')}`);
console.log(`   GH_TOKENS: ${GH_TOKENS.length}`);

if (!TG_TOKEN) {
  console.error('❌ TG_TOKEN not set');
  process.exit(1);
}

// Token rotation
const tokenState = GH_TOKENS.map(token => ({
  token, requestsInLastMinute: 0, windowStart: Date.now(),
  cooldownUntil: 0, successCount: 0, failCount: 0,
}));

function getNextToken() {
  const now = Date.now();
  for (const t of tokenState) {
    if (now - t.windowStart > 60000) { t.requestsInLastMinute = 0; t.windowStart = now; }
  }
  const available = tokenState.filter(t => t.requestsInLastMinute < 14 && t.cooldownUntil < now);
  if (available.length === 0) return null;
  available.sort((a, b) => a.requestsInLastMinute - b.requestsInLastMinute);
  available[0].requestsInLastMinute++;
  return available[0];
}

// AI cascade
async function ghModelsChat(messages, model = 'gpt-4o-mini', maxTokens = 2000) {
  if (GH_TOKENS.length === 0) throw new Error('NO_GH_TOKEN');
  for (let attempt = 0; attempt < GH_TOKENS.length * 2 + 3; attempt++) {
    const tokenObj = getNextToken();
    if (!tokenObj) { await new Promise(r => setTimeout(r, 2000)); continue; }
    try {
      const r = await fetch('https://models.inference.ai.azure.com/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenObj.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: messages.map(m => ({role: m.role, content: m.content.slice(0,12000)})), max_tokens: maxTokens, temperature: 0.7 }),
        signal: AbortSignal.timeout(30000),
      });
      if (r.status === 429) { tokenObj.cooldownUntil = Date.now() + 5000; tokenObj.requestsInLastMinute = 15; continue; }
      if (!r.ok) { tokenObj.failCount++; continue; }
      const data = await r.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) { tokenObj.failCount++; continue; }
      tokenObj.successCount++;
      return content;
    } catch (e) { tokenObj.failCount++; continue; }
  }
  throw new Error('All GH tokens exhausted');
}

async function pollinationsChat(messages, maxTokens = 1500) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch('https://text.pollinations.ai/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'SmartBot-GH/1.0' },
        body: JSON.stringify({ model: 'openai', messages: messages.map(m => ({role: m.role, content: m.content.slice(0,8000)})), max_tokens: maxTokens }),
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

async function aiCall(messages) {
  try { const r = await ghModelsChat(messages, 'gpt-4o-mini'); return { content: r, provider: 'GPT-4o-mini+GH' }; } catch (e) { console.log('  GH mini fail:', e.message.slice(0, 60)); }
  try { const r = await ghModelsChat(messages, 'gpt-4o'); return { content: r, provider: 'GPT-4o+GH' }; } catch {}
  try { const r = await ghModelsChat(messages, 'Meta-Llama-3.1-405B-Instruct'); return { content: r, provider: 'Llama-405B+GH' }; } catch {}
  try { const r = await pollinationsChat(messages); return { content: r, provider: 'Pollinations' }; } catch (e) {}
  return { content: 'All AI providers failed. Try again later.', provider: 'error' };
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

// Handle update
async function handleUpdate(upd) {
  const msg = upd.message;
  if (!msg) return;
  const chatId = msg.chat?.id;
  const text = msg.text || '';
  if (!ALLOWED_CHATS.has(String(chatId))) return;
  
  if (text.startsWith('/')) {
    const cmd = text.split(' ')[0].toLowerCase();
    if (cmd === '/ping') await sendMsg(chatId, '🏓 pong (GH Actions)', msg.message_id);
    else if (cmd === '/help') await sendMsg(chatId, 'Commands: /help /ping /status', msg.message_id);
    else if (cmd === '/status') await sendMsg(chatId, `Bot: GitHub Actions\nGH tokens: ${GH_TOKENS.length}\nUptime: ${process.uptime().toFixed(0)}s`, msg.message_id);
    return;
  }
  
  if (!text) return;
  
  console.log(`Q: ${text.slice(0, 80)}`);
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
  
  let liveData = null;
  try { liveData = await fetchLiveData(text); } catch {}
  
  const messages = [
    { role: 'system', content: `Ты Супер-Z. Сегодня ${new Date().toLocaleString('ru-RU', {timeZone:'Europe/Berlin'})}. Отвечай прямо, первая строка = ответ.` },
    { role: 'user', content: liveData ? `${text}\n\n[DATA: ${liveData}]` : text },
  ];
  
  const { content, provider } = await aiCall(messages);
  await sendMsg(chatId, content + `\n\n_(${provider})_`, msg.message_id);
  console.log(`A: [${provider}] ${content.slice(0, 80)}`);
}

// Polling loop
let offset = 0;
console.log('✅ Bot ready (polling mode)');

// Delete webhook (in case set)
await fetch(`https://api.telegram.org/bot${TG_TOKEN}/deleteWebhook`).catch(() => {});

while (true) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getUpdates?offset=${offset}&timeout=30`, {
      signal: AbortSignal.timeout(40000),
    });
    const data = await r.json();
    if (!data.ok) {
      console.error('TG error:', data);
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }
    
    for (const upd of data.result || []) {
      offset = upd.update_id + 1;
      await handleUpdate(upd).catch(e => console.error('handle err:', e.message));
    }
  } catch (e) {
    console.error('poll err:', e.message);
    await new Promise(r => setTimeout(r, 3000));
  }
}

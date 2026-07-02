#!/usr/bin/env node
/**
 * Smart TG Bot v8 — Open-Weight LLM via HuggingFace Router
 * 
 * PRIMARY: HuggingFace Router (124 free open-weight models)
 *   - DeepSeek-V4-Flash (latest, fast, MIT)
 *   - DeepSeek-R1 (reasoning with <think>)
 *   - Llama-3.3-70B (smart)
 *   - Qwen3.5-9B (fast, Apache 2.0)
 * 
 * FALLBACK: GitHub Models + Groq + OpenAI + Google + Pollinations
 * 
 * Key: HF Router works from ANY region (including HK sandbox!)
 * Key: Open-weight models = minimal restrictions
 * Key: FREE, no GPU needed (HF hosts them)
 */

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const TG_TOKEN = process.env.TG_TOKEN;
const ALLOWED_CHATS = new Set((process.env.ALLOWED_CHATS || '').split(',').filter(Boolean));
const HF_TOKEN = process.env.HF_TOKEN || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GH_TOKENS = (process.env.GH_TOKENS || process.env.GH_TOKEN || '').split(',').filter(t => t.startsWith('ghp_'));

const CRITICAL_RULES = `🚨 КРИТИЧНО:
1. НИКОГДА не называй версию/цену/дату по памяти → web search.
2. Текущий год: ${new Date().getFullYear()}.
3. НИКОГДА не говори "X не существует" без web search.
4. Пользователь: Europe/Berlin, русский, женский род.
5. Отвечай ПРЯМО. Первая строка = ответ. Без рассуждений вслух.\n6. Интерпретируй намерение пользователя, не отвечай буквально.\n7. Если есть [WEB SEARCH] — используй как источник правды.
6. Не увиливай.`;

// ====================== HUGGINGFACE ROUTER (PRIMARY) ======================
async function hfRouterChat(messages, model = 'deepseek-ai/DeepSeek-V4-Flash', maxTokens = 2000) {
  const msgs = [{ role: 'system', content: CRITICAL_RULES }, ...messages.filter(m => m.role !== 'system')];
  const r = await fetch('https://router.huggingface.co/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${HF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: msgs, max_tokens: maxTokens, temperature: 0.7 }),
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) { const e = await r.text(); throw new Error(`HF ${r.status}: ${e.slice(0, 100)}`); }
  const data = await r.json();
  let content = data?.choices?.[0]?.message?.content || '';
  // Strip <think> tags from DeepSeek R1
  content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return content;
}

// ====================== FALLBACKS ======================
async function openrouterChat(messages, maxTokens = 2000) {
  if (!OPENROUTER_API_KEY) throw new Error('NO_OR');
  const msgs = [{ role: 'system', content: CRITICAL_RULES }, ...messages.filter(m => m.role !== 'system')];
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', messages: msgs, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) throw new Error(`OR ${r.status}`);
  const data = await r.json();
  return data?.choices?.[0]?.message?.content || '';
}

async function ghModelsChat(messages, maxTokens = 2000) {
  for (const token of GH_TOKENS) {
    try {
      const msgs = [{ role: 'system', content: CRITICAL_RULES }, ...messages.filter(m => m.role !== 'system')];
      const r = await fetch('https://models.inference.ai.azure.com/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: msgs, max_tokens: maxTokens }),
        signal: AbortSignal.timeout(30000),
      });
      if (r.status === 429) continue;
      if (!r.ok) continue;
      const data = await r.json();
      return data?.choices?.[0]?.message?.content || '';
    } catch {}
  }
  throw new Error('GH exhausted');
}

async function pollinationsChat(messages, maxTokens = 1500) {
  const msgs = [{ role: 'system', content: CRITICAL_RULES }, ...messages.filter(m => m.role !== 'system')];
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch('https://text.pollinations.ai/openai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'openai', messages: msgs, max_tokens: maxTokens }),
        signal: AbortSignal.timeout(30000),
      });
      if (r.status === 429) { await new Promise(r => setTimeout(r, 2000 * Math.pow(2, i))); continue; }
      if (!r.ok) continue;
      const data = await r.json();
      return data?.choices?.[0]?.message?.content || '';
    } catch {}
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error('Pollinations failed');
}


// Web search (DuckDuckGo Instant API — free, no key)
async function webSearch(query) {
  try {
    const r = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query.slice(0, 200))}&format=json&no_html=1`, { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    let result = '';
    if (d.Abstract) result += d.Abstract.slice(0, 400);
    for (const t of (d.RelatedTopics || []).slice(0, 3)) if (t.Text) result += '\n' + t.Text.slice(0, 200);
    return result || null;
  } catch { return null; }
}

// Check if question needs web search
function needsWebSearch(text) {
  const q = text.toLowerCase();
  return ['последн','latest','newest','сегодн','today','версия','version','цена','price','новост','news','кто лучше','сравни','2025','2026','2027','сколько стоит'].some(t => q.includes(t));
}

// MEGA CASCADE
async function aiCall(messages, options = {}) {
  const maxTokens = options.maxTokens || 2000;
  
  // 1. HF Router — Llama-3.3-70B (PRIMARY: most direct answers, smart)
  try { return { content: await hfRouterChat(messages, 'Qwen/Qwen3.5-9B', maxTokens), provider: 'Qwen3.5-9B+HF' }; } catch (e) { console.log('  HF Qwen:', e.message.slice(0, 50)); }
  
  // 2. HF Router — DeepSeek-V4-Flash (MIT, fast)
  try { return { content: await hfRouterChat(messages, 'deepseek-ai/DeepSeek-V4-Flash', maxTokens), provider: 'DeepSeek-V4-Flash+HF' }; } catch (e) { console.log('  HF V4:', e.message.slice(0, 50)); }
  
  // 3. HF Router — Qwen3.5-9B (Apache 2.0, fast)
  try { return { content: await hfRouterChat(messages, 'Qwen/Qwen3.5-9B', maxTokens), provider: 'Qwen3.5-9B+HF' }; } catch (e) { console.log('  HF Qwen:', e.message.slice(0, 50)); }
  
  // 4. OpenRouter — Nemotron reasoning (free)
  try { return { content: await openrouterChat(messages, maxTokens), provider: 'Nemotron+OR' }; } catch (e) { console.log('  OR:', e.message.slice(0, 50)); }
  
  // 5. GitHub Models
  try { return { content: await ghModelsChat(messages, maxTokens), provider: 'GPT-4o-mini+GH' }; } catch (e) { console.log('  GH:', e.message.slice(0, 50)); }
  
  // 6. Pollinations
  try { return { content: await pollinationsChat(messages, maxTokens), provider: 'Pollinations' }; } catch (e) { console.log('  Poll:', e.message.slice(0, 50)); }
  
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
    if (cmd === '/ping') await sendMsg(chatId, '🏓 pong (v8 open-weight!)', msg.message_id);
    else if (cmd === '/help') await sendMsg(chatId, 'Bot v8: Open-weight LLMs via HF Router\nDeepSeek-V4-Flash → Qwen3.5 → Llama-3.3-70B → Nemotron → GH Models → Pollinations', msg.message_id);
    else if (cmd === '/status') await sendMsg(chatId, `Bot v8 (open-weight)\nPrimary: HF Router (124 models)\nModels: DeepSeek-V4, Qwen3.5, Llama-3.3-70B, DeepSeek-R1`, msg.message_id);
    return;
  }
  
  if (!text) return;
  console.log(`Q: ${text.slice(0, 80)}`);
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
  
  try {
    let liveData = null;
    try { liveData = await fetchLiveData(text); } catch {}
    
    let webContext = '';
    if (!liveData && needsWebSearch(text)) {
      const ws = await webSearch(text);
      if (ws) webContext = `\n\n[WEB SEARCH: ${ws}]`;
    }
    const messages = [
      { role: 'user', content: (liveData ? `${text}\n\n[DATA: ${liveData}]` : text) + webContext },
    ];
    
    const { content, provider } = await aiCall(messages, { maxTokens: 2000 });
    await sendMsg(chatId, content + `\n\n_(${provider})_`, msg.message_id);
    console.log(`A: [${provider}] ${content.slice(0, 80)}`);
  } catch (e) {
    await sendMsg(chatId, `❌ ${e.message}`, msg.message_id);
  }
}

// Polling
let offset = 0;
console.log('✅ Bot v8 ready (open-weight LLMs via HF Router)');
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

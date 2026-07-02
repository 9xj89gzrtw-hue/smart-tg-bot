#!/usr/bin/env node
/**
 * MINIMAL Bot — guaranteed to work
 * Polls Telegram, calls GitHub Models GPT-4o-mini, responds
 */
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const TG_TOKEN = process.env.TG_TOKEN;
const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const ALLOWED_CHATS = new Set((process.env.ALLOWED_CHATS || '').split(',').filter(Boolean));

if (!TG_TOKEN) { console.error('NO TG_TOKEN'); process.exit(1); }
if (!GH_TOKEN) { console.error('NO GH_TOKEN'); process.exit(1); }

console.log(`Bot starting. TG_TOKEN=${TG_TOKEN.slice(0,10)}... GH_TOKEN=${GH_TOKEN.slice(0,10)}...`);
console.log(`ALLOWED_CHATS=${[...ALLOWED_CHATS]}`);

async function tg(method, params) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return r.json();
}

async function aiChat(userText) {
  const systemPrompt = `Ты — Супер-Z, умный AI-ассистент. Отвечай кратко и точно на русском. Сегодня ${new Date().toISOString().slice(0,10)}.`;
  const r = await fetch('https://models.inference.ai.azure.com/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText.slice(0, 4000) },
      ],
      max_tokens: 2000,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) {
    const e = await r.text();
    throw new Error(`GH Models ${r.status}: ${e.slice(0, 200)}`);
  }
  const data = await r.json();
  return data?.choices?.[0]?.message?.content || 'Error: empty response';
}

// Delete webhook (ensure polling works)
await fetch(`https://api.telegram.org/bot${TG_TOKEN}/deleteWebhook`).catch(() => {});
console.log('Webhook deleted');

// Polling loop
let offset = 0;
console.log('✅ Bot ready — polling Telegram...');

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
      const msg = upd.message;
      if (!msg || !msg.text) continue;
      const chatId = String(msg.chat.id);
      if (!ALLOWED_CHATS.has(chatId)) continue;
      
      console.log(`RECV [${chatId}]: ${msg.text.slice(0, 80)}`);
      
      try {
        await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
        const response = await aiChat(msg.text);
        await tg('sendMessage', { chat_id: chatId, text: response + '\n\n_(GPT-4o-mini+GH)_', parse_mode: 'Markdown' });
        console.log(`SENT: ${response.slice(0, 80)}`);
      } catch (e) {
        console.error('AI error:', e.message);
        await tg('sendMessage', { chat_id: chatId, text: `Error: ${e.message}` });
      }
    }
  } catch (e) {
    console.error('Poll error:', e.message);
    await new Promise(r => setTimeout(r, 3000));
  }
}

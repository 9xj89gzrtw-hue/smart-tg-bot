#!/usr/bin/env node
/**
 * Super-Z Bot v8.1 — GH Actions, polling, WITH web search
 * No Render, no webhook, no 409 conflicts
 */
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const TG_TOKEN = process.env.TG_TOKEN;
const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const ALLOWED_CHATS = new Set((process.env.ALLOWED_CHATS || '').split(',').filter(Boolean));

if (!TG_TOKEN) { console.error('NO TG_TOKEN'); process.exit(1); }
if (!GH_TOKEN) { console.error('NO GH_TOKEN'); process.exit(1); }

console.log(`Bot v8.1 starting. TG=${TG_TOKEN.slice(0,10)}... GH=${GH_TOKEN.slice(0,10)}...`);
console.log(`ALLOWED_CHATS=${[...ALLOWED_CHATS]}`);

async function tg(method, params) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return r.json();
}

// Web search — Wikipedia REST API (proper User-Agent)
async function webSearch(query) {
  const UA = 'SuperZBot/8.1 (https://github.com/9xj89gzrtw-hue/smart-tg-bot)';
  try {
    // 1. Wikipedia REST
    const url = `https://en.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(query.slice(0, 100))}&limit=3`;
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const data = await r.json();
      const pages = data.pages || [];
      if (pages.length > 0) {
        let result = '';
        for (const p of pages.slice(0, 2)) {
          const title = p.title || '';
          const excerpt = (p.excerpt || '').replace(/<[^>]+>/g, '').slice(0, 200);
          result += `${title}: ${excerpt}\n`;
        }
        return result || null;
      }
    }
  } catch (e) { console.log('Wiki search err:', e.message); }
  
  // 2. DuckDuckGo Instant Answer
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query.slice(0, 200))}&format=json&no_html=1`;
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const d = await r.json();
      let result = '';
      if (d.AbstractText) result += d.AbstractText.slice(0, 400) + '\n';
      for (const t of (d.RelatedTopics || []).slice(0, 3)) {
        if (t.Text) result += t.Text.slice(0, 200) + '\n';
      }
      return result || null;
    }
  } catch (e) { console.log('DDG search err:', e.message); }
  
  return null;
}

// Check if question needs web search
function needsWebSearch(text) {
  const q = text.toLowerCase();
  return ['последн','latest','newest','сегодн','today','версия','version','цена','price','новост','news',
          'кто лучше','сравни','2025','2026','2027','сколько стоит','актуальн','current','now',
          'gpt','claude','gemini','llama','deepseek','что нового','что было','последние'].some(t => q.includes(t));
}

// AI chat via GitHub Models
async function aiChat(userText, webContext) {
  const today = new Date().toISOString().slice(0, 10);
  let system = `Ты — Супер-Z, умный AI-ассистент. Отвечай кратко и точно на русском. Сегодня ${today}.`;
  
  if (webContext) {
    system += `\n\n[WEB SEARCH RESULTS — используй как источник правды:]\n${webContext}\n[END WEB RESULTS]`;
  } else if (needsWebSearch(userText)) {
    system += '\n\nВнимание: не удалось найти информацию в вебе. Если не знаешь ответ — честно скажи "не знаю".';
  } else {
    system += '\n\nУ тебя есть доступ к веб-поиску для актуальных данных.';
  }
  
  const r = await fetch('https://models.inference.ai.azure.com/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
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

// Delete webhook + start polling
await fetch(`https://api.telegram.org/bot${TG_TOKEN}/deleteWebhook`).catch(() => {});
console.log('Webhook deleted');

let offset = 0;
console.log('✅ Bot v8.1 ready — polling Telegram (with web search)...');

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
        
        // Web search if needed
        let webContext = null;
        if (needsWebSearch(msg.text)) {
          console.log('Searching web...');
          webContext = await webSearch(msg.text);
          console.log(`Web result: ${webContext ? webContext.slice(0, 100) : 'null'}`);
        }
        
        const response = await aiChat(msg.text, webContext);
        const footer = webContext ? `\n\n_(GPT-4o-mini+GH | web: yes)_` : `\n\n_(GPT-4o-mini+GH | web: no)_`;
        await tg('sendMessage', { chat_id: chatId, text: response + footer, parse_mode: 'Markdown' });
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

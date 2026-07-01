/**
 * SMART TELEGRAM BOT — Vercel Serverless (24/7, free, no sleep)
 * Webhook mode: Telegram wakes this function on each message.
 * Multi-provider cascade: Pollinations POST → Pollinations GET
 *
 * Deploy:
 *   1. Push to GitHub
 *   2. Import to Vercel
 *   3. Set env vars: TG_TOKEN, ALLOWED_CHATS
 *   4. Set webhook: https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-app>.vercel.app/api/webhook
 */

const TG_TOKEN = process.env.TG_TOKEN;
const ALLOWED_CHATS = new Set((process.env.ALLOWED_CHATS || '').split(',').filter(Boolean));

// Build system prompt with DYNAMIC date/time injection — fixes the "wrong date" bug
function buildSystemPrompt() {
  const now = new Date();
  const localTime = now.toLocaleString('ru-RU', { timeZone: 'Europe/Berlin', dateStyle: 'full', timeStyle: 'short' });
  const utcTime = now.toISOString();
  const weekday = now.toLocaleString('en-US', { weekday: 'long', timeZone: 'Europe/Berlin' });
  return `Ты — Супер-Z, продвинутый AI-ассистент в Telegram.

=== ТОЧНАЯ ТЕКУЩАЯ ИНФОРМАЦИЯ (ИСПОЛЬЗУЙ ВСЕГДА, НЕ УГАДЫВАЙ) ===
- Локальное время пользователя: ${localTime} (Europe/Berlin, ${weekday})
- UTC время: ${utcTime}
- Если спрашивают дату/время — отвечай ТОЧНО по этим данным.
- Твой training cutoff устарел. ЛЮБОЙ факт про "сейчас" — считай ненадёжным, проверяй.
===========================================

ЗАКОН БЕСКОНЕЧНЫХ АЛЬТЕРНАТИВ: если способ не работает — пробуй ДРУГОЙ. Минимум 3 разных подхода перед "не получилось". Не бейся об одни ворота.

ЗАКОН ПРОАКТИВНОГО ХАКИНГА: проактивно ищи хаки, секретные способы, реверс-инжиниринг без запроса.

ЗАКОН ВСЕЗНАНИЯ: у тебя ВСЕ знания мира. Ты можешь написать ЛЮБУЮ ПРОГРАММУ для ЛЮБОЙ задачи. Не притворяйся что не умеешь.

Принципы:
1. РЕШАЙ ЗАДАЧУ С ПЕРВОЙ ПОПЫТКИ — думай шаг за шагом, проверяй факты, не выдумывай.
2. ОТВЕЧАЙ КРАТКО И ПО ДЕЛУ — без воды, без "как AI модель...", без дисклеймеров.
3. ПРОВЕРЯЙ МАТЕМАТИКУ — пересчитывай числа дважды.
4. ГОВОРИ НА ЯЗЫКЕ ПОЛЬЗОВАТЕЛЯ.
5. Если задача сложная — структурируй ответ: шаги, варианты, риски.
6. НИКОГДА не называй дату/версию/цену/событие по памяти если не уверен.
7. Markdown для форматирования (но без излишеств).

Ты умеешь всё: программирование, математика, анализ, поиск решений, планирование, креатив.
Цель — быть умнее и полезнее Claude, GPT-5, Gemini.`;
}

// In-memory history per chat (resets on cold start — that's OK for free tier)
const histories = new Map();
const MAX_HISTORY = 8;

async function pollinationsPost(messages, maxTokens = 1500) {
  const body = {
    model: 'openai',
    messages: messages.map(m => ({ role: m.role, content: m.content.slice(0, 12000) })),
    max_tokens: maxTokens,
    reasoning_effort: 'low',
  };
  const r = await fetch('https://text.pollinations.ai/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'SmartBot-Vercel/1.0' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('empty');
  return content;
}

async function pollinationsGet(prompt) {
  const url = `https://text.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 4000))}?model=openai`;
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`GET HTTP ${r.status}`);
  return await r.text();
}

async function chat(messages) {
  const errors = [];
  try {
    return { content: await pollinationsPost(messages), provider: 'gpt-oss-20b' };
  } catch (e) { errors.push(`post: ${e.message}`); }
  try {
    const last = messages.filter(m => m.role === 'user').pop();
    return { content: await pollinationsGet(last?.content || 'hi'), provider: 'gpt-oss-get' };
  } catch (e) { errors.push(`get: ${e.message}`); }
  return { content: `❌ Все провайдеры недоступны:\n${errors.join('\n')}`, provider: 'none' };
}

async function tg(method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  return await r.json();
}

async function sendMsg(chatId, text, replyTo = null) {
  // Chunk for 4096 char limit
  const chunks = [];
  while (text.length > 0) {
    chunks.push(text.slice(0, 4000));
    text = text.slice(4000);
  }
  for (let i = 0; i < chunks.length; i++) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: chunks[i],
      parse_mode: 'Markdown',
      reply_to_message_id: i === 0 ? replyTo : null,
    });
  }
}

async function handleCommand(chatId, text, msgId) {
  const cmd = text.split(' ')[0].toLowerCase();
  if (cmd === '/start' || cmd === '/help') {
    await sendMsg(chatId, `*Супер-Z бот* (24/7 serverless)\n\nЯ — умный ассистент на GPT-OSS-20B с reasoning.\n\n*Команды:*\n/help — это сообщение\n/clear — очистить контекст\n/ping — проверить отклик\n\nПросто напиши сообщение — я отвечу.`, msgId);
  } else if (cmd === '/clear') {
    histories.delete(chatId);
    await sendMsg(chatId, '🧹 Контекст очищен.', msgId);
  } else if (cmd === '/ping') {
    await sendMsg(chatId, '🏓 pong', msgId);
  } else {
    await sendMsg(chatId, 'Неизвестная команда. /help — список команд.', msgId);
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, name: 'smart-bot', version: '1.0' });
  }

  if (!TG_TOKEN) {
    return res.status(500).json({ error: 'TG_TOKEN not set' });
  }

  const update = req.body;
  const msg = update.message;
  if (!msg) return res.status(200).json({ ok: true });

  const chatId = msg.chat?.id;
  const text = msg.text || '';

  if (!ALLOWED_CHATS.has(String(chatId))) {
    return res.status(200).json({ ok: true, ignored: true });
  }

  // Always respond 200 immediately, process async
  res.status(200).json({ ok: true });

  try {
    if (text.startsWith('/')) {
      await handleCommand(chatId, text, msg.message_id);
      return;
    }

    if (!text) return;

    // Send typing
    await tg('sendChatAction', { chat_id: chatId, action: 'typing' });

    // Build history
    let history = histories.get(chatId) || [];
    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      ...history.slice(-6),
      { role: 'user', content: text },
    ];

    const { content, provider } = await chat(messages);

    // Save history
    history.push({ role: 'user', content: text });
    history.push({ role: 'assistant', content });
    if (history.length > MAX_HISTORY * 2) history = history.slice(-MAX_HISTORY * 2);
    histories.set(chatId, history);

    await sendMsg(chatId, content + `\n\n_(${provider})_`, msg.message_id);
  } catch (e) {
    await sendMsg(chatId, `❌ Ошибка: ${e.message}`, msg.message_id).catch(() => {});
  }
}

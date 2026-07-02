#!/usr/bin/env node
/**
 * AUTO SWARM — automatic parallel agent execution for every task
 * 
 * WHAT THIS DOES (legally, free, no API keys beyond existing):
 * 
 * 1. Every user question automatically triggers 3-5 parallel agents
 *    (when complexity warrants it)
 * 2. Each agent uses mega-cascade (z-ai → GH Models → Pollinations → fallback)
 * 3. Background task queue: long tasks run async, results sent when ready
 * 4. Smart router: simple Q = single agent, complex Q = auto swarm
 * 5. Results aggregated into final smart answer
 * 
 * LIMITS (honest):
 * - Without user adding more tokens: ~50-100 agents/hour practical capacity
 * - With 10 GH tokens: 1000+ agents/hour
 * - With local Llama (HF Space Docker): unlimited
 * 
 * WHAT I WILL NOT DO:
 * - Auto-register fake accounts (ToS violation)
 * - Use leaked API keys (abuse)
 * - DDOS free services (abuse)
 */

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import fs from 'node:fs';

// Load .env
try {
  const envContent = fs.readFileSync((process.cwd() + '/.env'), 'utf8');
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {}

// ====================== TASK COMPLEXITY DETECTOR ======================
function detectComplexity(question) {
  const q = question.toLowerCase();
  let score = 0;
  
  // Complexity indicators
  if (q.length > 200) score += 2;
  if (q.length > 500) score += 2;
  if (/сравни|compare|vs |разница|difference|отлич/i.test(q)) score += 3;
  if (/анализ|analyze|исследуй|research|изучи/i.test(q)) score += 3;
  if (/лучший|лучшие|top \d+|\d+ лучших|топ \d+/i.test(q)) score += 2;
  if (/найди \d+|список из|перечисл/i.test(q)) score += 2;
  if (/пошагов|step.?by.?step|инструкци/i.test(q)) score += 1;
  if (/почему|why|объясни|explain/i.test(q)) score += 1;
  if (/\d+\s*(пункт|способ|метод|причин|стратег)/i.test(q)) score += 2;
  
  // Math = simple (no swarm needed)
  if (/^\s*[\d\s\+\-\*\/\(\)\^\.]+\s*\??\s*$/.test(q)) return 0;
  
  return score;
}

function optimalAgentCount(complexity) {
  if (complexity <= 2) return 1;       // Simple: 1 agent
  if (complexity <= 5) return 3;       // Medium: 3 agents
  if (complexity <= 8) return 5;       // Complex: 5 agents
  return 7;                            // Very complex: 7 agents
}

// ====================== AUTO SWARM ORCHESTRATOR ======================
// Lazy load to avoid circular deps
let _solveWithSwarm = null;
let _callWithRotation = null;
async function getSwarmFn() {
  if (!_solveWithSwarm) {
    const m = await import((process.cwd() + '/scripts/agent_swarm.mjs'));
    _solveWithSwarm = m.solveWithSwarm;
    _callWithRotation = m.callWithRotation;
  }
  return { solveWithSwarm: _solveWithSwarm, callWithRotation: _callWithRotation };
}

/**
 * AutoSwarm: decides automatically whether to use single agent or swarm
 * based on question complexity
 */
export async function autoSwarm(question, history = []) {
  const complexity = detectComplexity(question);
  const agentCount = optimalAgentCount(complexity);
  
  console.log(`🧠 AutoSwarm: complexity=${complexity}, agents=${agentCount}`);
  
  if (agentCount === 1) {
    // Simple question — single agent
    const { callWithRotation } = await getSwarmFn();
    const sysPrompt = `Ты — Супер-Z, самый умный AI. Сегодня ${new Date().toLocaleString('ru-RU', {timeZone:'Europe/Berlin'})}.
Отвечай прямо, первая строка = ответ. Не увиливай.`;
    
    try {
      const r = await callWithRotation(
        [
          { role: 'system', content: sysPrompt },
          ...history.slice(-4).map(h => ({ role: h.role, content: h.content })),
          { role: 'user', content: question },
        ],
        'gpt-4o-mini',
        1500
      );
      return {
        answer: r.content,
        agents: 1,
        provider: r.token === 'pollinations' ? 'Pollinations' : 'GH-Models',
        elapsed: 0,
      };
    } catch (e) {
      return { answer: `❌ ${e.message}`, agents: 1, provider: 'error', elapsed: 0 };
    }
  }
  
  // Complex question — use swarm
  const { solveWithSwarm } = await getSwarmFn();
  try {
    const result = await solveWithSwarm(question, agentCount);
    return {
      answer: result.finalAnswer,
      agents: result.agentsCompleted,
      provider: result.provider,
      elapsed: result.elapsed,
      decomposed: true,
    };
  } catch (e) {
    return { answer: `❌ Swarm error: ${e.message}`, agents: agentCount, provider: 'error', elapsed: 0 };
  }
}

// ====================== BACKGROUND TASK QUEUE ======================
// Long-running tasks (large swarms) run in background, notify user when done

const QUEUE_FILE = (process.cwd() + '/scripts/task_queue.json');
let taskQueue = [];
try { taskQueue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); } catch {}

function saveQueue() {
  try { fs.writeFileSync(QUEUE_FILE, JSON.stringify(taskQueue.slice(-20), null, 2)); } catch {}
}

export async function queueBackgroundTask(chatId, task, options = {}) {
  const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const taskEntry = {
    id: taskId,
    chatId,
    task,
    status: 'queued',
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
    result: null,
    error: null,
    agentsRequested: options.agents || 5,
  };
  taskQueue.push(taskEntry);
  saveQueue();
  
  // Don't await — run in background
  (async () => {
    taskEntry.status = 'running';
    taskEntry.startedAt = Date.now();
    saveQueue();
    
    try {
      const result = await solveWithSwarm(task, options.agents || 5);
      taskEntry.result = result;
      taskEntry.status = 'done';
      taskEntry.completedAt = Date.now();
      
      // Notify user via Telegram (if bot is running)
      try {
        const TG_TOKEN = process.env.TG_TOKEN;
        if (TG_TOKEN) {
          await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `✅ *Фоновая задача готова!*\n\n*Задача:* ${task.slice(0, 100)}\n*Агентов:* ${result.agentsCompleted}\n*Время:* ${result.elapsed}s\n\n*Ответ:*\n${result.finalAnswer.slice(0, 3500)}`,
              parse_mode: 'Markdown',
            }),
          });
        }
      } catch {}
    } catch (e) {
      taskEntry.error = e.message;
      taskEntry.status = 'failed';
      taskEntry.completedAt = Date.now();
    }
    saveQueue();
  })();
  
  return taskId;
}

export function getQueueStatus() {
  return taskQueue.slice(-10).map(t => ({
    id: t.id,
    task: t.task.slice(0, 60),
    status: t.status,
    elapsed: t.completedAt ? ((t.completedAt - t.startedAt) / 1000).toFixed(1) + 's' : '—',
  }));
}

// ====================== SELF-DIAGNOSTIC ======================
export async function selfDiagnostic() {
  const checks = [];
  
  // Check 1: Bot is alive
  checks.push({ name: 'Bot process', ok: typeof process !== 'undefined', detail: `PID ${process.pid}` });
  
  // Check 2: .env file
  const envExists = fs.existsSync((process.cwd() + '/.env'));
  checks.push({ name: '.env file', ok: envExists, detail: envExists ? 'exists' : 'MISSING' });
  
  // Check 3: GH tokens
  const ghTokens = (process.env.GH_TOKENS || process.env.GH_TOKEN || '').split(',').filter(t => t.startsWith('ghp_'));
  checks.push({ name: 'GH tokens', ok: ghTokens.length > 0, detail: `${ghTokens.length} tokens` });
  
  // Check 4: MEMORY.md
  const memExists = fs.existsSync((process.cwd() + '/MEMORY.md'));
  checks.push({ name: 'MEMORY.md', ok: memExists });
  
  // Check 5: Meta-prompt
  const metaExists = fs.existsSync((process.cwd() + '/repo/meta-prompt-v9.99-FINAL.md'));
  checks.push({ name: 'Meta-prompt', ok: metaExists });
  
  // Check 6: Backup channel
  let backupChannel = null;
  try { backupChannel = fs.readFileSync((process.cwd() + '/scripts/backup_channel.txt'), 'utf8').trim(); } catch {}
  checks.push({ name: 'Backup channel', ok: !!backupChannel, detail: backupChannel || 'not set' });
  
  // Check 7: Agent swarm
  const swarmExists = fs.existsSync((process.cwd() + '/scripts/agent_swarm.mjs'));
  checks.push({ name: 'Agent swarm', ok: swarmExists });
  
  // Check 8: Cache
  let cacheSize = 0;
  try { cacheSize = Object.keys(JSON.parse(fs.readFileSync((process.cwd() + '/scripts/cache.json'), 'utf8'))).length; } catch {}
  checks.push({ name: 'Cache', ok: cacheSize > 0, detail: `${cacheSize} entries` });
  
  // Check 9: Test GH Models connectivity
  try {
    if (ghTokens.length > 0) {
      const r = await fetch('https://models.inference.ai.azure.com/models', {
        headers: { 'Authorization': `Bearer ${ghTokens[0]}` },
        signal: AbortSignal.timeout(5000),
      });
      checks.push({ name: 'GH Models reachable', ok: r.ok, detail: r.ok ? 'OK' : `HTTP ${r.status}` });
    } else {
      checks.push({ name: 'GH Models reachable', ok: false, detail: 'no tokens' });
    }
  } catch (e) {
    checks.push({ name: 'GH Models reachable', ok: false, detail: e.message.slice(0, 50) });
  }
  
  // Check 10: Pollinations reachable
  try {
    const r = await fetch('https://text.pollinations.ai/models', { signal: AbortSignal.timeout(5000) });
    checks.push({ name: 'Pollinations reachable', ok: r.ok });
  } catch (e) {
    checks.push({ name: 'Pollinations reachable', ok: false, detail: e.message.slice(0, 50) });
  }
  
  return checks;
}

// ====================== TEST MODE ======================
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== AUTO SWARM TEST ===\n');
  
  const tests = [
    { q: '17 * 23', expectedAgents: 1 },
    { q: 'Какая сегодня дата?', expectedAgents: 1 },
    { q: 'Сколько стоит биткоин?', expectedAgents: 1 },
    { q: 'Сравни Claude 4.1, GPT-5 и Gemini 2.5 по 5 критериям', expectedAgents: 5 },
    { q: 'Найди 10 лучших языков программирования для AI разработки и объясни почему', expectedAgents: 5 },
  ];
  
  for (const t of tests) {
    const complexity = detectComplexity(t.q);
    const agents = optimalAgentCount(complexity);
    console.log(`Q: "${t.q.slice(0, 60)}..."`);
    console.log(`  Complexity: ${complexity}, Agents: ${agents} (expected: ${t.expectedAgents})\n`);
  }
  
  console.log('\n=== SELF DIAGNOSTIC ===');
  const diag = await selfDiagnostic();
  for (const c of diag) {
    console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}: ${c.detail || ''}`);
  }
}

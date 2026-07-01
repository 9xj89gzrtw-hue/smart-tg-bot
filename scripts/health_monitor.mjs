#!/usr/bin/env node
/**
 * HEALTH MONITOR — проверяет HF Space каждые 5 мин, рестартит при падении
 * Применяет правила R13 (auto-restart), R12 (health endpoint), AR2 (multi-host)
 *
 * Cron: every 5 minutes run node health_monitor.mjs
 */

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import fs from 'node:fs';

// Load .env
try {
  const envContent = fs.readFileSync('/home/z/my-project/.env', 'utf8');
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {}

const HF_TOKEN = process.env.HF_TOKEN;
const SPACE = 'danilaonly/smart-tg-bot';
const TG_TOKEN = process.env.TG_TOKEN;
const ADMIN_CHAT = '396449039';
const LOG_FILE = '/home/z/my-project/scripts/health_log.json';

// Load log
let log = [];
try { log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch {}

async function checkHFSpace() {
  const start = Date.now();
  try {
    // Check HF Space runtime status
    const r = await fetch(`https://huggingface.co/api/spaces/${SPACE}`, {
      headers: { 'Authorization': `Bearer ${HF_TOKEN}` },
      signal: AbortSignal.timeout(10000),
    });
    const d = await r.json();
    const stage = d?.runtime?.stage;
    const error = d?.runtime?.errorMessage;
    
    // Check actual webhook endpoint
    let webhookOk = false;
    try {
      const hr = await fetch(`https://danilaonly-smart-tg-bot.hf.space/health`, {
        signal: AbortSignal.timeout(15000),
      });
      if (hr.ok) {
        const hd = await hr.json();
        webhookOk = hd?.status === 'ok';
      }
    } catch {}
    
    return {
      stage,
      webhookOk,
      error,
      elapsed: Date.now() - start,
    };
  } catch (e) {
    return { stage: 'CHECK_FAILED', webhookOk: false, error: e.message, elapsed: Date.now() - start };
  }
}

async function restartHFSpace() {
  try {
    const r = await fetch(`https://huggingface.co/api/spaces/${SPACE}/restart`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${HF_TOKEN}` },
      signal: AbortSignal.timeout(10000),
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

async function notifyUser(text) {
  if (!TG_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ADMIN_CHAT,
        text,
        parse_mode: 'Markdown',
      }),
    });
  } catch {}
}

async function monitor() {
  console.log(`[${new Date().toISOString()}] Checking HF Space...`);
  const status = await checkHFSpace();
  
  const entry = {
    timestamp: new Date().toISOString(),
    stage: status.stage,
    webhookOk: status.webhookOk,
    elapsed: status.elapsed,
    error: status.error ? status.error.slice(0, 200) : null,
  };
  
  log.push(entry);
  if (log.length > 100) log = log.slice(-100);
  try { fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2)); } catch {}
  
  console.log(`  Stage: ${status.stage}, Webhook: ${status.webhookOk ? '✓' : '✗'}, Elapsed: ${status.elapsed}ms`);
  
  // Action: if not running or webhook dead, restart
  const needsRestart = 
    status.stage === 'RUNTIME_ERROR' ||
    status.stage === 'BUILD_ERROR' ||
    status.stage === 'NO_APP_FILE' ||
    (status.stage === 'RUNNING' && !status.webhookOk);
  
  if (needsRestart) {
    console.log(`  ⚠️  Space needs restart, triggering...`);
    const restarted = await restartHFSpace();
    if (restarted) {
      await notifyUser(`⚠️ *HF Space был внизу, перезапущен*\n\nStage: ${status.stage}\nWebhook: ${status.webhookOk ? 'OK' : 'DOWN'}\nError: ${(status.error || 'none').slice(0, 200)}\n\nПерезапущен в ${new Date().toISOString()}`);
      console.log(`  ✓ Restart triggered, user notified`);
    } else {
      await notifyUser(`❌ *HF Space вниз и restart не сработал*\n\nStage: ${status.stage}\nError: ${(status.error || '').slice(0, 300)}`);
      console.log(`  ✗ Restart failed`);
    }
  } else if (status.stage === 'RUNNING' && status.webhookOk) {
    console.log(`  ✅ All good`);
  }
  
  // Weekly summary
  const lastWeek = log.filter(e => Date.now() - new Date(e.timestamp).getTime() < 7 * 24 * 60 * 60 * 1000);
  const uptime = lastWeek.filter(e => e.stage === 'RUNNING' && e.webhookOk).length / lastWeek.length * 100;
  if (log.length % 288 === 0) { // every ~24h (288 checks × 5min)
    await notifyUser(`📊 *Weekly uptime: ${uptime.toFixed(1)}%*\n\nLast 7 days: ${lastWeek.length} checks\nHealthy: ${lastWeek.filter(e => e.stage === 'RUNNING' && e.webhookOk).length}`);
  }
}

await monitor();

#!/usr/bin/env node
/**
 * AUTO-DEPLOY: при каждом запуске пушит обновлённые файлы в HF Space + GitHub
 * Применяет AR2 (multi-host deployment), R15 (3-2-1 backup)
 * 
 * Cron: 0 * * * * node /home/z/my-project/scripts/auto_deploy.mjs
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
const GH_TOKEN = process.env.GH_TOKEN;
const SPACE = 'danilaonly/smart-tg-bot';
const GH_REPO = '9xj89gzrtw-hue/smart-tg-bot';

// Files to sync (sandbox → HF Space + GitHub)
const FILES = [
  { local: '/home/z/my-project/scripts/smart_bot_v3.mjs', hf: 'smart_bot_v3.mjs', gh: 'scripts/smart_bot_v3.mjs' },
  { local: '/home/z/my-project/MEMORY.md', hf: 'MEMORY.md', gh: 'MEMORY.md' },
  { local: '/home/z/my-project/SELF_IMPROVEMENT.md', hf: 'SELF_IMPROVEMENT.md', gh: 'SELF_IMPROVEMENT.md' },
  { local: '/home/z/my-project/repo/meta-prompt-v9.99-FINAL.md', hf: 'meta-prompt-v9.99-FINAL.md', gh: 'meta-prompt-v9.99-FINAL.md' },
];

async function pushToHF(path, content, commitMsg) {
  try {
    const r = await fetch(`https://huggingface.co/api/spaces/${SPACE}/commit/main`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${HF_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: commitMsg,
        files: [{ path, content: Buffer.from(content).toString('base64'), encoding: 'base64' }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    const d = await r.json();
    return !!d.commitOid;
  } catch (e) { return false; }
}

async function pushToGitHub(path, content, commitMsg) {
  if (!GH_TOKEN) return false;
  try {
    // Get existing SHA
    const r1 = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${path}`, {
      headers: { 'Authorization': `token ${GH_TOKEN}`, 'Accept': 'application/vnd.github+json' },
    });
    let sha = null;
    if (r1.ok) { const d = await r1.json(); sha = d.sha; }
    
    const r2 = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${path}`, {
      method: 'PUT',
      headers: { 'Authorization': `token ${GH_TOKEN}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github+json' },
      body: JSON.stringify({
        message: commitMsg,
        content: Buffer.from(content).toString('base64'),
        sha,
        branch: 'main',
      }),
    });
    const d2 = await r2.json();
    return !!d2.commit;
  } catch (e) { return false; }
}

async function sync() {
  console.log(`[${new Date().toISOString()}] Auto-deploy sync...`);
  
  for (const f of FILES) {
    if (!fs.existsSync(f.local)) {
      console.log(`  SKIP ${f.gh}: file not found`);
      continue;
    }
    const content = fs.readFileSync(f.local, 'utf8');
    const commitMsg = `Auto-sync ${new Date().toISOString().slice(0, 16)}`;
    
    const hfOk = await pushToHF(f.hf, content, commitMsg);
    const ghOk = await pushToGitHub(f.gh, content, commitMsg);
    
    console.log(`  ${f.gh}: HF ${hfOk ? '✓' : '✗'} | GH ${ghOk ? '✓' : '✗'}`);
  }
  
  console.log('Done.');
}

await sync();

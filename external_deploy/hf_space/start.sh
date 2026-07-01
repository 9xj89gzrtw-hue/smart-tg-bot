#!/bin/bash
# start.sh — bot startup with auto-pull from GitHub

set -e

echo "🚀 Starting Smart Bot v3..."

# Pull latest code from GitHub (if GH_TOKEN set)
if [ -n "$GH_TOKEN" ] && [ -n "$GH_REPO" ]; then
  echo "📥 Pulling latest code from GitHub..."
  cd /app
  git clone "https://$GH_TOKEN@github.com/$GH_REPO.git" /tmp/repo 2>/dev/null || true
  if [ -f /tmp/repo/scripts/smart_bot_v3.mjs ]; then
    cp /tmp/repo/scripts/smart_bot_v3.mjs /app/smart_bot_v3.mjs
    cp /tmp/repo/MEMORY.md /data/MEMORY.md 2>/dev/null || true
    cp /tmp/repo/meta-prompt-v9.99-FINAL.md /data/meta-prompt-v9.99-FINAL.md 2>/dev/null || true
    echo "✅ Updated from GitHub"
  fi
fi

# Set defaults
export TG_TOKEN="${TG_TOKEN:?TG_TOKEN is required}"
export ALLOWED_CHATS="${ALLOWED_CHATS:-396449039}"

# Create symlinks for persistent storage
mkdir -p /data
ln -sf /data/MEMORY.md /app/MEMORY.md 2>/dev/null || true
ln -sf /data/meta-prompt-v9.99-FINAL.md /app/meta-prompt-v9.99-FINAL.md 2>/dev/null || true
ln -sf /data/bot_history.json /app/bot_history.json 2>/dev/null || true

# Health check endpoint on port 7860 (HF requires)
node -e "
const http = require('http');
http.createServer((req, res) => {
  res.writeHead(200);
  res.end(JSON.stringify({status:'ok',uptime:process.uptime(),bot:'smart-bot-v3'}));
}).listen(7860);
console.log('Health endpoint on :7860');
" &

# Start the bot
exec node /app/smart_bot_v3.mjs

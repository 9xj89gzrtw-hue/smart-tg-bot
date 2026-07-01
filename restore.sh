#!/bin/bash
# ============================================================
# RESTORE.SH — One-line recovery for Smart Telegram Bot
# Usage: curl -L https://raw.githubusercontent.com/<user>/smart-tg-bot/main/restore.sh | bash
# ============================================================
set -e

echo "🚀 Restoring Smart Telegram Bot from scratch..."

# 1. Create working directory
mkdir -p ~/smart-bot && cd ~/smart-bot

# 2. Check dependencies
if ! command -v node &>/dev/null; then
  echo "❌ Node.js not found. Install: https://nodejs.org/"
  exit 1
fi

if ! command -v git &>/dev/null; then
  echo "⚠️  git not found (optional, for self-update)"
fi

# 3. Download files (GitHub raw)
echo "📥 Downloading bot files..."
for f in smart_bot.mjs MEMORY.md; do
  curl -fsSL "https://raw.githubusercontent.com/$GITHUB_USER/smart-tg-bot/main/$f" -o "$f" || true
done

# 4. Check if files exist
if [ ! -f "smart_bot.mjs" ]; then
  echo "❌ Bot code not found. Set GITHUB_USER env var or download manually."
  exit 1
fi

# 5. Setup environment
export TG_TOKEN="${TG_TOKEN:-8736969974:AAG66M9I0uGwRUksTt1iJt7v-n-f7T7BpnE}"
export ALLOWED_CHATS="${ALLOWED_CHATS:-396449039}"

echo "✅ Bot token: ${TG_TOKEN:0:15}..."
echo "✅ Allowed chats: $ALLOWED_CHATS"

# 6. Kill any existing bot
pkill -f smart_bot.mjs 2>/dev/null || true
sleep 2

# 7. Start bot (detached)
nohup node smart_bot.mjs > bot.log 2>&1 &
BOT_PID=$!
echo $BOT_PID > bot.pid

sleep 3

# 8. Verify it's running
if ps -p $BOT_PID > /dev/null; then
  echo ""
  echo "✅ Bot started! PID: $BOT_PID"
  echo "📝 Logs: ~/smart-bot/bot.log"
  echo ""
  echo "🤖 Send any message to @MyGlm52_bot to test."
  echo ""
  echo "🛑 To stop: kill \$(cat ~/smart-bot/bot.pid)"
  echo "🔄 To restart: cd ~/smart-bot && node smart_bot.mjs"
else
  echo "❌ Bot failed to start. Check bot.log:"
  cat bot.log
  exit 1
fi

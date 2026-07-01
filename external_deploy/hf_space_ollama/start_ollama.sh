#!/bin/bash
set -e
echo "🚀 Starting Ollama server..."
ollama serve > /tmp/ollama.log 2>&1 &
sleep 5
echo "📦 Pulling Llama 3.2 3B (1.2GB, one-time)..."
ollama pull llama3.2:3b > /tmp/pull.log 2>&1 || echo "Pull failed, will use API fallback"
echo "✅ Ollama ready"
export OLLAMA_URL=http://localhost:11434
export OLLAMA_MODEL=llama3.2:3b
echo "🤖 Starting bot..."
node -e "
const http = require('http');
http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type':'application/json'});
  res.end(JSON.stringify({status:'ok', bot:'v3+ollama', uptime:process.uptime()}));
}).listen(7860);
" &
exec node /app/smart_bot_v3.mjs

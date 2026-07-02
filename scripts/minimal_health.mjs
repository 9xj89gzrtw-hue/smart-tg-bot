#!/usr/bin/env node
// Minimal health-check server — fallback if main bot fails
import http from 'node:http';

const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), fallback: true }));
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});
server.listen(PORT, () => {
  console.log(`Minimal health server on :${PORT}`);
});

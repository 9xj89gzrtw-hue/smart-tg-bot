/**
 * RAG Engine — TF-IDF vector search for memory files
 * Zero dependencies, pure Node.js, instant search
 * 
 * Indexes all .md files → search by query → returns top-K relevant chunks
 * Used by bot to find relevant memory before answering
 */

import fs from 'node:fs';
import path from 'node:path';

const MEMORY_DIR = '/home/z/my-project';
const FILES_TO_INDEX = [
  'SELF_IMPROVEMENT.md',
  'MEMORY.md', 
  'CRITICAL_RULES.md',
  'TECHNICAL_DISCOVERIES.md',
  'FAILED_ATTEMPTS.md',
  'TEMPLATES.md',
  'META_PROMPT_QUICK_REF.md',
  'CONVERSATION_LOG.md',
  'CHANGELOG.md',
];

// Tokenize
function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^\wа-яё]/gi, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
}

// Build TF (term frequency)
function termFreq(tokens) {
  const tf = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  const total = tokens.length;
  for (const t in tf) tf[t] /= total;
  return tf;
}

// Build IDF (inverse document frequency)
function buildIDF(documents) {
  const df = {};
  for (const doc of documents) {
    const tokens = new Set(tokenize(doc.text));
    for (const t of tokens) df[t] = (df[t] || 0) + 1;
  }
  const idf = {};
  const N = documents.length;
  for (const t in df) idf[t] = Math.log(N / df[t]) + 1;
  return idf;
}

// TF-IDF vector
function tfidf(tf, idf) {
  const vec = {};
  for (const t in tf) vec[t] = tf[t] * (idf[t] || 0);
  return vec;
}

// Cosine similarity
function cosine(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (const t in a) {
    if (b[t]) dot += a[t] * b[t];
    magA += a[t] * a[t];
  }
  for (const t in b) magB += b[t] * b[t];
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// Split text into chunks (by ## headers or paragraphs)
function chunkText(text, maxLen = 500) {
  const chunks = [];
  const sections = text.split(/^##\s+/m);
  for (const section of sections) {
    if (section.trim().length < 20) continue;
    if (section.length <= maxLen) {
      chunks.push(section.trim());
    } else {
      // Split by paragraphs
      const paras = section.split(/\n\n+/);
      let current = '';
      for (const p of paras) {
        if ((current + p).length > maxLen) {
          if (current) chunks.push(current.trim());
          current = p;
        } else {
          current += '\n\n' + p;
        }
      }
      if (current.trim()) chunks.push(current.trim());
    }
  }
  return chunks;
}

// Build index
let index = null;

export function buildIndex() {
  const documents = [];
  
  for (const file of FILES_TO_INDEX) {
    const filepath = path.join(MEMORY_DIR, file);
    try {
      const content = fs.readFileSync(filepath, 'utf8');
      const chunks = chunkText(content);
      for (let i = 0; i < chunks.length; i++) {
        documents.push({
          file,
          chunkIndex: i,
          text: chunks[i],
          tokens: tokenize(chunks[i]),
        });
      }
    } catch {}
  }
  
  // Also try relative path (for GH Actions)
  if (documents.length === 0) {
    for (const file of FILES_TO_INDEX) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const chunks = chunkText(content);
        for (let i = 0; i < chunks.length; i++) {
          documents.push({
            file,
            chunkIndex: i,
            text: chunks[i],
            tokens: tokenize(chunks[i]),
          });
        }
      } catch {}
    }
  }
  
  const idf = buildIDF(documents);
  
  // Precompute TF-IDF vectors
  for (const doc of documents) {
    const tf = termFreq(doc.tokens);
    doc.vector = tfidf(tf, idf);
  }
  
  index = { documents, idf };
  console.log(`📚 RAG index: ${documents.length} chunks from ${new Set(documents.map(d => d.file)).size} files`);
  return index;
}

// Search
export function search(query, topK = 3) {
  if (!index) buildIndex();
  
  const queryTokens = tokenize(query);
  const queryTF = termFreq(queryTokens);
  const queryVec = tfidf(queryTF, index.idf);
  
  const scores = index.documents.map(doc => ({
    file: doc.file,
    text: doc.text.slice(0, 300),
    score: cosine(queryVec, doc.vector),
  }));
  
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topK).filter(s => s.score > 0.01);
}

// Get context for bot
export function getContext(query, maxLen = 1000) {
  const results = search(query, 3);
  if (results.length === 0) return null;
  
  let context = '';
  for (const r of results) {
    const chunk = `[${r.file}] ${r.text}`;
    if ((context + chunk).length > maxLen) break;
    context += chunk + '\n\n';
  }
  return context.trim() || null;
}

// Test
if (import.meta.url === `file://${process.argv[1]}`) {
  buildIndex();
  
  const tests = [
    'skip-if-active bug',
    'how to deploy bot',
    'GitHub Actions 24/7',
    'HF Router models',
    'outdated information fix',
  ];
  
  for (const q of tests) {
    console.log(`\nQ: ${q}`);
    const results = search(q, 2);
    for (const r of results) {
      console.log(`  [${r.file}] score=${r.score.toFixed(3)}: ${r.text.slice(0, 80)}`);
    }
  }
}

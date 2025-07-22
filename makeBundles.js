#!/usr/bin/env node
/**
 *  makeBundles.js  –  Convert a chapter‑marked text file into
 *  Vertex AI batch‑prediction bundles (one JSON per line).
 *
 *  Usage:
 *      node makeBundles.js input.txt gs://my‑bucket/bundles.jsonl
 *      # (or any local path instead of GCS for a dry run)
 */

import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';

if (process.argv.length < 4) {
  console.error('Usage: node makeBundles.js <input.txt> <output.jsonl>');
  process.exit(1);
}

const [,, inFile, outFile] = process.argv;

// ---------------------------------------------------------------------------
// 1.  constants you might customise
// ---------------------------------------------------------------------------
const SYSTEM_TEXT =
  'You are a DE‑EN translator. Preserve /index/ tags exactly.';
const CHAP_REGEX  = /^\[CHAPTER MARKER]/i;           // chapter header

// ---------------------------------------------------------------------------
// 2.  read input, split into chapters
// ---------------------------------------------------------------------------
const rawLines = fs.readFileSync(inFile, 'utf8').split(/\r?\n/);

const chapters = [];
let cur = [];

for (const ln of rawLines) {
  const line = ln.trim();
  if (!line) continue;                 // skip blanks

  if (CHAP_REGEX.test(line)) {         // new chapter?
    if (cur.length) chapters.push(cur.join('\n'));
    cur = [];
  } else {
    cur.push(line.endsWith('|') ? line : line + '|');   // ensure trailing |
  }
}
if (cur.length) chapters.push(cur.join('\n'));          // last chapter

console.log(`📚  Found ${chapters.length} chapters`);

// ---------------------------------------------------------------------------
// 3.  stream‑write JSONL (optionally gzipped)
// ---------------------------------------------------------------------------
const outStream = outFile.endsWith('.gz')
  ? fs.createWriteStream(outFile).pipe(createGzip())
  : fs.createWriteStream(outFile);

for (const text of chapters) {
  const req = {
    request: {
      systemInstruction: {
        role: 'system',
        parts: [{ text: SYSTEM_TEXT }]
      },
      contents: [
        { role: 'user', parts: [{ text }] }
      ]
    }
  };
  outStream.write(JSON.stringify(req) + '\n');
}

await pipeline(outStream);
console.log(`✅  Bundles written ➜  ${outFile}`);
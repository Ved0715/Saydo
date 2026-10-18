// Surfaces the interesting part of a failed test log as public annotations
// (job logs need a signed-in viewer; annotations do not).
import fs from 'node:fs';

const file = process.argv[2] ?? 'vitest.log';
if (!fs.existsSync(file)) process.exit(0);
const lines = fs.readFileSync(file, 'utf8').replace(/\x1b\[[0-9;]*m/g, '').split('\n');
const keep = new Set();
lines.forEach((line, i) => {
  if (/FAIL|×|AssertionError|Error:|Unhandled|failed|Timed out|ERR_/.test(line)) {
    for (let j = Math.max(0, i - 2); j < Math.min(lines.length, i + 12); j++) keep.add(j);
  }
});
const picked = [...keep].sort((a, b) => a - b).map((i) => lines[i]);
const text = (picked.length ? picked : lines.slice(-60)).join('\n').slice(0, 30000);
const escape = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
for (let i = 0; i < text.length; i += 4000) {
  console.log(`::error title=Test output (${i / 4000 + 1})::${escape(text.slice(i, i + 4000))}`);
}

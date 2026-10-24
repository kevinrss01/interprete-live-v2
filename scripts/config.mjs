import fs from 'node:fs';
import path from 'node:path';
export const ROOT = path.resolve(import.meta.dirname, '..');
// Explicit task-local credentials take precedence over unrelated inherited keys.
for (const line of fs.readFileSync(path.join(ROOT, 'apps/server/.env.local'), 'utf8').split('\n')) {
  const match = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (!match) continue;
  try { process.env[match[1]] = JSON.parse(match[2]); }
  catch { process.env[match[1]] = match[2]; }
}
export const OUT = path.join(ROOT, 'benchmark-results');
export const FIXTURES = path.join(ROOT, 'benchmark-corpus');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(FIXTURES, { recursive: true });
export function safeError(error) {
  return String(error?.message ?? error).replace(/(?:sk[_-]|sutkn_)[\w-]+/g, '[redacted]').replace(/(token|key|secret)=[^&\s]+/gi, '$1=[redacted]').slice(0, 500);
}
export async function jsonFetch(url, options = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25000), ...options });
  const json = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${safeError(json.error?.message ?? json.detail ?? json.message ?? JSON.stringify(json))}`);
  return json;
}
export function record(kind, row) {
  const item = { timestamp: new Date().toISOString(), ...row };
  fs.appendFileSync(path.join(OUT, `${kind}.jsonl`), JSON.stringify(item) + '\n');
  return item;
}
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

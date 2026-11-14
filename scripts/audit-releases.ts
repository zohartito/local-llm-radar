/** Read-only public-source audit. Never edits dates, scores, caches, or schedules. */
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import saved from '../data/specialist-snapshots.json';
import { RELEASE_RECORDS, checkReleaseProof } from '../src/lib/release-evidence';
import { releaseCoverage, releaseInventory } from '../src/lib/release-inventory';
import type { SpecialistSnapshot } from '../src/lib/model-types';
import type { MergedModel } from '../src/lib/merge-models';

const allowed = new Set(['raw.githubusercontent.com', 'api.github.com', 'www.ultralytics.com', 'blog.google', 'local-llm-radar.vercel.app']);
async function readPublic(url: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !allowed.has(parsed.hostname) || parsed.username || parsed.password) throw new Error('Unapproved release source');
  const response = await fetch(parsed, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Local-LLM-Radar-release-audit' } });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let body = '', size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 12 * 1024 * 1024) throw new Error('Source too large'); body += decoder.decode(value, { stream: true }); } return body + decoder.decode(); }
  finally { await reader.cancel(); }
}
async function main() {
  const args = process.argv.slice(2);
  const outFlag = args.indexOf('--out');
  if (outFlag >= 0 && !args[outFlag + 1]) throw new Error('--out requires a directory');
  const out = path.resolve(outFlag >= 0 ? args[outFlag + 1] : 'output/release-audit');
  await mkdir(out, { recursive: true });
  const checks: { id: string; status: string; source: string; sha256?: string; error?: string }[] = [];
  const bodies = new Map<string, string>();
  for (const record of RELEASE_RECORDS) {
    try {
      const body = bodies.get(record.proof.url) ?? await readPublic(record.proof.url);
      bodies.set(record.proof.url, body);
      const valid = checkReleaseProof(record, body);
      checks.push({ id: record.id, status: valid ? 'evidence-present' : 'needs-review', source: record.proof.url, sha256: createHash('sha256').update(body).digest('hex') });
    } catch (error) { checks.push({ id: record.id, status: 'source-unavailable', source: record.proof.url, error: String(error) }); }
  }
  let text: MergedModel[] = [], textStatus = 'unavailable';
  try {
    const response = JSON.parse(await readPublic('https://local-llm-radar.vercel.app/api/leaderboard'));
    if (!Array.isArray(response.models) || response.models.some((row: MergedModel) => typeof row.slug !== 'string' || typeof row.name !== 'string')) throw new Error('Invalid text inventory');
    text = response.models; textStatus = response.usedFallback ? 'fallback' : response.stale ? 'stale' : 'cached-live';
  } catch (error) { textStatus = `unavailable: ${String(error)}`; }
  const inventory = releaseInventory(saved as SpecialistSnapshot[], text);
  const missing = inventory.filter(row => row.status === 'unknown').map(row => ({ ...row,
    lookupUrl: `https://www.google.com/search?q=${encodeURIComponent(`${row.name} official model weights release announcement`)}`,
    instruction: 'Review an official dated availability announcement for this exact version. Repository creation, paper and benchmark dates do not establish release.',
  }));
  const report = { checkedAt: new Date().toISOString(), specialistInventory: 'checked-in snapshots; dates shown per source', specialistChecks: saved.map(s => ({ boardId: s.boardId, checkedAt: s.checkedAt })), textInventory: textStatus, counts: releaseCoverage(inventory), checks, missing };
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(out, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
  console.log(JSON.stringify({ out, counts: report.counts, checks: checks.map(({ id, status }) => ({ id, status })), textInventory: textStatus }, null, 2));
  if (checks.some(check => check.status !== 'evidence-present') || textStatus.startsWith('unavailable')) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });

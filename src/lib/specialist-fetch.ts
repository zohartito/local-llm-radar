import type { SpecialistBoard } from './model-types';
import { parseSpecialistSnapshot } from './specialist-parsers';

const ALLOWED_HOSTS = new Set(['mteb-leaderboard-backend.hf.space', 'agentset.ai', '3d-arena-3d-arena.hf.space', 'raw.githubusercontent.com', 'mmmu-benchmark.github.io', '99franklin.github.io', 'sakshi113.github.io', 'video-mme.github.io', 'cocodataset.org', 'www.cvlibs.net']);
const MAX_BYTES = 12 * 1024 * 1024;

/** Fixed public endpoints only; bound time, redirects, and decompressed size. */
export async function fetchSpecialistSnapshot(board: SpecialistBoard) {
  const url = new URL(board.dataUrl);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname) || url.username || url.password) throw new Error('Unsupported source');
  const response = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok || !response.body) throw new Error(`Source HTTP ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('Source exceeded size limit');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { await reader.cancel(); }
  return parseSpecialistSnapshot(text, board, new Date().toISOString());
}

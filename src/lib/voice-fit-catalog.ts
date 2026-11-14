import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseVoiceFitCatalog } from './voice-fit';

export function loadVoiceFitCatalog() {
  return parseVoiceFitCatalog(JSON.parse(readFileSync(path.join(process.cwd(), 'data', 'voice-fit.json'), 'utf8')));
}

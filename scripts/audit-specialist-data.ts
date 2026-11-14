/** Read-only source reconciliation. Captures raw public inputs; no Redis writes. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { SPECIALIST_BOARDS, type SpecialistSnapshot, type SpecialistRow } from '../src/lib/model-types';
import { enrichReleaseDate } from '../src/lib/release-evidence';
import { parseSpecialistSnapshot } from '../src/lib/specialist-parsers';

async function main() {
  const directory = path.resolve(process.argv[2] ?? 'output/live-audit');
  mkdirSync(directory, { recursive: true });
  const receipts: unknown[] = [];
  const replay = process.argv.includes('--replay');
  const close = (a: number, b: number, label: string) => assert(Math.abs(a - b) < 1e-8, `${label}: ${a} != ${b}`);
  for (let start = 0; start < SPECIALIST_BOARDS.length; start += 3) {
    const batch = SPECIALIST_BOARDS.slice(start, start + 3);
    const results = await Promise.allSettled(batch.map(async board => {
      const file = path.join(directory, `${board.id}.raw`);
      let text: string;
      if (replay) text = readFileSync(file, 'utf8');
      else {
        const raw = await fetch(board.dataUrl, { signal: AbortSignal.timeout(30_000) });
        assert(raw.ok, `${board.id}: HTTP ${raw.status}`);
        text = await raw.text();
        writeFileSync(file, text);
      }
      const parsed = parseSpecialistSnapshot(text, board, new Date().toISOString());
      const live = JSON.parse(readFileSync(path.join(directory, `${board.id}.json`), 'utf8')) as SpecialistSnapshot & { rows: (SpecialistRow & {rank: number|null})[] };
      assert.equal(live.benchmark, board.benchmark, `${board.id}: deployed edition differs`);
      const byId = new Map(parsed.rows.map(row => [row.id, enrichReleaseDate(board.id, row)]));
      assert.equal(byId.size, parsed.rows.length, `${board.id}: duplicate IDs`);
      const diffs: {id:string;field:string;live:unknown;source:unknown}[] = [];
      for (const row of parsed.rows) {
        if (!live.rows.some(value => value.id === row.id)) diffs.push({ id: row.id, field: 'identity', live: null, source: row.name });
      }
      let checked = 0;
      for (const row of live.rows) {
        const upstream = byId.get(row.id);
        if (!upstream) { diffs.push({id:row.id,field:'identity',live:row.name,source:null});continue; }
        for (const field of ['name','provider','score','openWeights','releaseDate','inputModalities','benchmarks','details','interval','releaseEvidence','identityKind'] as const) {
          const a=row[field] ?? null,b=upstream[field] ?? null;
          if (JSON.stringify(a)!==JSON.stringify(b)) diffs.push({id:row.id,field,live:a,source:b});
          checked++;
        }
      }
      for (const row of live.rows) {
        const expected = row.score === null ? null : 1 + live.rows.filter(other => other.score !== null && (board.direction === 'asc' ? other.score < row.score! : other.score > row.score!)).length;
        assert.equal(row.rank, expected, `${board.id}/${row.id}: rank`);
      }
      // Independent comparison of normalized MTEB numbers against raw JSON.
      let rawScoreCells = 0;
      let recomputedMeans = 0;
      if(board.parser==='mteb') {
        const data=JSON.parse(text);
        for(const row of parsed.rows) {
          const candidates=data.rows.filter((r: {model:{name:string}})=>r.model.name===row.name);
          const upstream=candidates.find((r:{experiments?:Record<string,unknown>}) => JSON.stringify(r.experiments ? Object.fromEntries(Object.entries(r.experiments).sort(([a],[b])=>a.localeCompare(b))) : {})===String(row.details.Experiment || '{}'));
          assert(upstream, `${row.id}: missing raw observation`);
          const complete=data.tasks.every((t:string)=>typeof upstream.scoresByTask[t]==='number');
          assert.equal(row.score, complete && upstream.meanTask!==null ? upstream.meanTask*100:null,`${row.id}: mean`);
          rawScoreCells++;
          if (complete && row.score !== null) {
            const values: number[] = data.aggregations[0] === 'mean_task_type'
              ? Object.values(upstream.scoresByTaskType)
              : data.tasks.map((task: string) => upstream.scoresByTask[task]);
            close(row.score, values.reduce((a,b)=>a+b,0) / values.length * 100, `${row.id}: independent primary mean`);
            recomputedMeans++;
          }
          for(const [key,value] of Object.entries(row.benchmarks ?? {})) {
            if (key.startsWith('group:') && value !== null) {
              const tasks = data.tasksMeta.filter((task: {name:string;type:string}) => task.type === key.slice(6) && data.tasks.includes(task.name));
              const values: number[] = tasks.map((task: {name:string}) => upstream.scoresByTask[task.name]);
              close(value, values.reduce((a,b)=>a+b,0) / values.length * 100, `${row.id}/${key}: group mean`);
              recomputedMeans++;
            }
            if(!key.startsWith('task:'))continue;
            assert.equal(value,upstream.scoresByTask[key.slice(5)]*100,`${row.id}/${key}`);rawScoreCells++;
          }
        }
      }
      return {board:board.id,sourceUrl:board.dataUrl,sha256:createHash('sha256').update(text).digest('hex'),checkedAt:parsed.checkedAt,replayed:replay,rows:live.rows.length,sourceRows:parsed.rows.length,checkedFields:checked,rawScoreCells,recomputedMeans,releaseDates:live.rows.filter(r=>r.releaseDate).length,unknownDates:live.rows.filter(r=>!r.releaseDate).length,differences:diffs};
    }));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const failure = { board: batch[index].id, error: String(result.reason) };
        receipts.push(failure); console.error(failure); process.exitCode = 1;
      } else {
        const r = result.value; receipts.push(r);
        console.log(JSON.stringify({ ...r, differences: r.differences.length }));
        if (r.differences.length) process.exitCode = 1;
      }
    });
  }
  writeFileSync(path.join(directory,'specialist-verification.json'),JSON.stringify(receipts,null,2));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});

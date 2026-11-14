import { NextRequest } from 'next/server';
import type { LeaderboardData } from '../src/lib/leaderboard';
import { SCORING_VERSION } from '../src/lib/merge-models';
import { readSharedCache, readRankSnapshotAround, setPersistenceForTests } from '../src/lib/store';
import { GET as leaderboardGET } from '../src/app/api/leaderboard/route';
import { GET as rankingsGET } from '../src/app/api/rankings/route';
import { getLeaderboardData } from '../src/lib/leaderboard-service';

jest.mock('../src/lib/leaderboard-service', () => ({ getLeaderboardData: jest.fn() }));
const data = (): LeaderboardData => ({ models: [], sources: [], updated: new Date().toISOString(), scoringVersion: SCORING_VERSION, usedFallback: false, stale: false, dataSourceLabel: 'live' });
afterEach(() => { jest.restoreAllMocks(); setPersistenceForTests(undefined); });

test('round2 CDN cannot retain a fresh badge past the underlying cache deadline', async () => {
  jest.mocked(getLeaderboardData).mockResolvedValue({data:data(),cacheStatus:'HIT',cacheAgeSeconds:1795});
  const response=await leaderboardGET();
  const header=response.headers.get('cache-control') ?? '';
  const ttl=Number(header.match(/s-maxage=(\d+)/)?.[1]??0);
  const swr=Number(header.match(/stale-while-revalidate=(\d+)/)?.[1]??0);
  expect(ttl+swr).toBeLessThanOrEqual(5);
});

test('round2 fallback response does not get a fresh CDN cache window', async () => {
  jest.mocked(getLeaderboardData).mockResolvedValue({data:{...data(),usedFallback:true,dataSourceLabel:'fallback',stale:true},cacheStatus:'FALLBACK',cacheAgeSeconds:0});
  expect((await leaderboardGET()).headers.get('cache-control')).toContain('no-store');
});

test('round2 malformed shared snapshot is unavailable, never a fresh cache hit', async () => {
  setPersistenceForTests({get:async()=>({scoringVersion:SCORING_VERSION,data:{models:'invalid',sources:null}})} as never);
  expect(await readSharedCache()).toBeNull();
});

test('round2 trend history skips a bad latest record and uses an earlier valid day', async () => {
  const today=Math.floor(Date.now()/86400000);
  const dates=[today-9,today-8,today-7].map(n=>new Date(n*86400000).toISOString().slice(0,10));
  const good={date:dates[1],updated:dates[1],scoringVersion:SCORING_VERSION,quality:'live',ranks:{overall:{x:1},categories:{}}};
  setPersistenceForTests({zrange:async()=>dates,get:async(key:string)=>key.endsWith(dates[1])?good:null} as never);
  expect((await readRankSnapshotAround(7))?.date).toBe(dates[1]);
});

test('round2 degraded current data never produces a week-over-week movement claim', async () => {
  const model={name:'Probe',slug:'probe',provider:'Example',benchmarks:{gpqa_diamond:90},composite_score:60,params_b:8,closed_source:false,rank_status:'provisional',benchmark_coverage:1,source_count:{},license:'MIT',vram_int4_gb:6};
  jest.mocked(getLeaderboardData).mockResolvedValue({data:{...data(),models:[model] as never,dataSourceLabel:'partial',degradedSources:['livebench']},cacheStatus:'MISS',cacheAgeSeconds:0});
  setPersistenceForTests({zrange:async()=>['2026-10-15'],get:async()=>({date:'2026-10-15',scoringVersion:SCORING_VERSION,quality:'live',ranks:{overall:{probe:20},categories:{}}})} as never);
  const response=await rankingsGET(new NextRequest('http://localhost/api/rankings?category=overall&mode=index'));
  const payload=await response.json();
  expect(payload.rankings[0].rank_change).toBeNull();
});

import { mergeAllSources } from '../src/lib/merge-models';
import { isValidCachedLeaderboard } from '../src/lib/leaderboard-cache-schema';
import { leaderboardCacheControl, snapshotExpired } from '../src/lib/trust';

test('a real merged payload survives validation; corrupt nested model fields do not', () => {
  const model=mergeAllSources([{source_id:'zeroeval',source_name:'Example',fetched_at:new Date().toISOString(),models:[{name:'Example 8B',params_b:8,license:'MIT',scores:{gpqa_diamond:80}}]}])[0];
  expect(isValidCachedLeaderboard({...data(),models:[model]})).toBe(true);
  for (const bad of [{...model,benchmarks:null},{...model,confidence:NaN},{...model,effort_variants:null},{...model,slug_aliases:[1]}]) {
    expect(isValidCachedLeaderboard({...data(),models:[bad]})).toBe(false);
  }
});

test('invalid, future, and expired snapshot times cannot keep an open tab fresh', () => {
  const now=Date.parse('2026-10-22T12:30:00Z');
  expect(snapshotExpired('2026-10-22T12:00:01Z',now)).toBe(false);
  for(const date of [null,'bad','2026-10-22T12:00:00Z','2026-10-22T12:30:01Z']) expect(snapshotExpired(date,now)).toBe(true);
  expect(leaderboardCacheControl({cacheAgeSeconds:0,dataSourceLabel:'live',snapshotDate:'2026-10-22T12:00:00Z'},now)).toBe('no-store');
  expect(leaderboardCacheControl({cacheAgeSeconds:0,dataSourceLabel:'live',snapshotDate:'2026-10-22T12:29:00Z'},now)).toContain('s-maxage=300');
});

test.each([NaN,Infinity,-1,Date.now()+60_000])('invalid shared writtenAt %s is rejected', async writtenAt => {
  setPersistenceForTests({get:async()=>({data:data(),scoringVersion:SCORING_VERSION,writtenAt,freshUntil:Date.now()+1800000,staleUntil:Date.now()+604800000})} as never);
  expect(await readSharedCache({allowStale:true})).toBeNull();
});

test('healthy compatible current and historical snapshots retain real movement', async () => {
  const date=new Date(Date.now()-7*86400000).toISOString().slice(0,10);
  const model=mergeAllSources([{source_id:'zeroeval',source_name:'Example',fetched_at:new Date().toISOString(),models:[{name:'Probe',params_b:8,license:'MIT',scores:{gpqa_diamond:80}}]}])[0];
  jest.mocked(getLeaderboardData).mockResolvedValue({data:{...data(),models:[{...model,rank_status:'ranked'}]},cacheStatus:'HIT',cacheAgeSeconds:0});
  setPersistenceForTests({zrange:async()=>[date],get:async()=>({date,updated:date,scoringVersion:SCORING_VERSION,quality:'live',ranks:{overall:{[model.slug]:20},categories:{}}})} as never);
  const payload=await (await rankingsGET(new NextRequest('http://localhost/api/rankings?category=overall&mode=index'))).json();
  expect(payload.rankings[0].rank_change).toBe(19);
  expect(payload.trendUnavailableReason).toBeNull();
});

test('future snapshot dates or unbounded stale lifetimes are rejected',async()=>{
  const now=Date.now();
  for(const entry of [
    {data:{...data(),updated:new Date(now+60000).toISOString()},staleUntil:now+604800000},
    {data:{...data(),updated:new Date(now).toISOString()},staleUntil:now+604800001},
  ]) {
    setPersistenceForTests({get:async()=>({scoringVersion:SCORING_VERSION,writtenAt:now,freshUntil:now+1800000,...entry})} as never);
    expect(await readSharedCache({allowStale:true})).toBeNull();
  }
});

import { setPersistenceForTests, writeSharedCache } from '../src/lib/store';
import { GET as scorecardGET } from '../src/app/api/models/[slug]/scorecard/route';
import { getLeaderboardData } from '../src/lib/leaderboard-service';
import { SCORING_VERSION } from '../src/lib/merge-models';

jest.mock('../src/lib/leaderboard-service',()=>({getLeaderboardData:jest.fn()}));
afterEach(()=>setPersistenceForTests(undefined));

test('an expired refresh owner cannot overwrite the newer shared snapshot', async()=>{
  const set=jest.fn().mockResolvedValue('OK');
  const evalMock=jest.fn().mockResolvedValue(0);
  setPersistenceForTests({set,eval:evalMock} as never);
  // Passing the stale token must fence the write, even if a process paused past its lease.
  const write=writeSharedCache as (data:Parameters<typeof writeSharedCache>[0],token:string)=>Promise<boolean>;
  expect(await write({models:[],sources:[],updated:new Date().toISOString(),scoringVersion:SCORING_VERSION},'expired-owner')).toBe(false);
  expect(set).not.toHaveBeenCalled();
});

test('scorecard infrastructure outage returns 503 rather than blaming request volume', async()=>{
  setPersistenceForTests(null);
  const response=await scorecardGET(new Request('http://localhost/api/models/probe/scorecard'),{params:Promise.resolve({slug:'probe'})});
  expect(response.status).toBe(503);
  expect(jest.mocked(getLeaderboardData)).toHaveBeenCalledTimes(1);
});

test('true scorecard budget exhaustion still returns 429', async()=>{
  setPersistenceForTests({set:async()=> 'OK',eval:async(script:string)=>script.startsWith('local v=')?[false,-2]:13} as never);
  const response=await scorecardGET(new Request('http://localhost/api/models/probe/scorecard'),{params:Promise.resolve({slug:'probe'})});
  expect(response.status).toBe(429);
});

import { scorecardClientKey } from '../src/lib/request-client';
import { clearScorecardCacheForTests, getCachedScorecard, setScorecardFetcherForTests } from '../src/lib/scorecard-cache';

const scorecard={model_id:'probe',name:'Probe',organization:null,release_date:null,params_b:8,license:'MIT',sources:{},benchmarks:[]};
beforeEach(()=>{jest.clearAllMocks();clearScorecardCacheForTests();jest.mocked(getLeaderboardData).mockResolvedValue({data:{models:[{name:'Probe',slug:'probe',llm_stats_model_id:'probe'}] as never,sources:[],updated:new Date().toISOString()},cacheStatus:'HIT',cacheAgeSeconds:0});});
afterEach(()=>clearScorecardCacheForTests());

test('unknown slugs do not spend the scorecard budget', async()=>{
  const evalMock=jest.fn();setPersistenceForTests({eval:evalMock} as never);
  for(let i=0;i<13;i++) expect((await scorecardGET(new Request('http://localhost'),{params:Promise.resolve({slug:'unknown'})})).status).toBe(404);
  expect(evalMock).not.toHaveBeenCalled();
});

test('shared and local scorecard hits remain available after a budget is exhausted', async()=>{
  const evalMock=jest.fn().mockImplementation(async(script:string)=>script.startsWith('local v=')?[{value:scorecard},890000]:13);
  setPersistenceForTests({eval:evalMock} as never);
  for(let i=0;i<15;i++) expect((await scorecardGET(new Request('http://localhost'),{params:Promise.resolve({slug:'probe'})})).status).toBe(200);
  expect(evalMock).toHaveBeenCalledTimes(1);
});

test('different platform-verified visitors have distinct digest keys; arbitrary forwarding headers are ignored',()=>{
  const previous={vercel:process.env.VERCEL,token:process.env.KV_REST_API_TOKEN,proxy:process.env.TRUSTED_PROXY_SECRET};
  try {
    delete process.env.TRUSTED_PROXY_SECRET;delete process.env.VERCEL;process.env.KV_REST_API_TOKEN='test-only-hmac-key';
    const request=(ip:string)=>new Request('http://localhost',{headers:{'x-vercel-forwarded-for':ip,'x-forwarded-for':ip}});
    expect(scorecardClientKey(request('192.0.2.1'))).toBe('public-unattributed');
    process.env.VERCEL='1';
    expect(scorecardClientKey(request('192.0.2.1'))).not.toBe(scorecardClientKey(request('192.0.2.2')));
    expect(scorecardClientKey(request('192.0.2.1'))).not.toContain('192.0.2.1');
    expect(scorecardClientKey(request('malformed'))).toBe('public-unattributed');
  } finally {
    for(const [key,value] of Object.entries({VERCEL:previous.vercel,KV_REST_API_TOKEN:previous.token,TRUSTED_PROXY_SECRET:previous.proxy})) {
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});

test('coalesced callers spend one upstream budget and start one fetch',async()=>{
  const values=new Map<string,unknown>();let consumed=0;
  setPersistenceForTests({set:async(key:string,value:unknown)=>{values.set(key,value);return 'OK';},eval:async(script:string,keys:string[],args:string[])=>{
    if(script.startsWith('local v='))return values.has(keys[0])?[values.get(keys[0]),890000]:[false,-2];
    if(script.includes('incr'))return ++consumed;
    if(keys.length===2){values.set(keys[1],JSON.parse(args[1]));return 1;}
    values.delete(keys[0]);return 1;
  }} as never);
  const fetcher=jest.fn(async()=>scorecard);setScorecardFetcherForTests(fetcher);
  await Promise.all([getCachedScorecard('probe','a'),getCachedScorecard('probe','b')]);
  expect(consumed).toBe(2);expect(fetcher).toHaveBeenCalledTimes(1);
});

test('distinct visitors cannot exceed the shared upstream ceiling; denial releases the lease', async()=>{
  const counts = new Map<string, number>();
  const releases: string[] = [];
  setPersistenceForTests({
    set: async()=> 'OK',
    eval: async(script:string,keys:string[])=>{
      if(script.startsWith('local v=')) return [false,-2];
      if(script.includes('incr')) {
        const count=(counts.get(keys[0]) ?? 0)+1;counts.set(keys[0],count);return count;
      }
      if(keys.length===2) return 1;
      releases.push(keys[0]);return 1;
    },
  } as never);
  const fetcher=jest.fn(async()=>null);setScorecardFetcherForTests(fetcher);
  for(let i=0;i<60;i++) await expect(getCachedScorecard(`model-${i}`,`client-${i}`)).resolves.toBeNull();
  await expect(getCachedScorecard('model-blocked','client-new')).rejects.toMatchObject({status:429});
  expect(fetcher).toHaveBeenCalledTimes(60);
  expect(releases).toHaveLength(61);
  expect(releases.at(-1)).toContain('model-blocked');
});

test('a global budget outage fails closed before any upstream request', async()=>{
  setPersistenceForTests({
    set:async()=> 'OK',
    eval:async(script:string,keys:string[])=>{
      if(script.startsWith('local v='))return [false,-2];
      if(keys[0].endsWith('upstream-global'))throw new Error('global budget unavailable');
      return 1;
    },
  } as never);
  const fetcher=jest.fn(async()=>null);setScorecardFetcherForTests(fetcher);
  await expect(getCachedScorecard('probe','client')).rejects.toMatchObject({status:503});
  expect(fetcher).not.toHaveBeenCalled();
});

test('the current refresh owner can publish a cache generation',async()=>{
  let published:unknown;
  setPersistenceForTests({eval:async(_script:string,_keys:string[],args:string[])=>{
    if(args[0]!=='current-owner')return 0;
    published=JSON.parse(args[1]);return 1;
  }} as never);
  expect(await writeSharedCache({models:[],sources:[],updated:new Date().toISOString(),scoringVersion:SCORING_VERSION},'current-owner')).toBe(true);
  expect(published).toEqual(expect.objectContaining({scoringVersion:SCORING_VERSION,writtenAt:expect.any(Number)}));
});

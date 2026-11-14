import { clearLeaderboardCache, getLeaderboardData } from '../src/lib/leaderboard-service';
import { setPersistenceForTests } from '../src/lib/store';
import { SCORING_VERSION } from '../src/lib/merge-models';

afterEach(() => { clearLeaderboardCache(); setPersistenceForTests(undefined); });

test('all callers joining a failed force-refresh receive the same last-good snapshot', async () => {
  const now=Date.now();
  const cached={data:{models:[],sources:[],updated:new Date(now).toISOString(),scoringVersion:SCORING_VERSION,dataSourceLabel:'live'},writtenAt:now,freshUntil:now+1800000,staleUntil:now+604800000,scoringVersion:SCORING_VERSION};
  let resolveLock!: (value:null)=>void;
  let primed=false;
  setPersistenceForTests({get:async()=>primed?null:cached,set:()=>new Promise(resolve=>{resolveLock=resolve;})} as never);
  await getLeaderboardData();
  primed=true;
  const first=getLeaderboardData({forceRefresh:true});
  const second=getLeaderboardData({forceRefresh:true});
  resolveLock(null);
  const [a,b]=await Promise.all([first,second]);
  expect(a.cacheStatus).toBe('ERROR-STALE');
  expect(b.cacheStatus).toBe('ERROR-STALE');
  expect(b.data.updated).toBe(a.data.updated);
});

import { liveBench2Edition, liveBench2Run, parseLiveBench2 } from '../src/lib/livebench-v2';
import { mergeAllSources } from '../src/lib/merge-models';
import { buildBenchmarkRankings } from '../src/lib/benchmark-comparisons';
import type { SourceModel } from '../src/lib/live-sources';

const columns = 'model,long_agentic,reasoning,coding,browser,data_analysis,research,design';
const config = {
  'Long Agentic': ['long_agentic'], Reasoning: ['reasoning'], Coding: ['coding'], Browser: ['browser'],
  'Data Analysis': ['data_analysis'], Research: ['research'], Design: ['design'],
  _overall_weights: { 'Long Agentic': 2, Coding: 1.5, Design: 1.5 },
};
// Public evaluator rows and edition weights: https://livebench.ai/data/20261106/table.csv
const fable = 'claude-fable-5.2,82.9,88.8,79.2,86.9,81.5,94.5,85.1';
const astra = 'gpt-6-astra,75.6,92.7,87.5,91.3,83.0,90.6,80.0';

test('v2 release discovery advances independently of the archive and rejects ambiguous manifests', () => {
  expect(liveBench2Edition('old=["2026-06-25"];v2=["20261025","20261106"]')).toBe('20261106');
  expect(liveBench2Edition('editions=["20261106","20261120"]')).toBe('20261120');
  expect(() => liveBench2Edition('v1=["2026-06-25"]')).toThrow();
  expect(() => liveBench2Edition('a=["20261106"];b=["20261109"]')).toThrow();
  expect(() => liveBench2Edition('a=["20260231"]')).toThrow();
});

test('the edition weights reproduce the evaluator; zero is measured, incomplete runs cannot win', () => {
  const [a,b,partial,zero] = parseLiveBench2([columns,fable,astra,'partial,100,100,100,100,100,100,','zero,0,0,0,0,0,0,0'].join('\n'),config);
  expect([a.scores.livebench2_overall,b.scores.livebench2_overall]).toEqual([84.88,84.45]);
  expect(partial.scores).toMatchObject({livebench2_coding:100, livebench2_overall:null,livebench2_design:null});
  expect(zero.scores.livebench2_overall).toBe(0);
  expect(() => parseLiveBench2([columns,fable,fable].join('\n'),config)).toThrow();
  expect(() => parseLiveBench2(columns+'\n'+fable,{...config, Unknown:['other']})).toThrow();
  expect(() => parseLiveBench2(columns+'\n'+fable,{...config, _overall_weights:{Coding:0}})).toThrow();
});

test('v2 uses exact run identities, separate effort receipts and no v1 or index imputation', () => {
  const bundle = '"claude-fable-5.2":{displayName:"Fable",organization:"Anthropic",effort:"xhigh"}';
  const [a,b] = parseLiveBench2([columns,fable,astra].join('\n'),config);
  const source=(id:string,models:SourceModel[])=>({source_id:id,source_name:id,models,fetched_at:'2026-11-14',data_date:id==='livebench2'?'2026-11-06':'2026-06-25'});
  const catalog=source('zeroeval',[
    {name:'Claude Fable 5.2',llm_stats_model_id:'claude-fable-5-2',scores:{swe_bench_pro:93}},
    {name:'GPT-6 Astra (High)',scores:{arena_elo:1400}},
    {name:'Claude Fable 5.1',scores:{}},
  ]);
  const v1=source('livebench',[{name:'Claude Fable 5.1',scores:{livebench_global:83.42}}]);
  const prior=mergeAllSources([catalog,v1]);
  const ms=mergeAllSources([catalog,v1,source('livebench2',[{...a,...liveBench2Run(bundle,a.name)},b])]);
  const ranked=buildBenchmarkRankings(ms,'overall').rankings;
  expect(ranked.slice(0,2).map(m=>[m.name,m.score,m.rank])).toEqual([['Claude Fable 5.2',84.88,1],['gpt-6-astra',84.45,2]]);
  expect(ranked.find(m=>m.name==='GPT-6 Astra (High)')?.rank).toBeNull();
  const f=ms.find(m=>m.slug==='claude-fable-5-2')!;
  expect(f.benchmark_sources.livebench2_overall[0]).toMatchObject({model_name:a.name,effort:'xhigh',data_date:'2026-11-06'});
  expect(f.best_effort).toBeNull();
  expect(f.composite_score).toBe(prior.find(m=>m.slug===f.slug)!.composite_score);
  expect(buildBenchmarkRankings(ms,'overall',{benchmark:'livebench_global'}).rankings[0].name).toBe('Claude Fable 5.1');
});

test('punctuation-colliding evaluator IDs retain both runs instead of overwriting a catalog result', () => {
  const models = mergeAllSources([
    {source_id:'zeroeval',source_name:'Catalog',fetched_at:'2026-11-14',models:[{name:'Lab 1.2',llm_stats_model_id:'lab-1-2',scores:{arena_elo:1300}}]},
    {source_id:'livebench2',source_name:'LiveBench 2.0',fetched_at:'2026-11-14',data_date:'2026-11-06',models:[
      {name:'lab-1.2',scores:{livebench2_overall:77}},{name:'lab-1-2',scores:{livebench2_overall:90}},
    ]},
  ]);
  const r = buildBenchmarkRankings(models,'overall').rankings;
  expect(r.map(m=>[m.slug,m.score])).toEqual([['livebench2-lab-1-2',90],['livebench2-lab-1.2',77],['lab-1-2',null]]);
});

import path from 'node:path';
import { fetchZeroEval } from '../src/lib/live-sources';
import { mergeAllSources } from '../src/lib/merge-models';
import { safeScorecardLink, scorecardFromApiResponse } from '../src/lib/scorecard-response';
import { isValidScorecard } from '../src/lib/store';

// The validator is an intentionally standalone CommonJS CLI so CI can execute
// it directly; Jest consumes its exact exported production guard here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { hasCredentialedAiPrReview, validateWorkflowDirectory } = require('../scripts/validate-workflow-tombstones.cjs') as {
  hasCredentialedAiPrReview(content: string): boolean;
  validateWorkflowDirectory(workflowDirectory: string): string[];
};

describe('P3 scorecard presentation boundaries', () => {
  const scorecard = {
    model_id: 'safe-model', name: 'Safe model', organization: null, release_date: null,
    params_b: null, license: null, sources: {}, benchmarks: [],
  };

  it('unwraps only the documented available scorecard envelope', () => {
    expect(scorecardFromApiResponse({ available: true, slug: 'safe-model', scorecard })).toEqual(scorecard);
    expect(scorecardFromApiResponse({ available: false, reason: 'upstream unavailable' })).toBeNull();
    expect(scorecardFromApiResponse({ available: true, scorecard: {} })).toBeNull();
  });

  it.each([
    { ...scorecard, benchmarks: [{}] },
    { ...scorecard, sources: { api_ref: 1 } },
    { ...scorecard, benchmarks: [{ benchmark_id: 'gpqa', name: 'GPQA', description: null, categories: ['science', 1], modality: null, max_score: 1, score: 0.75, normalized_score: 0.75, verified: true, self_reported: false, source_url: null, analysis_method: null }] },
    { ...scorecard, benchmarks: [{ benchmark_id: 'gpqa', name: 'GPQA', description: null, categories: ['science'], modality: null, max_score: 1, score: '0.75', normalized_score: 0.75, verified: true, self_reported: false, source_url: null, analysis_method: null }] },
  ])('treats malformed nested scorecard data as unavailable', (malformedScorecard) => {
    expect(scorecardFromApiResponse({ available: true, scorecard: malformedScorecard })).toBeNull();
  });

  it('uses the same exported cache validator as the browser response boundary', () => {
    expect(isValidScorecard(scorecard)).toBe(true);
    expect(isValidScorecard({ ...scorecard, benchmarks: [{}] })).toBe(false);
  });

  it('allows only HTTPS third-party scorecard links', () => {
    expect(safeScorecardLink('https://example.test/model')).toBe('https://example.test/model');
    for (const unsafe of ['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/x', '//example.test', 'https://user:pass@example.test/']) {
      expect(safeScorecardLink(unsafe)).toBeNull();
    }
  });
});

describe('P3 refresh and model integrity boundaries', () => {
  afterEach(() => jest.restoreAllMocks());

  it('does not sleep through a caller deadline after a hostile Retry-After', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('deadline', 'AbortError'));
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 429, headers: { 'retry-after': '86400' } }));
    await expect(fetchZeroEval({ signal: controller.signal })).resolves.toMatchObject({ models: [], error: expect.any(String) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects one malformed source name without losing valid records', () => {
    const merged = mergeAllSources([{ source_id: 'zeroeval', source_name: 'ZeroEval', fetched_at: '2026-01-01T00:00:00Z', models: [
      { name: { poisoned: true }, scores: { gpqa_diamond: 99 } },
      { name: 'Valid model', scores: { gpqa_diamond: 90 } },
    ] as never }]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.name).toBe('Valid model');
  });

  it('keeps distinct stable upstream identities separate despite a shared display name', () => {
    const merged = mergeAllSources([{ source_id: 'zeroeval', source_name: 'ZeroEval', fetched_at: '2026-01-01T00:00:00Z', models: [
      { name: 'Reused display name', llm_stats_model_id: 'model-a', scores: { gpqa_diamond: 90 } },
      { name: 'Reused display name', llm_stats_model_id: 'model-b', scores: { gpqa_diamond: 80 } },
    ] }]);
    expect(merged.map((model) => model.llm_stats_model_id).sort()).toEqual(['model-a', 'model-b']);
  });

  it('does not attach a name-only score to either side of an ambiguous stable-ID alias', () => {
    const merged = mergeAllSources([
      { source_id: 'zeroeval', source_name: 'ZeroEval', fetched_at: '2026-01-01T00:00:00Z', models: [
        { name: 'Reused display name', llm_stats_model_id: 'model-a', scores: { gpqa_diamond: 90 } },
        { name: 'Reused display name', llm_stats_model_id: 'model-b', scores: { gpqa_diamond: 80 } },
      ] },
      { source_id: 'livebench', source_name: 'LiveBench', fetched_at: '2026-01-01T00:00:00Z', models: [
        { name: 'Reused display name', scores: { livebench_global: 75 } },
      ] },
    ]);
    expect(merged.every((model) => model.benchmarks.livebench_global === null)).toBe(true);
  });

  it('joins an unambiguous name-only primary record to its stable upstream identity', () => {
    const merged = mergeAllSources([
      { source_id: 'zeroeval', source_name: 'ZeroEval', fetched_at: '2026-01-01T00:00:00Z', models: [
        { name: 'Model Prime', llm_stats_model_id: 'model-prime', scores: { gpqa_diamond: 90 } },
      ] },
      { source_id: 'lmarena', source_name: 'LMArena', fetched_at: '2026-01-01T00:00:00Z', models: [
        { name: 'Model Prime', scores: { arena_elo: 1500 } },
      ] },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ llm_stats_model_id: 'model-prime', benchmarks: { gpqa_diamond: 90, arena_elo: 1500 } });
  });

  it('keeps an ambiguous name-only primary record separate from both stable identities', () => {
    const merged = mergeAllSources([
      { source_id: 'zeroeval', source_name: 'ZeroEval', fetched_at: '2026-01-01T00:00:00Z', models: [
        { name: 'Reused display name', llm_stats_model_id: 'model-a', scores: { gpqa_diamond: 90 } },
        { name: 'Reused display name', llm_stats_model_id: 'model-b', scores: { gpqa_diamond: 80 } },
      ] },
      { source_id: 'lmarena', source_name: 'LMArena', fetched_at: '2026-01-01T00:00:00Z', models: [
        { name: 'Reused display name', scores: { arena_elo: 1500 } },
      ] },
    ]);
    expect(merged).toHaveLength(3);
    expect(merged.filter((model) => model.llm_stats_model_id === null)).toEqual([
      expect.objectContaining({ benchmarks: expect.objectContaining({ arena_elo: 1500 }) }),
    ]);
  });
});

describe('P3 credentialed PR-agent tombstone', () => {
  it('rejects semantic YAML trigger, AI capability, and credential bypasses', () => {
    const mappingTriggerMarketplaceAction = `
on:
  pull_request:
jobs:
  review:
    permissions:
      pull-requests: write
    steps:
      - uses: anthropics/claude-code-action@deadbeef
`;
    const inlineTriggerShellCli = `
on: [workflow_dispatch, pull_request_target]
jobs:
  review:
    steps:
      - run: npx @openai/codex exec --full-auto review
        env:
          ANY_VALUE: \${{ secrets.ANY_VALUE }}
`;
    const geminiWithGenericCredential = `
on: pull_request
jobs:
  review:
    steps:
      - uses: google-github-actions/run-gemini-cli@deadbeef
        with:
          github-token: \${{ secrets.GITHUB_TOKEN }}
`;
    const directRunSecretDotSyntax = `
on: pull_request
jobs:
  review:
    steps:
      - run: claude review --token "\${{ secrets.REVIEW_TOKEN }}"
`;
    const directRunSecretBracketSyntax = `
on: [pull_request_target]
jobs:
  review:
    steps:
      - run: codex exec --token "\${{ secrets['REVIEW_TOKEN'] }}"
`;
    const reusableWorkflowSecretsInherit = `
on:
  pull_request:
jobs:
  review:
    uses: example/private-ai-review/.github/workflows/review.yml@deadbeef
    secrets: inherit
`;
    const reusableWorkflowSecretsMapping = `
on: [pull_request]
jobs:
  review:
    uses: example/private-ai-review/.github/workflows/review.yml@deadbeef
    secrets:
      REVIEW_TOKEN: \${{ secrets.REVIEW_TOKEN }}
`;
    const benignPullRequestWorkflow = `
on: [pull_request, workflow_dispatch]
jobs:
  test:
    steps:
      - uses: actions/checkout@deadbeef
      - run: npm test
`;

    expect(hasCredentialedAiPrReview(mappingTriggerMarketplaceAction)).toBe(true);
    expect(hasCredentialedAiPrReview(inlineTriggerShellCli)).toBe(true);
    expect(hasCredentialedAiPrReview(geminiWithGenericCredential)).toBe(true);
    expect(hasCredentialedAiPrReview(directRunSecretDotSyntax)).toBe(true);
    expect(hasCredentialedAiPrReview(directRunSecretBracketSyntax)).toBe(true);
    expect(hasCredentialedAiPrReview(reusableWorkflowSecretsInherit)).toBe(true);
    expect(hasCredentialedAiPrReview(reusableWorkflowSecretsMapping)).toBe(true);
    expect(hasCredentialedAiPrReview(benignPullRequestWorkflow)).toBe(false);
  });

  it('allows near-misses that lack one required forbidden capability', () => {
    const prAndAiOnly = `
on: pull_request
jobs:
  review:
    steps:
      - run: gemini review
`;
    const prAndCredentialOnly = `
on: pull_request
jobs:
  metadata:
    permissions: read-all
    steps:
      - run: echo "\${{ secrets.METADATA_TOKEN }}"
`;
    const aiAndCredentialOnly = `
on: workflow_dispatch
jobs:
  review:
    steps:
      - run: npx @openai/codex exec review
        env:
          API_TOKEN: \${{ secrets.API_TOKEN }}
`;

    expect(hasCredentialedAiPrReview(prAndAiOnly)).toBe(false);
    expect(hasCredentialedAiPrReview(prAndCredentialOnly)).toBe(false);
    expect(hasCredentialedAiPrReview(aiAndCredentialOnly)).toBe(false);
  });

  it('distinguishes credential authority from similarly named non-credentials', () => {
    const maxTokensOnly = `
on: pull_request
jobs:
  review:
    steps:
      - run: gemini review
        env:
          MAX_TOKENS: 4096
`;
    const tokenCountOnly = `
on: pull_request
jobs:
  review:
    steps:
      - run: codex exec review
        with:
          TOKEN_COUNT: 3
`;
    const noIdTokenAuthority = `
on: pull_request
permissions:
  id-token: none
jobs:
  review:
    steps:
      - run: claude review
`;
    const emptySecretsMapping = `
on: [pull_request]
jobs:
  review:
    uses: example/private-ai-review/.github/workflows/review.yml@deadbeef
    secrets: {}
`;
    const actualApiToken = `
on: pull_request
jobs:
  review:
    steps:
      - run: npx @openai/codex exec review
        env:
          API_TOKEN: actual-nonempty-token
`;
    const reviewCredential = `
on: pull_request
jobs:
  review:
    steps:
      - run: claude review
        env:
          REVIEW_CREDENTIAL: nonempty-review-credential
`;
    const googleCredentials = `
on: pull_request
jobs:
  review:
    steps:
      - run: gemini review
        with:
          GOOGLE_CREDENTIALS: nonempty-google-credentials
`;
    const emptyReviewCredential = `
on: pull_request
jobs:
  review:
    steps:
      - run: claude review
        env:
          REVIEW_CREDENTIAL: ""
`;
    const emptyGoogleCredentials = `
on: pull_request
jobs:
  review:
    steps:
      - run: gemini review
        with:
          GOOGLE_CREDENTIALS: ""
`;

    expect(hasCredentialedAiPrReview(maxTokensOnly)).toBe(false);
    expect(hasCredentialedAiPrReview(tokenCountOnly)).toBe(false);
    expect(hasCredentialedAiPrReview(noIdTokenAuthority)).toBe(false);
    expect(hasCredentialedAiPrReview(emptySecretsMapping)).toBe(false);
    expect(hasCredentialedAiPrReview(actualApiToken)).toBe(true);
    expect(hasCredentialedAiPrReview(reviewCredential)).toBe(true);
    expect(hasCredentialedAiPrReview(googleCredentials)).toBe(true);
    expect(hasCredentialedAiPrReview(emptyReviewCredential)).toBe(false);
    expect(hasCredentialedAiPrReview(emptyGoogleCredentials)).toBe(false);
  });

  it('keeps credentialed model-review workflows absent until a hardened tool boundary is reviewed', () => {
    const workflowDirectory = path.join(process.cwd(), '.github', 'workflows');
    expect(validateWorkflowDirectory(workflowDirectory)).toEqual([]);
  });
});

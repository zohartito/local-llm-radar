import { readFileSync } from 'node:fs';
import path from 'node:path';

test('RAD-03: development serving defaults to the loopback interface', () => {
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  expect(pkg.scripts.dev).toMatch(/^next dev --hostname 127\.0\.0\.1$/);
});

test('RAD-15: CI limits token authority and does not persist checkout credentials', () => {
  // js-yaml is a declared development dependency; parse the actual workflow.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const yaml = require('js-yaml');
  const workflow = yaml.load(readFileSync(path.join(process.cwd(), '.github/workflows/ci.yml'), 'utf8'));
  expect(workflow.permissions).toEqual({ contents: 'read' });
  for (const job of Object.values(workflow.jobs) as { permissions?: unknown; steps: { uses?: string; with?: Record<string, unknown> }[] }[]) {
    if (job.permissions) expect(job.permissions).toEqual({ contents: 'read' });
    const checkouts = job.steps.filter(step => step.uses?.startsWith('actions/checkout@'));
    expect(checkouts.length).toBeGreaterThan(0);
    for (const step of checkouts) expect(step.with?.['persist-credentials']).toBe(false);
  }
});

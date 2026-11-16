import { readFileSync } from 'node:fs';
import path from 'node:path';

test('RAD-03: development serving defaults to the loopback interface', () => {
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  expect(pkg.scripts.dev).toMatch(/^next dev --hostname 127\.0\.0\.1$/);
});

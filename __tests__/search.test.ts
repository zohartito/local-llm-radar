import { matchesSearchQuery, normalizeSearchText } from '../src/lib/search';

describe('search helpers', () => {
  test('normalizes mixed punctuation model names into searchable tokens', () => {
    expect(normalizeSearchText('Qwen3.5-35B-A3B')).toBe('qwen 3 5 35 b a 3 b');
  });

  test('matches natural spacing against hyphenated model ids', () => {
    expect(
      matchesSearchQuery(
        'qwen 3.5 35b a3b',
        'Qwen3.5-35B-A3B',
        'qwen3-5-35b-a3b',
        'qwen3.5-35b-a3b'
      )
    ).toBe(true);
  });

  test('does not invent nonexistent mixed-version models', () => {
    expect(
      matchesSearchQuery(
        'qwen 3.6 35b a3b',
        'Qwen3.5-35B-A3B',
        'qwen3-5-35b-a3b',
        'qwen3.5-35b-a3b'
      )
    ).toBe(false);
  });
});

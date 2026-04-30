import { describe, expect, it } from 'vitest';
import { resultsToCsv } from './results';
import type { FitRunResult } from '$lib/fit/types';

describe('resultsToCsv', () => {
  it('escapes quotes and joins array fields', () => {
    const result: FitRunResult = {
      generatedAt: '2026-04-29T00:00:00.000Z',
      warnings: [],
      searchAttempts: [],
      totals: { discovered: 1, evaluated: 1, searchAttempts: 0 },
      candidates: [
        {
          userId: 'usr_1',
          source: 'profile_search',
          sourceLabel: 'Profile search',
          name: 'A "Builder"',
          avatar: null,
          country: 'US',
          verifiedLevel: 1,
          bioSnippet: '',
          topCareer: null,
          desiredRoles: [],
          recruitingSummary: null,
          detail: null,
          profileUrl: 'https://markidy.com/profile/usr_1',
          evaluation: {
            summary: 'Strong product builder.',
            fitScore: 92,
            recommendation: 'strong_fit',
            objectiveMatches: ['TypeScript', 'Remote'],
            objectiveMisses: [],
            fitReasons: ['Shipped products'],
            risks: []
          }
        }
      ]
    };

    const csv = resultsToCsv(result);

    expect(csv).toContain('"A ""Builder"""');
    expect(csv).toContain('"TypeScript; Remote"');
  });
});

import { describe, expect, it } from 'vitest';
import { buildFallbackSearchAttempts } from './search-planner';
import type { HiringWorkflow } from '$lib/fit/types';

const workflow: HiringWorkflow = {
  company: {
    roleSummary:
      'Find a full-stack engineer or backend engineer to build customer-facing product features, APIs, and integrations.',
    idealCandidate: ''
  },
  objective: {
    minExperienceYears: 3,
    roles: [],
    skills: ['TypeScript', 'Svelte', 'Node.js'],
    countries: ['US'],
    workModes: ['remote'],
    locations: ['New York']
  },
  search: {
    maxCandidates: 8,
    searchAttemptsLimit: 6
  }
};

describe('buildFallbackSearchAttempts', () => {
  it('creates strict-to-broad Markidy search attempts', () => {
    const attempts = buildFallbackSearchAttempts(workflow);

    expect(attempts.length).toBeGreaterThan(2);
    expect(attempts.length).toBeLessThanOrEqual(6);
    expect(attempts[0].countries).toEqual(['US']);
    expect(attempts[0].workModes).toEqual(['remote']);
    expect(attempts[0].minExperienceMonths).toBe(36);
    expect(attempts.some((attempt) => attempt.countries.length === 0)).toBe(true);
    expect(attempts.some((attempt) => attempt.minExperienceMonths === null)).toBe(true);
  });

  it('adds common role synonyms to fallback query text', () => {
    const attempts = buildFallbackSearchAttempts(workflow);
    const queryText = attempts.map((attempt) => attempt.q || '').join(' ').toLowerCase();
    const synonymAttempt = attempts.find((attempt) => attempt.label === 'Role synonym search');

    expect(queryText).toContain('developer');
    expect(queryText).toContain('software developer');
    expect(queryText).toContain('customer-facing product features');
    expect(synonymAttempt?.q?.toLowerCase()).toContain('full-stack developer');
    expect(synonymAttempt?.q?.toLowerCase()).toContain('backend developer');
    expect(synonymAttempt?.roles).toEqual([]);
  });
});

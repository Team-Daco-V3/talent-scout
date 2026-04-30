import { describe, expect, it } from 'vitest';
import { buildCandidateProfile, evaluateObjectiveFit } from './objective';
import type { HiringWorkflow } from './types';

const workflow: HiringWorkflow = {
  company: {
    roleSummary: 'Build product features.',
    idealCandidate: 'Ships real products.'
  },
  objective: {
    minExperienceYears: 3,
    roles: ['full-stack engineer'],
    skills: ['TypeScript'],
    countries: ['US'],
    workModes: ['remote'],
    locations: []
  },
  search: {
    maxCandidates: 8,
    searchAttemptsLimit: 6
  }
};

describe('evaluateObjectiveFit', () => {
  it('recognizes profile signals that match required hiring filters', () => {
    const candidate = buildCandidateProfile({
      userId: 'usr_1',
      name: 'Jane',
      country: 'US',
      bioSnippet: 'Full-stack engineer using TypeScript and Svelte.',
      desiredRoles: ['Full-stack Engineer'],
      recruitingSummary: {
        careerTotalMonths: 60,
        workMode: 'remote'
      }
    }, null);

    const result = evaluateObjectiveFit(workflow, candidate);

    expect(result.misses).toHaveLength(0);
    expect(result.matches.join(' ').toLowerCase()).toContain('experience');
    expect(result.score).toBeGreaterThanOrEqual(90);
  });

  it('records objective misses without hiding the candidate', () => {
    const candidate = buildCandidateProfile({
      userId: 'usr_2',
      name: 'Sam',
      country: 'GB',
      bioSnippet: 'Designer.',
      recruitingSummary: {
        careerTotalMonths: 12,
        workMode: 'onsite'
      }
    }, null);

    const result = evaluateObjectiveFit(workflow, candidate);

    expect(result.misses.length).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(80);
  });
});

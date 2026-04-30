import { describe, expect, it } from 'vitest';
import { fallbackEvaluateCandidate } from './ai';
import type { CandidateProfile, HiringWorkflow, ObjectiveAssessment } from '$lib/fit/types';

const workflow: HiringWorkflow = {
  company: {
    roleSummary: 'Find a full-stack engineer for product features, APIs, and integrations.',
    idealCandidate: ''
  },
  objective: {
    minExperienceYears: null,
    roles: [],
    skills: ['TypeScript'],
    countries: [],
    workModes: [],
    locations: []
  },
  search: {
    maxCandidates: 8,
    searchAttemptsLimit: 6
  }
};

const candidate: CandidateProfile = {
  userId: 'usr_1',
  source: 'profile_search',
  sourceLabel: 'Profile search',
  name: 'Yvonne Price',
  avatar: null,
  country: 'US',
  verifiedLevel: 2,
  bioSnippet: 'Learning and Development Manager with strong training and enablement experience.',
  topCareer: null,
  desiredRoles: ['Learning and Development Manager'],
  recruitingSummary: null,
  detail: null,
  profileUrl: 'https://markidy.com/profile/usr_1'
};

describe('fallbackEvaluateCandidate', () => {
  it('writes summaries with the concern first and strength last', () => {
    const objective: ObjectiveAssessment = {
      score: 40,
      matches: ['Experience meets the target range.'],
      misses: ['No clear full-stack development signal.']
    };

    const evaluation = fallbackEvaluateCandidate(workflow, candidate, objective);

    expect(evaluation.summary).toContain('No clear full-stack development signal.');
    expect(evaluation.summary).toContain('However, Experience meets the target range.');
    expect(evaluation.summary.indexOf('No clear full-stack development signal.')).toBeLessThan(
      evaluation.summary.indexOf('However, Experience meets the target range.')
    );
  });
});

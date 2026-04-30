import { describe, expect, it } from 'vitest';
import {
  createScout,
  deleteScout,
  duplicateScout,
  mergeScoutCandidates,
  migrateLegacyScout,
  queueScoutRuns,
  startableScoutIds
} from './state';
import type { EvaluatedCandidate } from '$lib/fit/types';
import type { ScoutState } from './types';

function candidate(userId: string, score: number): EvaluatedCandidate {
  return {
    userId,
    source: 'profile_search',
    sourceLabel: 'Profile search',
    name: `Candidate ${userId}`,
    avatar: null,
    country: 'US',
    verifiedLevel: 1,
    bioSnippet: '',
    topCareer: null,
    desiredRoles: [],
    recruitingSummary: null,
    detail: null,
    profileUrl: `https://markidy.com/profile/${userId}`,
    evaluation: {
      summary: '',
      fitScore: score,
      recommendation: score >= 85 ? 'strong_fit' : score >= 65 ? 'possible_fit' : 'weak_fit',
      objectiveMatches: [],
      objectiveMisses: [],
      fitReasons: [],
      risks: []
    }
  };
}

function completedScout(id: string, name: string, candidates: EvaluatedCandidate[]): ScoutState {
  return createScout(id, 1, {
    name,
    roleSummary: 'Find a product engineer.',
    status: 'done',
    result: {
      generatedAt: '2026-04-30T00:00:00.000Z',
      candidates,
      searchAttempts: [],
      totals: { discovered: candidates.length, evaluated: candidates.length, searchAttempts: 0 },
      warnings: []
    },
    totals: { discovered: candidates.length, evaluated: candidates.length, searchAttempts: 0 }
  });
}

describe('scout state helpers', () => {
  it('creates, duplicates, and deletes scouts without carrying run state into copies', () => {
    const scout = createScout('scout-1', 1, {
      roleSummary: 'Find a frontend engineer.',
      status: 'done',
      candidateRows: [{ ...candidate('usr_1', 90), evaluationStatus: 'evaluated', order: 0 }]
    });
    const copy = duplicateScout(scout, 'scout-2');

    expect(scout.status).toBe('done');
    expect(copy.name).toBe('Scout 1 copy');
    expect(copy.status).toBe('ready');
    expect(copy.candidateRows).toHaveLength(0);
    expect(deleteScout([scout, copy], scout.id).map((item) => item.id)).toEqual(['scout-2']);
    expect(deleteScout([copy], copy.id)).toHaveLength(1);
  });

  it('creates stable copy names without repeating copy suffixes', () => {
    const scout = createScout('scout-1', 1, {
      name: 'Backend Scout copy',
      roleSummary: 'Find a backend engineer.'
    });
    const copy = duplicateScout(scout, 'scout-2', ['Backend Scout', 'Backend Scout copy']);
    const secondCopy = duplicateScout(scout, 'scout-3', ['Backend Scout', 'Backend Scout copy', copy.name]);

    expect(copy.name).toBe('Backend Scout copy 2');
    expect(secondCopy.name).toBe('Backend Scout copy 3');
  });

  it('migrates the old single workflow into one scout', () => {
    const migrated = migrateLegacyScout('scout-1', {
      company: {
        roleSummary: 'Find a full-stack engineer.',
        idealCandidate: 'Ships products.'
      },
      objective: {
        skills: ['TypeScript', 'Svelte'],
        countries: ['US', 'GB'],
        workModes: ['remote']
      },
      search: {
        maxCandidates: 25,
        searchAttemptsLimit: 9
      }
    });

    expect(migrated?.name).toBe('Scout 1');
    expect(migrated?.status).toBe('ready');
    expect(migrated?.skills).toBe('TypeScript, Svelte');
    expect(migrated?.countries).toEqual(['US', 'GB']);
    expect(migrated?.workModes).toEqual(['remote']);
    expect(migrated?.maxCandidates).toBe(25);
    expect(migrated?.searchAttemptsLimit).toBe(9);
  });

  it('queues scout runs with a default concurrency cap', () => {
    const scouts = [
      createScout('a', 1, { roleSummary: 'A' }),
      createScout('b', 2, { roleSummary: 'B' }),
      createScout('c', 3, { roleSummary: 'C' })
    ];
    const queued = queueScoutRuns(scouts, scouts.map((scout) => scout.id), 2);

    expect(queued.startIds).toEqual(['a', 'b']);
    expect(queued.scouts.map((scout) => scout.status)).toEqual(['running', 'running', 'queued']);
    expect(startableScoutIds([{ ...queued.scouts[0], status: 'done' }, queued.scouts[1], queued.scouts[2]], 2)).toEqual([
      'c'
    ]);
  });

  it('merges report candidates by userId and keeps scout-specific scores', () => {
    const scouts = [
      completedScout('frontend', 'Frontend Scout', [candidate('usr_1', 72), candidate('usr_2', 88)]),
      completedScout('backend', 'Backend Scout', [candidate('usr_1', 91)])
    ];
    const merged = mergeScoutCandidates(scouts);

    expect(merged).toHaveLength(2);
    expect(merged[0].userId).toBe('usr_1');
    expect(merged[0].bestScore).toBe(91);
    expect(merged[0].matchedScouts.map((scout) => scout.scoutName)).toEqual(['Backend Scout', 'Frontend Scout']);
  });
});

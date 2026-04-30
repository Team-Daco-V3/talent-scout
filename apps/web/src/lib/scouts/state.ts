import { isWorkMode, type WorkMode } from '$lib/fit/options';
import type {
  EvaluatedCandidate,
  FitRunResult,
  HiringWorkflow
} from '$lib/fit/types';
import type {
  CandidateRow,
  MergedCandidate,
  ScoutCredentials,
  ScoutRunRequest,
  ScoutState,
  ScoutStatus
} from './types';

export const emptyScoutTotals = {
  discovered: 0,
  evaluated: 0,
  searchAttempts: 0
};

export function listFromText(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function storedStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  if (typeof value === 'string') return listFromText(value);
  return [];
}

export function storedWorkModes(value: unknown): WorkMode[] {
  const values = storedStringList(value)
    .map((item) => item.toLowerCase())
    .filter(isWorkMode);
  return values.length ? [...new Set(values)] : [];
}

export function createScout(id: string, index = 1, input: Partial<ScoutState> = {}): ScoutState {
  const roleSummary = input.roleSummary ?? '';
  return {
    id,
    name: input.name || `Scout ${index}`,
    status: input.status ?? (roleSummary.trim() ? 'ready' : 'draft'),
    roleSummary,
    idealCandidate: input.idealCandidate ?? '',
    minExperienceYears: input.minExperienceYears ?? 0,
    skills: input.skills ?? '',
    countries: input.countries ?? [],
    workModes: input.workModes ?? [],
    locations: input.locations ?? '',
    maxCandidates: input.maxCandidates ?? 8,
    searchAttemptsLimit: input.searchAttemptsLimit ?? 6,
    phase: input.phase ?? '',
    generatedAt: input.generatedAt ?? '',
    candidateRows: input.candidateRows ?? [],
    searchAttempts: input.searchAttempts ?? [],
    warnings: input.warnings ?? [],
    errorMessage: input.errorMessage ?? '',
    result: input.result ?? null,
    totals: input.totals ?? { ...emptyScoutTotals }
  };
}

export function normalizeScoutStatus(scout: ScoutState): ScoutState {
  if (scout.status === 'running' || scout.status === 'queued') return scout;
  if (scout.status === 'done' || scout.status === 'failed' || scout.status === 'stopped') return scout;
  return { ...scout, status: scout.roleSummary.trim() ? 'ready' : 'draft' };
}

export function resetScoutRun(scout: ScoutState, status: ScoutStatus = 'ready'): ScoutState {
  return {
    ...scout,
    status,
    phase: '',
    generatedAt: '',
    candidateRows: [],
    searchAttempts: [],
    warnings: [],
    errorMessage: '',
    result: null,
    totals: { ...emptyScoutTotals }
  };
}

function copyNameFor(name: string, existingNames: string[] = []): string {
  const baseName = name.replace(/\s+copy(?:\s+\d+)?$/i, '').trim() || 'Scout';
  const used = new Set(existingNames.map((item) => item.trim().toLowerCase()));
  const first = `${baseName} copy`;
  if (!used.has(first.toLowerCase())) return first;

  let index = 2;
  while (used.has(`${first} ${index}`.toLowerCase())) {
    index += 1;
  }
  return `${first} ${index}`;
}

export function duplicateScout(scout: ScoutState, id: string, existingNames: string[] = []): ScoutState {
  return createScout(id, 1, {
    ...resetScoutRun(scout),
    name: copyNameFor(scout.name, existingNames),
    status: scout.roleSummary.trim() ? 'ready' : 'draft'
  });
}

export function deleteScout(scouts: ScoutState[], id: string): ScoutState[] {
  if (scouts.length <= 1) return scouts;
  return scouts.filter((scout) => scout.id !== id);
}

export function migrateLegacyScout(id: string, value: Record<string, unknown>): ScoutState | null {
  const company =
    typeof value.company === 'object' && value.company !== null ? (value.company as Record<string, unknown>) : {};
  const objective =
    typeof value.objective === 'object' && value.objective !== null ? (value.objective as Record<string, unknown>) : {};
  const search =
    typeof value.search === 'object' && value.search !== null ? (value.search as Record<string, unknown>) : {};

  const roleSummary = String(value.roleSummary ?? company.roleSummary ?? '').trim();
  if (!roleSummary) return null;
  return createScout(id, 1, {
    name: 'Scout 1',
    roleSummary,
    idealCandidate: String(value.idealCandidate ?? company.idealCandidate ?? ''),
    minExperienceYears: Number(value.minExperienceYears ?? objective.minExperienceYears ?? 0) || 0,
    skills: storedStringList(value.skills ?? objective.skills).join(', '),
    countries: storedStringList(value.countries ?? objective.countries),
    workModes: storedWorkModes(value.workModes ?? objective.workModes),
    locations: storedStringList(value.locations ?? objective.locations).join(', '),
    maxCandidates: Number(value.maxCandidates ?? search.maxCandidates ?? 8) || 8,
    searchAttemptsLimit: Number(value.searchAttemptsLimit ?? search.searchAttemptsLimit ?? 6) || 6
  });
}

export function buildScoutWorkflow(scout: ScoutState): HiringWorkflow {
  return {
    company: {
      roleSummary: scout.roleSummary,
      idealCandidate: scout.idealCandidate
    },
    objective: {
      minExperienceYears: scout.minExperienceYears > 0 ? scout.minExperienceYears : null,
      roles: [],
      skills: listFromText(scout.skills),
      countries: scout.countries,
      workModes: scout.workModes,
      locations: listFromText(scout.locations)
    },
    search: {
      maxCandidates: Number(scout.maxCandidates),
      searchAttemptsLimit: Number(scout.searchAttemptsLimit)
    }
  };
}

export function buildScoutRequest(credentials: ScoutCredentials, scout: ScoutState): ScoutRunRequest {
  return {
    credentials,
    workflow: buildScoutWorkflow(scout)
  };
}

export function sortCandidateRows(rows: CandidateRow[]): CandidateRow[] {
  return [...rows].sort((a, b) => {
    const aEvaluated = Boolean(a.evaluation);
    const bEvaluated = Boolean(b.evaluation);
    if (aEvaluated && bEvaluated) {
      return (b.evaluation?.fitScore ?? 0) - (a.evaluation?.fitScore ?? 0) || a.order - b.order;
    }
    if (aEvaluated !== bEvaluated) return aEvaluated ? -1 : 1;
    if (a.evaluationStatus !== b.evaluationStatus) return a.evaluationStatus === 'evaluating' ? -1 : 1;
    return a.order - b.order;
  });
}

export function evaluatedCandidatesFromRows(rows: CandidateRow[]): EvaluatedCandidate[] {
  return rows.flatMap((row) => {
    if (!row.evaluation) return [];
    const { evaluationStatus, order, ...candidate } = row;
    return [{ ...candidate, evaluation: row.evaluation } as EvaluatedCandidate];
  });
}

export function buildScoutResult(scout: ScoutState): FitRunResult | null {
  const candidates = evaluatedCandidatesFromRows(scout.candidateRows);
  if (!candidates.length && !scout.result) return null;
  return {
    generatedAt: scout.generatedAt || scout.result?.generatedAt || new Date().toISOString(),
    candidates: candidates.length ? candidates : scout.result?.candidates ?? [],
    searchAttempts: scout.searchAttempts.length ? scout.searchAttempts : scout.result?.searchAttempts ?? [],
    totals: {
      discovered: scout.totals.discovered,
      evaluated: candidates.length || scout.result?.totals.evaluated || 0,
      searchAttempts: scout.searchAttempts.length || scout.result?.totals.searchAttempts || 0
    },
    warnings: scout.warnings
  };
}

export function mergeScoutCandidates(scouts: ScoutState[]): MergedCandidate[] {
  const merged = new Map<string, MergedCandidate>();

  for (const scout of scouts) {
    const result = buildScoutResult(scout);
    if (!result) continue;
    for (const candidate of result.candidates) {
      const scoutEvaluation = {
        scoutId: scout.id,
        scoutName: scout.name,
        fitScore: candidate.evaluation.fitScore,
        recommendation: candidate.evaluation.recommendation,
        candidate
      };
      const existing = merged.get(candidate.userId);
      if (!existing) {
        merged.set(candidate.userId, {
          userId: candidate.userId,
          bestCandidate: candidate,
          bestScore: candidate.evaluation.fitScore,
          matchedScouts: [scoutEvaluation]
        });
        continue;
      }

      existing.matchedScouts.push(scoutEvaluation);
      if (candidate.evaluation.fitScore > existing.bestScore) {
        existing.bestCandidate = candidate;
        existing.bestScore = candidate.evaluation.fitScore;
      }
    }
  }

  return [...merged.values()]
    .map((candidate) => ({
      ...candidate,
      matchedScouts: [...candidate.matchedScouts].sort((a, b) => b.fitScore - a.fitScore)
    }))
    .sort((a, b) => b.bestScore - a.bestScore);
}

export function mergedCandidatesToResult(candidates: MergedCandidate[]): FitRunResult {
  return {
    generatedAt: new Date().toISOString(),
    candidates: candidates.map((candidate) => candidate.bestCandidate),
    searchAttempts: [],
    totals: {
      discovered: candidates.length,
      evaluated: candidates.length,
      searchAttempts: 0
    },
    warnings: []
  };
}

export function startableScoutIds(scouts: ScoutState[], maxConcurrent: number): string[] {
  const runningCount = scouts.filter((scout) => scout.status === 'running').length;
  const availableSlots = Math.max(0, maxConcurrent - runningCount);
  return scouts
    .filter((scout) => scout.status === 'queued')
    .slice(0, availableSlots)
    .map((scout) => scout.id);
}

export function queueScoutRuns(
  scouts: ScoutState[],
  ids: string[],
  maxConcurrent: number
): { scouts: ScoutState[]; startIds: string[] } {
  const requested = new Set(ids);
  const runningCount = scouts.filter((scout) => scout.status === 'running').length;
  let slots = Math.max(0, maxConcurrent - runningCount);
  const startIds: string[] = [];

  const nextScouts = scouts.map((scout) => {
    if (!requested.has(scout.id) || !scout.roleSummary.trim() || scout.status === 'running') return scout;
    const reset = resetScoutRun(scout);
    if (slots > 0) {
      slots -= 1;
      startIds.push(scout.id);
      return { ...reset, status: 'running' as const, phase: 'Starting candidate search.' };
    }
    return { ...reset, status: 'queued' as const, phase: 'Queued.' };
  });

  return { scouts: nextScouts, startIds };
}

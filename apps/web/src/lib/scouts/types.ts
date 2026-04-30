import type { WorkMode } from '$lib/fit/options';
import type {
  CandidateEvaluation,
  CandidateProfile,
  CandidateSearchAttempt,
  EvaluatedCandidate,
  FitRunResult,
  HiringWorkflow,
  Recommendation
} from '$lib/fit/types';

export type ScoutStatus = 'draft' | 'ready' | 'queued' | 'running' | 'done' | 'failed' | 'stopped';
export type CandidateStatus = 'found' | 'evaluating' | 'evaluated';

export interface CandidateRow extends CandidateProfile {
  evaluation?: CandidateEvaluation;
  evaluationStatus: CandidateStatus;
  order: number;
}

export interface ScoutTotals {
  discovered: number;
  evaluated: number;
  searchAttempts: number;
}

export interface ScoutState {
  id: string;
  name: string;
  status: ScoutStatus;
  roleSummary: string;
  idealCandidate: string;
  minExperienceYears: number;
  skills: string;
  countries: string[];
  workModes: WorkMode[];
  locations: string;
  maxCandidates: number;
  searchAttemptsLimit: number;
  phase: string;
  generatedAt: string;
  candidateRows: CandidateRow[];
  searchAttempts: CandidateSearchAttempt[];
  warnings: string[];
  errorMessage: string;
  result: FitRunResult | null;
  totals: ScoutTotals;
}

export interface ScoutCredentials {
  markidyApiUrl: string;
  markidyApiKey: string;
  aiProvider: string;
  aiApiKey: string;
  aiBaseUrl: string;
  aiModel: string;
}

export interface ScoutRunRequest {
  credentials: ScoutCredentials;
  workflow: HiringWorkflow;
}

export interface MergedScoutEvaluation {
  scoutId: string;
  scoutName: string;
  fitScore: number;
  recommendation: Recommendation;
  candidate: EvaluatedCandidate;
}

export interface MergedCandidate {
  userId: string;
  bestCandidate: EvaluatedCandidate;
  bestScore: number;
  matchedScouts: MergedScoutEvaluation[];
}

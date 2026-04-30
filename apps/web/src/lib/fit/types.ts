export type Recommendation = 'strong_fit' | 'possible_fit' | 'weak_fit';

export interface CompanyFit {
  roleSummary: string;
  idealCandidate: string;
}

export interface ObjectiveFit {
  minExperienceYears: number | null;
  roles: string[];
  skills: string[];
  countries: string[];
  workModes: string[];
  locations: string[];
}

export interface SearchFit {
  maxCandidates: number;
  searchAttemptsLimit: number;
}

export interface HiringWorkflow {
  company: CompanyFit;
  objective: ObjectiveFit;
  search: SearchFit;
}

export interface CandidateSearchAttempt {
  id: string;
  label: string;
  strategy: 'ai_planned' | 'fallback' | 'broadened';
  q?: string;
  roles: string[];
  skills: string[];
  countries: string[];
  workModes: string[];
  locations: string[];
  minExperienceMonths: number | null;
  reason: string;
  resultCount: number;
}

export interface LinkInsight {
  url: string;
  label?: string;
  fieldPath?: string;
  sourceKind?: 'field' | 'text';
  title?: string;
  description?: string;
  snippet?: string;
  error?: string;
}

export interface MarkidyProfileSearchItem {
  userId: string;
  name?: string;
  displayName?: string;
  avatar?: string | null;
  country?: string | null;
  verifiedLevel?: number;
  memberSince?: string;
  bioSnippet?: string;
  topCareer?: unknown;
  visibleListingCount?: number;
  desiredRoles?: string[];
  recruitingSummary?: Record<string, unknown> | null;
}

export interface MarkidyProfileDetail {
  userId?: string;
  id?: string;
  name?: string;
  displayName?: string;
  avatar?: string | null;
  country?: string | null;
  bio?: string;
  description?: string;
  careers?: unknown[];
  recruitingPreferences?: Record<string, unknown> | null;
  recruitingSummary?: Record<string, unknown> | null;
  activeChannels?: unknown[];
  trustLinks?: unknown[];
  socialLinks?: Record<string, string>;
  [key: string]: unknown;
}

export interface CandidateProfile {
  userId: string;
  source: 'profile_search';
  sourceLabel: string;
  name: string;
  avatar: string | null;
  country: string;
  verifiedLevel: number;
  bioSnippet: string;
  topCareer: unknown;
  desiredRoles: string[];
  recruitingSummary: Record<string, unknown> | null;
  detail: MarkidyProfileDetail | null;
  linkInsights?: LinkInsight[];
  profileUrl: string;
}

export interface ObjectiveAssessment {
  score: number;
  matches: string[];
  misses: string[];
}

export interface CandidateEvaluation {
  summary: string;
  fitScore: number;
  recommendation: Recommendation;
  objectiveMatches: string[];
  objectiveMisses: string[];
  fitReasons: string[];
  risks: string[];
}

export interface EvaluatedCandidate extends CandidateProfile {
  evaluation: CandidateEvaluation;
}

export interface FitRunResult {
  generatedAt: string;
  candidates: EvaluatedCandidate[];
  searchAttempts: CandidateSearchAttempt[];
  totals: {
    discovered: number;
    evaluated: number;
    searchAttempts: number;
  };
  warnings: string[];
}

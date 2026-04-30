import type { WorkMode } from '$lib/fit/options';
import type { FitRunResult } from '$lib/fit/types';

export const savedReportFileVersion = 1;

export interface ScoutReportConfig {
  roleSummary: string;
  idealCandidate: string;
  minExperienceYears: number;
  skills: string;
  countries: string[];
  workModes: WorkMode[];
  locations: string;
  maxCandidates: number;
  searchAttemptsLimit: number;
}

export type ScoutReportStatus = 'done' | 'imported';

export interface ScoutReport {
  id: string;
  scoutId: string;
  scoutName: string;
  scoutConfig: ScoutReportConfig;
  createdAt: string;
  generatedAt: string;
  status: ScoutReportStatus;
  result: FitRunResult;
}

export interface ScoutReportSummary {
  id: string;
  scoutId: string;
  scoutName: string;
  createdAt: string;
  generatedAt: string;
  status: ScoutReportStatus;
  candidateCount: number;
  bestScore: number | null;
  sourceFile: string;
}

export interface SavedReportFile {
  version: typeof savedReportFileVersion;
  exportedAt: string;
  reports: ScoutReport[];
}

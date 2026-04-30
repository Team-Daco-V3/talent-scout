import { mergedCandidatesToResult } from '$lib/scouts/state';
import type { MergedCandidate } from '$lib/scouts/types';
import type { ScoutReport, SavedReportFile } from './types';
import { savedReportFileVersion } from './types';

export function sortReports(reports: ScoutReport[]): ScoutReport[] {
  return [...reports].sort((a, b) => {
    const byGeneratedAt = Date.parse(b.generatedAt) - Date.parse(a.generatedAt);
    if (Number.isFinite(byGeneratedAt) && byGeneratedAt !== 0) return byGeneratedAt;
    return b.id.localeCompare(a.id);
  });
}

export function mergeReportCandidates(reports: ScoutReport[]): MergedCandidate[] {
  const merged = new Map<string, MergedCandidate>();

  for (const report of reports) {
    for (const candidate of report.result.candidates) {
      const reportEvaluation = {
        scoutId: report.scoutId,
        scoutName: report.scoutName,
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
          matchedScouts: [reportEvaluation]
        });
        continue;
      }

      existing.matchedScouts.push(reportEvaluation);
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

export function reportsToSavedReportFile(reports: ScoutReport[]): SavedReportFile {
  return {
    version: savedReportFileVersion,
    exportedAt: new Date().toISOString(),
    reports
  };
}

export function mergedReportsToResult(reports: ScoutReport[]) {
  return mergedCandidatesToResult(mergeReportCandidates(reports));
}

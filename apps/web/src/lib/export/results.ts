import type { FitRunResult } from '$lib/fit/types';

function csvCell(value: unknown): string {
  const text = Array.isArray(value)
    ? value.join('; ')
    : value === null || value === undefined
      ? ''
      : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function resultsToCsv(result: FitRunResult): string {
  const headers = [
    'source',
    'name',
    'country',
    'fitScore',
    'recommendation',
    'summary',
    'objectiveMatches',
    'objectiveMisses',
    'fitReasons',
    'risks',
    'linkInsights',
    'profileUrl'
  ];

  const rows = result.candidates.map((candidate) => [
    candidate.sourceLabel,
    candidate.name,
    candidate.country,
    candidate.evaluation.fitScore,
    candidate.evaluation.recommendation,
    candidate.evaluation.summary,
    candidate.evaluation.objectiveMatches,
    candidate.evaluation.objectiveMisses,
    candidate.evaluation.fitReasons,
    candidate.evaluation.risks,
    candidate.linkInsights?.map((link) =>
      [link.label, link.fieldPath, link.url, link.title].filter(Boolean).join(': ')
    ) || [],
    candidate.profileUrl
  ]);

  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

export function downloadText(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadResultsJson(result: FitRunResult): void {
  downloadText(
    `talent-scout-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(result, null, 2),
    'application/json'
  );
}

export function downloadResultsCsv(result: FitRunResult): void {
  downloadText(
    `talent-scout-${new Date().toISOString().slice(0, 10)}.csv`,
    resultsToCsv(result),
    'text/csv;charset=utf-8'
  );
}

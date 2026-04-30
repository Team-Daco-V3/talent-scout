import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FitRunResult } from '$lib/fit/types';
import {
  savedReportFileVersion,
  type SavedReportFile,
  type ScoutReport,
  type ScoutReportConfig,
  type ScoutReportSummary
} from '$lib/reports/types';

export interface SaveReportInput {
  scoutId: string;
  scoutName: string;
  scoutConfig: ScoutReportConfig;
  generatedAt?: string;
  result: FitRunResult;
}

export interface ReportStorageOptions {
  reportsDir?: string;
  now?: Date;
}

export class ReportStorageError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'ReportStorageError';
    this.status = status;
  }
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? '').trim()).filter(Boolean) : [];
}

function defaultReportsDir(cwd = process.cwd()): string {
  const basename = path.basename(cwd).toLowerCase();
  const parent = path.basename(path.dirname(cwd)).toLowerCase();
  if (basename === 'web' && parent === 'apps') {
    return path.resolve(cwd, '..', '..', 'reports');
  }
  return path.resolve(cwd, 'reports');
}

export function resolveReportsDir(options: ReportStorageOptions = {}): string {
  const configured = options.reportsDir || process.env.MARKIDY_REPORTS_DIR;
  return configured ? path.resolve(configured) : defaultReportsDir();
}

export function safeFilePart(value: string): string {
  const safe = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return safe || 'scout';
}

export function fileTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
}

function sanitizeScoutConfig(value: unknown): ScoutReportConfig {
  const config = recordFrom(value);
  return {
    roleSummary: stringValue(config.roleSummary),
    idealCandidate: stringValue(config.idealCandidate),
    minExperienceYears: numberValue(config.minExperienceYears),
    skills: stringValue(config.skills),
    countries: stringArray(config.countries),
    workModes: stringArray(config.workModes) as ScoutReportConfig['workModes'],
    locations: stringValue(config.locations),
    maxCandidates: numberValue(config.maxCandidates, 8),
    searchAttemptsLimit: numberValue(config.searchAttemptsLimit, 6)
  };
}

function sanitizeResult(value: unknown): FitRunResult {
  const result = recordFrom(value);
  if (!Array.isArray(result.candidates)) {
    throw new ReportStorageError('Report result must include candidates.', 400);
  }
  return {
    generatedAt: stringValue(result.generatedAt, new Date().toISOString()),
    candidates: result.candidates as FitRunResult['candidates'],
    searchAttempts: Array.isArray(result.searchAttempts) ? result.searchAttempts as FitRunResult['searchAttempts'] : [],
    totals: recordFrom(result.totals) as FitRunResult['totals'],
    warnings: stringArray(result.warnings)
  };
}

export function createReport(input: unknown, options: ReportStorageOptions = {}): ScoutReport {
  const body = recordFrom(input);
  const result = sanitizeResult(body.result);
  const now = options.now ?? new Date();
  const createdAt = now.toISOString();
  const generatedAt = stringValue(body.generatedAt, result.generatedAt || createdAt);

  return {
    id: `rpt_${fileTimestamp(now)}_${randomUUID().slice(0, 8)}`,
    scoutId: stringValue(body.scoutId, 'unknown-scout'),
    scoutName: stringValue(body.scoutName, 'Unknown scout'),
    scoutConfig: sanitizeScoutConfig(body.scoutConfig),
    createdAt,
    generatedAt,
    status: 'done',
    result: {
      ...result,
      generatedAt
    }
  };
}

export function reportFileName(report: ScoutReport): string {
  const generatedDate = new Date(report.generatedAt);
  const createdDate = new Date(report.createdAt);
  const date = Number.isNaN(generatedDate.getTime()) ? createdDate : generatedDate;
  return `${fileTimestamp(date)}__${safeFilePart(report.scoutName)}__${safeFilePart(report.id)}.json`;
}

export function savedReportFile(reports: ScoutReport[], exportedAt = new Date().toISOString()): SavedReportFile {
  return {
    version: savedReportFileVersion,
    exportedAt,
    reports
  };
}

export async function ensureReportsDir(options: ReportStorageOptions = {}): Promise<string> {
  const reportsDir = resolveReportsDir(options);
  await mkdir(reportsDir, { recursive: true });
  return reportsDir;
}

export async function saveReport(input: unknown, options: ReportStorageOptions = {}): Promise<ScoutReport> {
  const report = createReport(input, options);
  const reportsDir = await ensureReportsDir(options);
  const filePath = path.join(reportsDir, reportFileName(report));
  await writeFile(filePath, `${JSON.stringify(savedReportFile([report], report.createdAt), null, 2)}\n`, {
    encoding: 'utf-8',
    flag: 'wx'
  });
  return report;
}

function parseSavedReportFile(value: unknown): SavedReportFile | null {
  const file = recordFrom(value);
  if (file.version !== savedReportFileVersion || !Array.isArray(file.reports)) return null;
  return {
    version: savedReportFileVersion,
    exportedAt: stringValue(file.exportedAt, new Date().toISOString()),
    reports: file.reports.filter((report) => {
      const record = recordFrom(report);
      return Boolean(record.id && record.result && Array.isArray(recordFrom(record.result).candidates));
    }) as ScoutReport[]
  };
}

function reportSummary(report: ScoutReport, sourceFile: string): ScoutReportSummary {
  const scores = report.result.candidates
    .map((candidate) => candidate.evaluation?.fitScore)
    .filter((score): score is number => typeof score === 'number');
  return {
    id: report.id,
    scoutId: report.scoutId,
    scoutName: report.scoutName,
    createdAt: report.createdAt,
    generatedAt: report.generatedAt,
    status: report.status,
    candidateCount: report.result.candidates.length,
    bestScore: scores.length ? Math.max(...scores) : null,
    sourceFile
  };
}

async function readReportFiles(options: ReportStorageOptions = {}): Promise<{
  files: Array<{ sourceFile: string; sourcePath: string; reportFile: SavedReportFile }>;
  warnings: string[];
}> {
  const reportsDir = await ensureReportsDir(options);
  const entries = await readdir(reportsDir, { withFileTypes: true });
  const files: Array<{ sourceFile: string; sourcePath: string; reportFile: SavedReportFile }> = [];
  const warnings: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue;
    try {
      const sourcePath = path.join(reportsDir, entry.name);
      const raw = await readFile(sourcePath, 'utf-8');
      const parsed = parseSavedReportFile(JSON.parse(raw));
      if (!parsed) {
        warnings.push(`${entry.name} is not a supported report file.`);
        continue;
      }
      files.push({ sourceFile: entry.name, sourcePath, reportFile: parsed });
    } catch (error) {
      warnings.push(`${entry.name} could not be read: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return { files, warnings };
}

export async function listReports(options: ReportStorageOptions = {}): Promise<{
  reports: ScoutReportSummary[];
  warnings: string[];
}> {
  const { files, warnings } = await readReportFiles(options);
  const reports = files
    .flatMap(({ sourceFile, reportFile }) => reportFile.reports.map((report) => reportSummary(report, sourceFile)))
    .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));
  return { reports, warnings };
}

export async function loadReport(id: string, options: ReportStorageOptions = {}): Promise<ScoutReport | null> {
  const { files } = await readReportFiles(options);
  for (const { reportFile } of files) {
    const report = reportFile.reports.find((item) => item.id === id);
    if (report) return report;
  }
  return null;
}

export async function deleteReport(id: string, options: ReportStorageOptions = {}): Promise<ScoutReport> {
  const { files } = await readReportFiles(options);

  for (const { sourcePath, reportFile } of files) {
    const reportIndex = reportFile.reports.findIndex((report) => report.id === id);
    if (reportIndex < 0) continue;

    const deletedReport = reportFile.reports[reportIndex];
    const remainingReports = reportFile.reports.filter((report) => report.id !== id);

    if (!remainingReports.length) {
      await unlink(sourcePath);
    } else {
      await writeFile(
        sourcePath,
        `${JSON.stringify(savedReportFile(remainingReports, reportFile.exportedAt), null, 2)}\n`,
        'utf-8'
      );
    }

    return deletedReport;
  }

  throw new ReportStorageError('Report not found.', 404);
}

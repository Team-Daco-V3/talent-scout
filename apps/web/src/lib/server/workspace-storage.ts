import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isWorkMode, type WorkMode } from '$lib/fit/options';

export const savedWorkspaceFileVersion = 1;

export type WorkspaceTab = 'setup' | 'scouts' | 'reports';

export interface StoredScout {
  id: string;
  name: string;
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

export interface SavedWorkspaceFile {
  version: typeof savedWorkspaceFileVersion;
  savedAt: string;
  markidyApiUrl: string;
  aiProvider: string;
  aiBaseUrl: string;
  aiModel: string;
  selectedScoutId: string;
  reportTab: string;
  activeWorkspaceTab: WorkspaceTab;
  suppressedReportRunKeys: string[];
  scouts: StoredScout[];
}

export interface WorkspaceStorageOptions {
  workspaceFile?: string;
  now?: Date;
}

export class WorkspaceStorageError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'WorkspaceStorageError';
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

function workModeArray(value: unknown): WorkMode[] {
  const modes = stringArray(value)
    .map((item) => item.toLowerCase())
    .filter(isWorkMode);
  return [...new Set(modes)];
}

function workspaceTab(value: unknown): WorkspaceTab {
  return value === 'reports' || value === 'scouts' ? value : 'setup';
}

function defaultWorkspaceFile(cwd = process.cwd()): string {
  const basename = path.basename(cwd).toLowerCase();
  const parent = path.basename(path.dirname(cwd)).toLowerCase();
  const projectRoot = basename === 'web' && parent === 'apps' ? path.resolve(cwd, '..', '..') : cwd;
  return path.resolve(projectRoot, '.talent-scout', 'workspace.json');
}

export function resolveWorkspaceFile(options: WorkspaceStorageOptions = {}): string {
  const configured = options.workspaceFile || process.env.TALENT_SCOUT_WORKSPACE_FILE;
  return configured ? path.resolve(configured) : defaultWorkspaceFile();
}

async function ensureWorkspaceDir(options: WorkspaceStorageOptions = {}) {
  const workspaceFile = resolveWorkspaceFile(options);
  await mkdir(path.dirname(workspaceFile), { recursive: true });
  return workspaceFile;
}

function sanitizeScout(value: unknown, index: number): StoredScout {
  const scout = recordFrom(value);
  const roleSummary = stringValue(scout.roleSummary);
  return {
    id: stringValue(scout.id, `scout-${index + 1}`),
    name: stringValue(scout.name, `Scout ${index + 1}`),
    roleSummary,
    idealCandidate: stringValue(scout.idealCandidate),
    minExperienceYears: numberValue(scout.minExperienceYears),
    skills: stringValue(scout.skills),
    countries: stringArray(scout.countries),
    workModes: workModeArray(scout.workModes),
    locations: stringValue(scout.locations),
    maxCandidates: numberValue(scout.maxCandidates, 8),
    searchAttemptsLimit: numberValue(scout.searchAttemptsLimit, 6)
  };
}

export function sanitizeWorkspace(input: unknown, options: WorkspaceStorageOptions = {}): SavedWorkspaceFile {
  const body = recordFrom(input);
  const now = options.now && Number.isFinite(options.now.getTime()) ? options.now : new Date();
  const scouts = Array.isArray(body.scouts)
    ? body.scouts.map((scout, index) => sanitizeScout(scout, index))
    : [];
  const safeScouts = scouts.length ? scouts : [sanitizeScout({}, 0)];
  const selectedScoutId = stringValue(body.selectedScoutId, safeScouts[0].id);

  return {
    version: savedWorkspaceFileVersion,
    savedAt: now.toISOString(),
    markidyApiUrl: stringValue(body.markidyApiUrl, 'https://api.markidy.com'),
    aiProvider: stringValue(body.aiProvider, 'openai'),
    aiBaseUrl: stringValue(body.aiBaseUrl, 'https://api.openai.com/v1'),
    aiModel: stringValue(body.aiModel, 'gpt-4o-mini'),
    selectedScoutId: safeScouts.some((scout) => scout.id === selectedScoutId) ? selectedScoutId : safeScouts[0].id,
    reportTab: stringValue(body.reportTab, 'all'),
    activeWorkspaceTab: workspaceTab(body.activeWorkspaceTab),
    suppressedReportRunKeys: stringArray(body.suppressedReportRunKeys),
    scouts: safeScouts
  };
}

function parseWorkspaceFile(value: unknown): SavedWorkspaceFile | null {
  const file = recordFrom(value);
  if (file.version !== savedWorkspaceFileVersion || !Array.isArray(file.scouts)) return null;
  const savedAt = new Date(stringValue(file.savedAt, new Date().toISOString()));
  return sanitizeWorkspace(file, { now: savedAt });
}

export async function saveWorkspace(input: unknown, options: WorkspaceStorageOptions = {}): Promise<SavedWorkspaceFile> {
  const workspace = sanitizeWorkspace(input, options);
  const workspaceFile = await ensureWorkspaceDir(options);
  await writeFile(workspaceFile, `${JSON.stringify(workspace, null, 2)}\n`, 'utf-8');
  return workspace;
}

export async function loadWorkspace(options: WorkspaceStorageOptions = {}): Promise<SavedWorkspaceFile | null> {
  const workspaceFile = resolveWorkspaceFile(options);
  try {
    const raw = await readFile(workspaceFile, 'utf-8');
    return parseWorkspaceFile(JSON.parse(raw));
  } catch (error) {
    const code = recordFrom(error).code;
    if (code === 'ENOENT') return null;
    throw new WorkspaceStorageError(error instanceof Error ? error.message : 'Failed to load workspace.');
  }
}

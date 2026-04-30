import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkspace, resolveWorkspaceFile, saveWorkspace, sanitizeWorkspace } from './workspace-storage';

let tempDirs: string[] = [];

async function tempWorkspaceFile() {
  const dir = await mkdtemp(path.join(tmpdir(), 'talent-scout-workspace-'));
  tempDirs.push(dir);
  return path.join(dir, '.talent-scout', 'workspace.json');
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe('workspace storage', () => {
  it('saves scout setup without credentials or run results', async () => {
    const workspaceFile = await tempWorkspaceFile();
    const saved = await saveWorkspace(
      {
        markidyApiUrl: 'https://api.markidy.com',
        markidyApiKey: 'mk_secret',
        aiProvider: 'openai',
        aiApiKey: 'sk_secret',
        aiBaseUrl: 'https://api.openai.com/v1',
        aiModel: 'gpt-4o-mini',
        selectedScoutId: 'scout-1',
        reportTab: 'all',
        activeWorkspaceTab: 'scouts',
        scouts: [
          {
            id: 'scout-1',
            name: 'Backend Scout',
            roleSummary: 'Find backend engineers.',
            idealCandidate: 'Ships reliable APIs.',
            minExperienceYears: 3,
            skills: 'TypeScript',
            countries: ['US'],
            workModes: ['remote'],
            locations: 'New York',
            maxCandidates: 8,
            searchAttemptsLimit: 6,
            candidateRows: [{ userId: 'candidate-1' }],
            result: { candidates: [{ userId: 'candidate-1' }] }
          }
        ]
      },
      { workspaceFile, now: new Date('2026-04-30T00:00:00.000Z') }
    );
    const raw = await readFile(workspaceFile, 'utf-8');

    expect(saved.scouts[0].name).toBe('Backend Scout');
    expect(raw).not.toContain('mk_secret');
    expect(raw).not.toContain('sk_secret');
    expect(raw).not.toContain('candidateRows');
    expect(raw).not.toContain('result');
    expect((await loadWorkspace({ workspaceFile }))?.scouts[0].roleSummary).toBe('Find backend engineers.');
  });

  it('returns null when the workspace file does not exist and supports env override', async () => {
    const workspaceFile = await tempWorkspaceFile();
    const previous = process.env.TALENT_SCOUT_WORKSPACE_FILE;
    process.env.TALENT_SCOUT_WORKSPACE_FILE = workspaceFile;

    try {
      expect(resolveWorkspaceFile()).toBe(path.resolve(workspaceFile));
      expect(await loadWorkspace({ workspaceFile })).toBeNull();
    } finally {
      if (previous === undefined) {
        delete process.env.TALENT_SCOUT_WORKSPACE_FILE;
      } else {
        process.env.TALENT_SCOUT_WORKSPACE_FILE = previous;
      }
    }
  });

  it('normalizes invalid or missing scouts to a usable default', () => {
    const workspace = sanitizeWorkspace({ scouts: [] }, { now: new Date('2026-04-30T00:00:00.000Z') });

    expect(workspace.scouts).toHaveLength(1);
    expect(workspace.scouts[0].id).toBe('scout-1');
    expect(workspace.selectedScoutId).toBe('scout-1');
  });
});

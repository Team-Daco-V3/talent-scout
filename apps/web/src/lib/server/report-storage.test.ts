import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createReport,
  deleteReport,
  ensureReportsDir,
  loadReport,
  listReports,
  safeFilePart,
  savedReportFile,
  saveReport
} from './report-storage';
import type { SaveReportInput } from './report-storage';

let tempDirs: string[] = [];

function reportInput(): SaveReportInput {
  return {
    scoutId: 'scout-1',
    scoutName: 'Backend Scout',
    scoutConfig: {
      roleSummary: 'Find backend engineers.',
      idealCandidate: 'Ships reliable APIs.',
      minExperienceYears: 3,
      skills: 'TypeScript, PostgreSQL',
      countries: ['US'],
      workModes: ['remote'],
      locations: 'New York',
      maxCandidates: 8,
      searchAttemptsLimit: 6
    },
    result: {
      generatedAt: '2026-04-30T00:00:00.000Z',
      candidates: [
        {
          userId: 'usr_1',
          source: 'profile_search',
          sourceLabel: 'Profile search',
          name: 'A Builder',
          avatar: null,
          country: 'US',
          verifiedLevel: 1,
          bioSnippet: '',
          topCareer: null,
          desiredRoles: [],
          recruitingSummary: null,
          detail: null,
          profileUrl: 'https://markidy.com/profile/usr_1',
          evaluation: {
            summary: 'Strong fit.',
            fitScore: 91,
            recommendation: 'strong_fit',
            objectiveMatches: [],
            objectiveMisses: [],
            fitReasons: [],
            risks: []
          }
        }
      ],
      searchAttempts: [],
      totals: { discovered: 1, evaluated: 1, searchAttempts: 0 },
      warnings: []
    }
  };
}

async function tempReportsDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'markidy-reports-'));
  tempDirs.push(dir);
  return path.join(dir, 'reports');
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe('report storage', () => {
  it('creates the reports directory and writes a sanitized report file without credentials', async () => {
    const reportsDir = await tempReportsDir();
    const input = {
      ...reportInput(),
      scoutName: 'Backend/Scout: v1',
      markidyApiKey: 'mk_secret',
      aiApiKey: 'sk_secret'
    };

    await ensureReportsDir({ reportsDir });
    const report = await saveReport(input, {
      reportsDir,
      now: new Date('2026-04-30T12:34:56.000Z')
    });
    const listed = await listReports({ reportsDir });
    const raw = await readFile(path.join(reportsDir, listed.reports[0].sourceFile), 'utf-8');

    expect(report.scoutName).toBe('Backend/Scout: v1');
    expect(listed.reports).toHaveLength(1);
    expect(listed.reports[0].sourceFile).toContain('backend-scout-v1');
    expect(raw).toContain('"version": 1');
    expect(raw).not.toContain('mk_secret');
    expect(raw).not.toContain('sk_secret');
  });

  it('uses safe fallback file parts and warns about corrupted report files', async () => {
    const reportsDir = await tempReportsDir();
    await ensureReportsDir({ reportsDir });
    await writeFile(path.join(reportsDir, 'broken.json'), '{bad json', 'utf-8');

    const listed = await listReports({ reportsDir });

    expect(safeFilePart('###')).toBe('scout');
    expect(listed.reports).toEqual([]);
    expect(listed.warnings[0]).toContain('broken.json');
  });

  it('deletes a single-report file by report id', async () => {
    const reportsDir = await tempReportsDir();
    const report = await saveReport(reportInput(), { reportsDir });

    await deleteReport(report.id, { reportsDir });
    const listed = await listReports({ reportsDir });

    expect(listed.reports).toEqual([]);
    await expect(deleteReport(report.id, { reportsDir })).rejects.toMatchObject({ status: 404 });
  });

  it('removes one report from a multi-report file and keeps the other reports', async () => {
    const reportsDir = await tempReportsDir();
    await ensureReportsDir({ reportsDir });
    const first = createReport(reportInput(), {
      now: new Date('2026-04-30T10:00:00.000Z')
    });
    const second = createReport(
      {
        ...reportInput(),
        scoutId: 'scout-2',
        scoutName: 'Frontend Scout'
      },
      { now: new Date('2026-04-30T11:00:00.000Z') }
    );
    await writeFile(
      path.join(reportsDir, 'bundle.json'),
      JSON.stringify(savedReportFile([first, second]), null, 2),
      'utf-8'
    );

    await deleteReport(first.id, { reportsDir });
    const listed = await listReports({ reportsDir });

    expect(await loadReport(first.id, { reportsDir })).toBeNull();
    expect((await loadReport(second.id, { reportsDir }))?.scoutName).toBe('Frontend Scout');
    expect(listed.reports.map((report) => report.id)).toEqual([second.id]);
  });

  it('can delete a valid report while corrupted files exist', async () => {
    const reportsDir = await tempReportsDir();
    await ensureReportsDir({ reportsDir });
    await writeFile(path.join(reportsDir, 'broken.json'), '{bad json', 'utf-8');
    const report = await saveReport(reportInput(), { reportsDir });

    await deleteReport(report.id, { reportsDir });
    const listed = await listReports({ reportsDir });

    expect(listed.reports).toEqual([]);
    expect(listed.warnings[0]).toContain('broken.json');
  });
});

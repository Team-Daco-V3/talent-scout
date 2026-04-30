import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GET as listReports, POST as saveReport } from '../../routes/api/reports/+server';
import { DELETE as deleteReport, GET as loadReport } from '../../routes/api/reports/[id]/+server';
import type { SaveReportInput } from './report-storage';

let tempDirs: string[] = [];
let previousReportsDir: string | undefined;

function requestPayload(): SaveReportInput {
  return {
    scoutId: 'scout-1',
    scoutName: 'Backend Scout',
    scoutConfig: {
      roleSummary: 'Find backend engineers.',
      idealCandidate: '',
      minExperienceYears: 0,
      skills: '',
      countries: [],
      workModes: [],
      locations: '',
      maxCandidates: 8,
      searchAttemptsLimit: 6
    },
    result: {
      generatedAt: '2026-04-30T00:00:00.000Z',
      candidates: [],
      searchAttempts: [],
      totals: { discovered: 0, evaluated: 0, searchAttempts: 0 },
      warnings: []
    }
  };
}

async function withTempReportsDir() {
  previousReportsDir = process.env.MARKIDY_REPORTS_DIR;
  const dir = await mkdtemp(path.join(tmpdir(), 'markidy-report-routes-'));
  tempDirs.push(dir);
  process.env.MARKIDY_REPORTS_DIR = path.join(dir, 'reports');
}

afterEach(async () => {
  if (previousReportsDir === undefined) {
    delete process.env.MARKIDY_REPORTS_DIR;
  } else {
    process.env.MARKIDY_REPORTS_DIR = previousReportsDir;
  }
  previousReportsDir = undefined;
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe('report API routes', () => {
  it('saves, lists, and loads reports through the API handlers', async () => {
    await withTempReportsDir();

    const postResponse = await saveReport({
      request: new Request('http://localhost/api/reports', {
        method: 'POST',
        body: JSON.stringify(requestPayload())
      })
    } as never);
    const postPayload = await postResponse.json();

    expect(postResponse.status).toBe(201);
    expect(postPayload.report.scoutName).toBe('Backend Scout');

    const listResponse = await listReports();
    const listPayload = await listResponse.json();

    expect(listPayload.reports).toHaveLength(1);
    expect(listPayload.reports[0].id).toBe(postPayload.report.id);

    const detailResponse = await loadReport({ params: { id: postPayload.report.id } } as never);
    const detailPayload = await detailResponse.json();

    expect(detailPayload.report.id).toBe(postPayload.report.id);
  });

  it('deletes reports through the API handler and returns 404 for missing reports', async () => {
    await withTempReportsDir();

    const postResponse = await saveReport({
      request: new Request('http://localhost/api/reports', {
        method: 'POST',
        body: JSON.stringify(requestPayload())
      })
    } as never);
    const postPayload = await postResponse.json();

    const deleteResponse = await deleteReport({ params: { id: postPayload.report.id } } as never);
    const deletePayload = await deleteResponse.json();
    const missingResponse = await deleteReport({ params: { id: postPayload.report.id } } as never);

    expect(deleteResponse.status).toBe(200);
    expect(deletePayload.reportId).toBe(postPayload.report.id);
    expect(missingResponse.status).toBe(404);
  });
});

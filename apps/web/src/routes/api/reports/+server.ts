import { json } from '@sveltejs/kit';
import { listReports, ReportStorageError, saveReport } from '$lib/server/report-storage';

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof ReportStorageError) {
    return json({ error: error.message }, { status: error.status });
  }
  return json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}

export async function GET() {
  try {
    return json(await listReports());
  } catch (error) {
    return errorResponse(error, 'Failed to list reports.');
  }
}

export async function POST({ request }) {
  try {
    const report = await saveReport(await request.json());
    return json({ report }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Failed to save report.');
  }
}

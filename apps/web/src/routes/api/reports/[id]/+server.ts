import { json } from '@sveltejs/kit';
import { deleteReport, loadReport, ReportStorageError } from '$lib/server/report-storage';

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof ReportStorageError) {
    return json({ error: error.message }, { status: error.status });
  }
  return json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 500 }
  );
}

export async function GET({ params }) {
  try {
    const report = await loadReport(params.id);
    if (!report) {
      return json({ error: 'Report not found.' }, { status: 404 });
    }
    return json({ report });
  } catch (error) {
    return errorResponse(error, 'Failed to load report.');
  }
}

export async function DELETE({ params }) {
  try {
    const report = await deleteReport(params.id);
    return json({ ok: true, reportId: report.id });
  } catch (error) {
    return errorResponse(error, 'Failed to delete report.');
  }
}

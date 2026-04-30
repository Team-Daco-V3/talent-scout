import { json } from '@sveltejs/kit';
import { loadWorkspace, saveWorkspace, WorkspaceStorageError } from '$lib/server/workspace-storage';

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof WorkspaceStorageError) {
    return json({ error: error.message }, { status: error.status });
  }
  return json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}

export async function GET() {
  try {
    return json({ workspace: await loadWorkspace() });
  } catch (error) {
    return errorResponse(error, 'Failed to load workspace.');
  }
}

export async function PUT({ request }) {
  try {
    return json({ workspace: await saveWorkspace(await request.json()) });
  } catch (error) {
    return errorResponse(error, 'Failed to save workspace.');
  }
}

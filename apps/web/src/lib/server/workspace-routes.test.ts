import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GET as loadWorkspace, PUT as saveWorkspace } from '../../routes/api/workspace/+server';

let tempDirs: string[] = [];
let previousWorkspaceFile: string | undefined;

async function withTempWorkspaceFile() {
  previousWorkspaceFile = process.env.TALENT_SCOUT_WORKSPACE_FILE;
  const dir = await mkdtemp(path.join(tmpdir(), 'talent-scout-workspace-route-'));
  tempDirs.push(dir);
  process.env.TALENT_SCOUT_WORKSPACE_FILE = path.join(dir, '.talent-scout', 'workspace.json');
}

afterEach(async () => {
  if (previousWorkspaceFile === undefined) {
    delete process.env.TALENT_SCOUT_WORKSPACE_FILE;
  } else {
    process.env.TALENT_SCOUT_WORKSPACE_FILE = previousWorkspaceFile;
  }
  previousWorkspaceFile = undefined;
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe('workspace API route', () => {
  it('saves and loads workspace setup through the API handlers', async () => {
    await withTempWorkspaceFile();

    const putResponse = await saveWorkspace({
      request: new Request('http://localhost/api/workspace', {
        method: 'PUT',
        body: JSON.stringify({
          markidyApiUrl: 'https://api.markidy.com',
          markidyApiKey: 'mk_secret',
          aiProvider: 'openai',
          aiApiKey: 'sk_secret',
          aiBaseUrl: 'https://api.openai.com/v1',
          aiModel: 'gpt-4o-mini',
          selectedScoutId: 'scout-1',
          scouts: [{ id: 'scout-1', name: 'Backend Scout', roleSummary: 'Find backend engineers.' }]
        })
      })
    } as never);
    const putPayload = await putResponse.json();
    const getResponse = await loadWorkspace();
    const getPayload = await getResponse.json();

    expect(putResponse.status).toBe(200);
    expect(putPayload.workspace.scouts[0].name).toBe('Backend Scout');
    expect(putPayload.workspace.markidyApiKey).toBeUndefined();
    expect(putPayload.workspace.aiApiKey).toBeUndefined();
    expect(getPayload.workspace.scouts[0].roleSummary).toBe('Find backend engineers.');
  });
});

import { json } from '@sveltejs/kit';
import { MarkidyApiClient } from '$lib/server/markidy-api';
import { validateRequestSchema } from '$lib/server/schema';

export async function POST({ request }) {
  const parsed = validateRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.issues[0]?.message || 'Invalid request.' }, { status: 400 });
  }

  try {
    const client = new MarkidyApiClient({
      apiUrl: parsed.data.markidyApiUrl,
      apiKey: parsed.data.markidyApiKey
    });
    const channels = await client.getChannels();
    const markidy = channels.channels.find((channel) => channel.channel === 'markidy');
    return json({
      ok: true,
      channels: channels.channels,
      markidyChatReady: markidy?.connected === true
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to validate Markidy API key.'
      },
      { status: 400 }
    );
  }
}

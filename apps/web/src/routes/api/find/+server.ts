import { json } from '@sveltejs/kit';
import {
  buildCandidateProfile,
  evaluateObjectiveFit
} from '$lib/fit/objective';
import { evaluateCandidate } from '$lib/server/ai';
import { enrichCandidateLinks } from '$lib/server/link-insights';
import { MarkidyApiClient } from '$lib/server/markidy-api';
import { discoverProfileCandidates } from '$lib/server/profile-search';
import { rateLimitRetryMessage, type RateLimitRetryEvent } from '$lib/server/rate-limit';
import { fitRequestSchema } from '$lib/server/schema';
import { planCandidateSearch } from '$lib/server/search-planner';
import type { EvaluatedCandidate, FitRunResult } from '$lib/fit/types';

export async function POST({ request }) {
  const parsed = fitRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return json(
      {
        error: 'Validation failed.',
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message
        }))
      },
      { status: 400 }
    );
  }

  const { credentials, workflow } = parsed.data;
  const warnings: string[] = [];
  const handleRateLimited = (event: RateLimitRetryEvent) => {
    warnings.push(`${rateLimitRetryMessage(event)} The scout resumed automatically.`);
  };
  const client = new MarkidyApiClient({
    apiUrl: credentials.markidyApiUrl,
    apiKey: credentials.markidyApiKey,
    onRateLimited: handleRateLimited
  });

  try {
    await client.getChannels();
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Failed to validate Markidy API key.'
      },
      { status: 401 }
    );
  }

  const maxCandidates = workflow.search.maxCandidates;
  const aiConfig = {
    provider: credentials.aiProvider,
    apiKey: credentials.aiApiKey,
    baseUrl: credentials.aiBaseUrl,
    model: credentials.aiModel,
    onRateLimited: handleRateLimited
  };
  const searchAttempts = await planCandidateSearch(aiConfig, workflow, warnings);
  const discovered = await discoverProfileCandidates({ client, searchAttempts, maxCandidates });

  const profileItems = discovered.slice(0, maxCandidates);
  if (!profileItems.length) {
    warnings.push('Markidy profile search returned no candidates after AI-planned broadening attempts.');
  }

  const candidates: EvaluatedCandidate[] = [];

  for (const item of profileItems) {
    let detail = null;
    try {
      detail = await client.getProfile(item.userId);
    } catch (error) {
      warnings.push(`Could not fetch profile detail for ${item.userId}.`);
    }

    const profile = await enrichCandidateLinks(buildCandidateProfile(item, detail), {
      onRateLimited: handleRateLimited
    });
    const objective = evaluateObjectiveFit(workflow, profile);
    const evaluation = await evaluateCandidate(
      aiConfig,
      workflow,
      profile,
      objective
    );

    candidates.push({ ...profile, evaluation });
  }

  candidates.sort((a, b) => b.evaluation.fitScore - a.evaluation.fitScore);

  const result: FitRunResult = {
    generatedAt: new Date().toISOString(),
    candidates,
    searchAttempts,
    totals: {
      discovered: discovered.length,
      evaluated: candidates.length,
      searchAttempts: searchAttempts.length
    },
    warnings
  };

  return json(result);
}

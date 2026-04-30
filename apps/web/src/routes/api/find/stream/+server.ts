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
import type {
  CandidateProfile,
  CandidateSearchAttempt,
  EvaluatedCandidate,
  FitRunResult
} from '$lib/fit/types';

type FindStreamEvent =
  | { type: 'phase'; message: string }
  | { type: 'started'; generatedAt: string }
  | { type: 'attempts'; searchAttempts: CandidateSearchAttempt[] }
  | { type: 'attempt_updated'; attempt: CandidateSearchAttempt; totals: { discovered: number } }
  | { type: 'candidate_found'; candidate: CandidateProfile; totals: { discovered: number } }
  | { type: 'candidate_evaluating'; userId: string; totals: { evaluated: number; discovered: number } }
  | { type: 'candidate_evaluated'; candidate: EvaluatedCandidate; totals: { evaluated: number; discovered: number } }
  | { type: 'warning'; message: string }
  | { type: 'done'; result: FitRunResult }
  | { type: 'error'; message: string };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

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
  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: FindStreamEvent) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          cancelled = true;
        }
      };

      const warnings: string[] = [];
      let sentWarnings = 0;
      const flushWarnings = () => {
        while (sentWarnings < warnings.length) {
          send({ type: 'warning', message: warnings[sentWarnings] });
          sentWarnings += 1;
        }
      };
      const pushWarning = (message: string) => {
        warnings.push(message);
        flushWarnings();
      };
      const handleRateLimited = (event: RateLimitRetryEvent) => {
        const message = rateLimitRetryMessage(event);
        send({ type: 'phase', message });
        pushWarning(`${message} The scout will resume automatically.`);
      };

      try {
        const generatedAt = new Date().toISOString();
        const client = new MarkidyApiClient({
          apiUrl: credentials.markidyApiUrl,
          apiKey: credentials.markidyApiKey,
          onRateLimited: handleRateLimited
        });
        const aiConfig = {
          provider: credentials.aiProvider,
          apiKey: credentials.aiApiKey,
          baseUrl: credentials.aiBaseUrl,
          model: credentials.aiModel,
          onRateLimited: handleRateLimited
        };
        const maxCandidates = workflow.search.maxCandidates;
        const candidates: EvaluatedCandidate[] = [];

        send({ type: 'started', generatedAt });
        send({ type: 'phase', message: 'Validating Markidy API key.' });
        await client.getChannels();

        send({ type: 'phase', message: 'Planning profile search attempts with AI.' });
        const searchAttempts = await planCandidateSearch(aiConfig, workflow, warnings);
        flushWarnings();
        send({ type: 'attempts', searchAttempts });

        send({ type: 'phase', message: 'Searching Markidy profiles.' });
        const discovered = await discoverProfileCandidates({
          client,
          searchAttempts,
          maxCandidates,
          shouldStop: () => cancelled,
          onProgress: ({ attempt, added, discovered }) => {
            for (const item of added) {
              send({
                type: 'candidate_found',
                candidate: buildCandidateProfile(item, null),
                totals: { discovered: discovered.length }
              });
            }
            send({ type: 'attempt_updated', attempt, totals: { discovered: discovered.length } });
          }
        });

        const profileItems = discovered.slice(0, maxCandidates);
        if (!profileItems.length) {
          pushWarning('Markidy profile search returned no candidates after AI-planned broadening attempts.');
        }

        send({ type: 'phase', message: 'Scoring possible fit with AI.' });
        for (const item of profileItems) {
          if (cancelled) break;
          send({
            type: 'candidate_evaluating',
            userId: item.userId,
            totals: { discovered: discovered.length, evaluated: candidates.length }
          });

          let detail = null;
          try {
            detail = await client.getProfile(item.userId);
          } catch (error) {
            pushWarning(`Could not fetch profile detail for ${item.userId}.`);
          }

          const profile = await enrichCandidateLinks(buildCandidateProfile(item, detail), {
            onRateLimited: handleRateLimited
          });
          const objective = evaluateObjectiveFit(workflow, profile);
          const evaluation = await evaluateCandidate(aiConfig, workflow, profile, objective);
          const candidate = { ...profile, evaluation };
          candidates.push(candidate);
          candidates.sort((a, b) => b.evaluation.fitScore - a.evaluation.fitScore);

          send({
            type: 'candidate_evaluated',
            candidate,
            totals: { discovered: discovered.length, evaluated: candidates.length }
          });
        }

        const result: FitRunResult = {
          generatedAt,
          candidates,
          searchAttempts,
          totals: {
            discovered: discovered.length,
            evaluated: candidates.length,
            searchAttempts: searchAttempts.length
          },
          warnings
        };

        send({ type: 'done', result });
      } catch (error) {
        send({ type: 'error', message: errorMessage(error, 'Candidate search failed.') });
      } finally {
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no'
    }
  });
}

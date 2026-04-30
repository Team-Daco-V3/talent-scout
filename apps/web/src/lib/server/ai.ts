import { candidateText } from '$lib/fit/objective';
import { getAiProviderPreset, type AiProviderId } from '$lib/ai/providers';
import { fetchWithRateLimitRetry, type RateLimitRetryHandler } from '$lib/server/rate-limit';
import type {
  CandidateEvaluation,
  CandidateProfile,
  HiringWorkflow,
  ObjectiveAssessment,
  Recommendation
} from '$lib/fit/types';

export interface AiConfig {
  provider: AiProviderId;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  onRateLimited?: RateLimitRetryHandler;
  rateLimitLabel?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: OpenAiMessageContent;
    };
  }>;
}

type OpenAiMessageContent = string | Array<{ type?: string; text?: string }> | undefined;

interface AnthropicResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

const evaluatorSystemPrompt =
  'You are a recruiting research assistant. Return only valid JSON matching the requested output contract.';

const roleFitRules = [
  'Treat company.roleSummary as the primary role-fit criterion.',
  'Use company.idealCandidate and objectiveCriteria as supporting constraints.',
  'Reward public evidence that the candidate has done similar work or adjacent work.',
  'Penalize title-only matches when the candidate profile does not show relevant work for the role summary.',
  'Do not overfit on exact title wording when the candidate evidence matches the role summary.',
  'Write the summary in concern-first, strength-last order.',
  'The summary must start with the most important limitation, mismatch, or uncertainty, then end with the best relevant strength or transferable signal.',
  'Do not end the summary with a negative sentence, even for weak-fit candidates.'
];

function clampScore(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 50;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function normalizeRecommendation(value: unknown, score: number): Recommendation {
  if (value === 'strong_fit' || value === 'possible_fit' || value === 'weak_fit') return value;
  if (score >= 85) return 'strong_fit';
  if (score >= 65) return 'possible_fit';
  return 'weak_fit';
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, 8);
}

function sanitizeEvaluation(value: Record<string, unknown>, fallback: CandidateEvaluation): CandidateEvaluation {
  const fitScore = clampScore(value.fitScore ?? value.score ?? fallback.fitScore);
  return {
    summary: String(value.summary ?? fallback.summary).slice(0, 700),
    fitScore,
    recommendation: normalizeRecommendation(value.recommendation, fitScore),
    objectiveMatches: stringArray(value.objectiveMatches).length
      ? stringArray(value.objectiveMatches)
      : fallback.objectiveMatches,
    objectiveMisses: stringArray(value.objectiveMisses).length
      ? stringArray(value.objectiveMisses)
      : fallback.objectiveMisses,
    fitReasons: stringArray(value.fitReasons).length
      ? stringArray(value.fitReasons)
      : fallback.fitReasons,
    risks: Array.isArray(value.risks) ? stringArray(value.risks) : fallback.risks
  };
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) return null;
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      return null;
    }
  }
}

function normalizeBaseUrl(baseUrl?: string): string {
  const value = (baseUrl || 'https://api.openai.com/v1').trim().replace(/\/$/, '');
  return value.endsWith('/v1') ? value : `${value}/v1`;
}

function normalizeGeminiBaseUrl(baseUrl?: string): string {
  const value = (baseUrl || 'https://generativelanguage.googleapis.com/v1beta').trim().replace(/\/$/, '');
  return value.endsWith('/v1beta') || value.endsWith('/v1') ? value : `${value}/v1beta`;
}

function modelPath(model: string): string {
  const normalized = model.startsWith('models/') ? model : `models/${model}`;
  return normalized.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function openAiContentText(content: OpenAiMessageContent): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (part?.type === 'text' || !part?.type ? part.text || '' : ''))
    .join('');
}

function anthropicContentText(data: AnthropicResponse): string {
  return (data.content || [])
    .map((part) => (part.type === 'text' || !part.type ? part.text || '' : ''))
    .join('');
}

function geminiContentText(data: GeminiResponse): string {
  return (data.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || '')
    .join('');
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function aiRateLimitOptions(config: AiConfig, fallbackLabel: string) {
  return {
    label: config.rateLimitLabel || fallbackLabel,
    maxRetries: 4,
    baseDelayMs: 2000,
    maxDelayMs: 45_000,
    onRateLimited: config.onRateLimited
  };
}

async function generateOpenAiCompatibleJson(
  config: AiConfig,
  prompt: string,
  systemPrompt: string,
  defaultBaseUrl: string,
  defaultModel: string,
  maxTokens: number
): Promise<Record<string, unknown>> {
  const res = await fetchWithRateLimitRetry(
    `${normalizeBaseUrl(config.baseUrl || defaultBaseUrl)}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model || defaultModel,
        temperature: 0.1,
        max_tokens: maxTokens,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    },
    aiRateLimitOptions(config, 'AI request')
  );

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    throw new Error(errorBody?.error?.message || errorBody?.error || `AI request failed with ${res.status}`);
  }

  const data = (await res.json()) as ChatCompletionResponse;
  const parsed = extractJsonObject(openAiContentText(data.choices?.[0]?.message?.content));
  if (!parsed) throw new Error('AI returned non-JSON content');
  return parsed;
}

async function generateAnthropicJson(
  config: AiConfig,
  prompt: string,
  systemPrompt: string,
  defaultBaseUrl: string,
  defaultModel: string,
  maxTokens: number
): Promise<Record<string, unknown>> {
  const res = await fetchWithRateLimitRetry(
    `${normalizeBaseUrl(config.baseUrl || defaultBaseUrl)}/messages`,
    {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey?.trim() || '',
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model || defaultModel,
        max_tokens: maxTokens,
        temperature: 0.1,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    },
    aiRateLimitOptions(config, 'AI request')
  );

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    throw new Error(errorBody?.error?.message || errorBody?.error || `AI request failed with ${res.status}`);
  }

  const data = (await res.json()) as AnthropicResponse;
  const parsed = extractJsonObject(anthropicContentText(data));
  if (!parsed) throw new Error('AI returned non-JSON content');
  return parsed;
}

async function generateGeminiJson(
  config: AiConfig,
  prompt: string,
  systemPrompt: string,
  defaultBaseUrl: string,
  defaultModel: string,
  maxTokens: number
): Promise<Record<string, unknown>> {
  const model = config.model || defaultModel;
  const endpoint = `${normalizeGeminiBaseUrl(config.baseUrl || defaultBaseUrl)}/${modelPath(
    model
  )}:generateContent?key=${encodeURIComponent(config.apiKey?.trim() || '')}`;

  const res = await fetchWithRateLimitRetry(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: maxTokens,
          responseMimeType: 'application/json'
        }
      })
    },
    aiRateLimitOptions(config, 'AI request')
  );

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    throw new Error(errorBody?.error?.message || errorBody?.error || `AI request failed with ${res.status}`);
  }

  const data = (await res.json()) as GeminiResponse;
  const parsed = extractJsonObject(geminiContentText(data));
  if (!parsed) throw new Error('AI returned non-JSON content');
  return parsed;
}

export async function generateStructuredJson(
  config: AiConfig,
  prompt: string,
  systemPrompt = evaluatorSystemPrompt,
  maxTokens = 1200
): Promise<Record<string, unknown>> {
  const provider = getAiProviderPreset(config.provider);
  if (!config.apiKey?.trim()) {
    throw new Error('AI API key is required.');
  }

  if (provider.adapter === 'anthropic') {
    return generateAnthropicJson(
      config,
      prompt,
      systemPrompt,
      provider.defaultBaseUrl,
      provider.defaultModel,
      maxTokens
    );
  }

  if (provider.adapter === 'gemini') {
    return generateGeminiJson(config, prompt, systemPrompt, provider.defaultBaseUrl, provider.defaultModel, maxTokens);
  }

  return generateOpenAiCompatibleJson(
    config,
    prompt,
    systemPrompt,
    provider.defaultBaseUrl,
    provider.defaultModel,
    maxTokens
  );
}

export function fallbackEvaluateCandidate(
  workflow: HiringWorkflow,
  candidate: CandidateProfile,
  objective: ObjectiveAssessment,
  warning?: string
): CandidateEvaluation {
  const score = clampScore(objective.score - Math.max(0, objective.misses.length - 1) * 6);
  const concern = objective.misses[0] || 'Public information may still require manual review.';
  const strength =
    objective.matches[0] ||
    (candidate.bioSnippet ? `the profile shows ${candidate.bioSnippet.slice(0, 150)}` : '') ||
    (candidate.desiredRoles.length ? `desired roles include ${candidate.desiredRoles.join(', ')}` : '') ||
    'there are public Markidy profile signals worth reviewing';
  const reasons = [
    candidate.bioSnippet ? `Profile says: ${candidate.bioSnippet.slice(0, 150)}` : '',
    candidate.desiredRoles.length ? `Desired roles include ${candidate.desiredRoles.join(', ')}.` : '',
    objective.matches[0] || ''
  ].filter(Boolean);

  return {
    summary: `${candidate.name} has a fit concern: ${concern} However, ${strength.replace(/\.$/, '')}.`,
    fitScore: score,
    recommendation: normalizeRecommendation(null, score),
    objectiveMatches: objective.matches,
    objectiveMisses: objective.misses,
    fitReasons: reasons.length ? reasons : ['Not enough public fit evidence; review manually.'],
    risks: [warning ? `AI fallback used: ${warning}` : ''].filter(Boolean)
  };
}

function buildPrompt(
  workflow: HiringWorkflow,
  candidate: CandidateProfile,
  objective: ObjectiveAssessment
): string {
  const detail = recordFrom(candidate.detail);
  return JSON.stringify(
    {
      task: 'Evaluate candidate fit for recruiting sourcing. This is advisory only, not a hiring decision.',
      outputContract: {
        summary:
          'short neutral summary. Start with the biggest concern or mismatch, then end with the best relevant strength. Do not end negatively.',
        fitScore: 'integer 0-100',
        recommendation: 'strong_fit | possible_fit | weak_fit',
        objectiveMatches: [
          'specific public facts matching objective criteria, including matched skill names, work mode, country, experience, or link evidence'
        ],
        objectiveMisses: ['specific missing or mismatching objective criteria'],
        fitReasons: ['why the candidate may fit the role summary or ideal candidate notes'],
        risks: [
          'material risks only, such as conflicting public evidence or serious uncertainty not already listed in objectiveMisses. Return [] when there is no distinct risk.'
        ]
      },
      safetyRules: [
        'Do not make or imply final hiring decisions.',
        'Do not mention protected classes or infer sensitive traits.',
        'Do not ask for sensitive personal information.',
        'Do not confirm compensation, contracts, employment, or interviews.',
        'Use only job-related public profile signals.',
        'Treat linkInsights as public URLs extracted from the full profile detail response; fieldPath explains where each link came from.'
      ],
      scoringRules: roleFitRules,
      riskRules: [
        'Do not put every mismatch into risks.',
        'Use objectiveMisses for simple gaps against selected filters.',
        'Use risks only for material uncertainty, conflicting evidence, stale/unclear public data, or review concerns.',
        'Return an empty risks array when there is no distinct risk.'
      ],
      company: workflow.company,
      objectiveCriteria: workflow.objective,
      objectiveAssessment: objective,
      candidate: {
        userId: candidate.userId,
        source: candidate.source,
        name: candidate.name,
        country: candidate.country,
        verifiedLevel: candidate.verifiedLevel,
        desiredRoles: candidate.desiredRoles,
        recruitingSummary: candidate.recruitingSummary,
        socialLinks: detail.socialLinks,
        trustLinks: detail.trustLinks,
        publicLinks: candidate.linkInsights,
        linkInsights: candidate.linkInsights,
        topCareer: candidate.topCareer,
        publicProfileText: candidateText(candidate).slice(0, 5000)
      }
    },
    null,
    2
  );
}

async function evaluateOpenAiCompatible(
  config: AiConfig,
  prompt: string,
  fallback: CandidateEvaluation,
  defaultBaseUrl: string,
  defaultModel: string
): Promise<CandidateEvaluation> {
  const res = await fetchWithRateLimitRetry(
    `${normalizeBaseUrl(config.baseUrl || defaultBaseUrl)}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model || defaultModel,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: evaluatorSystemPrompt
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    },
    aiRateLimitOptions(config, 'AI candidate evaluation')
  );

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    throw new Error(errorBody?.error?.message || errorBody?.error || `AI request failed with ${res.status}`);
  }

  const data = (await res.json()) as ChatCompletionResponse;
  const content = openAiContentText(data.choices?.[0]?.message?.content);
  const parsed = extractJsonObject(content);
  if (!parsed) throw new Error('AI returned non-JSON content');

  return sanitizeEvaluation(parsed, fallback);
}

async function evaluateAnthropic(
  config: AiConfig,
  prompt: string,
  fallback: CandidateEvaluation,
  defaultBaseUrl: string,
  defaultModel: string
): Promise<CandidateEvaluation> {
  const res = await fetchWithRateLimitRetry(
    `${normalizeBaseUrl(config.baseUrl || defaultBaseUrl)}/messages`,
    {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey?.trim() || '',
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model || defaultModel,
        max_tokens: 1200,
        temperature: 0.2,
        system: evaluatorSystemPrompt,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    },
    aiRateLimitOptions(config, 'AI candidate evaluation')
  );

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    throw new Error(errorBody?.error?.message || errorBody?.error || `AI request failed with ${res.status}`);
  }

  const data = (await res.json()) as AnthropicResponse;
  const parsed = extractJsonObject(anthropicContentText(data));
  if (!parsed) throw new Error('AI returned non-JSON content');

  return sanitizeEvaluation(parsed, fallback);
}

async function evaluateGemini(
  config: AiConfig,
  prompt: string,
  fallback: CandidateEvaluation,
  defaultBaseUrl: string,
  defaultModel: string
): Promise<CandidateEvaluation> {
  const model = config.model || defaultModel;
  const endpoint = `${normalizeGeminiBaseUrl(config.baseUrl || defaultBaseUrl)}/${modelPath(
    model
  )}:generateContent?key=${encodeURIComponent(config.apiKey?.trim() || '')}`;

  const res = await fetchWithRateLimitRetry(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: evaluatorSystemPrompt }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json'
        }
      })
    },
    aiRateLimitOptions(config, 'AI candidate evaluation')
  );

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    throw new Error(errorBody?.error?.message || errorBody?.error || `AI request failed with ${res.status}`);
  }

  const data = (await res.json()) as GeminiResponse;
  const parsed = extractJsonObject(geminiContentText(data));
  if (!parsed) throw new Error('AI returned non-JSON content');

  return sanitizeEvaluation(parsed, fallback);
}

export async function evaluateCandidate(
  config: AiConfig,
  workflow: HiringWorkflow,
  candidate: CandidateProfile,
  objective: ObjectiveAssessment
): Promise<CandidateEvaluation> {
  const fallback = fallbackEvaluateCandidate(workflow, candidate, objective);
  const provider = getAiProviderPreset(config.provider);
  if (!config.apiKey?.trim()) {
    return fallback;
  }

  try {
    const prompt = buildPrompt(workflow, candidate, objective);

    if (provider.adapter === 'anthropic') {
      return await evaluateAnthropic(
        config,
        prompt,
        fallback,
        provider.defaultBaseUrl,
        provider.defaultModel
      );
    }

    if (provider.adapter === 'gemini') {
      return await evaluateGemini(config, prompt, fallback, provider.defaultBaseUrl, provider.defaultModel);
    }

    return await evaluateOpenAiCompatible(config, prompt, fallback, provider.defaultBaseUrl, provider.defaultModel);
  } catch (error) {
    return fallbackEvaluateCandidate(
      workflow,
      candidate,
      objective,
      error instanceof Error ? error.message : 'Unknown AI error'
    );
  }
}

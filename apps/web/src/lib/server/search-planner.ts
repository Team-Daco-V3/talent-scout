import { isWorkMode } from '$lib/fit/options';
import { generateStructuredJson, type AiConfig } from '$lib/server/ai';
import type { CandidateSearchAttempt, HiringWorkflow } from '$lib/fit/types';

const defaultSearchAttemptsLimit = 6;
const minSearchAttemptsLimit = 1;
const maxSearchAttemptsLimit = 10;

function cleanText(value: unknown, maxLength = 80): string {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanList(value: unknown, maxItems = 6): string[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return [
    ...new Set(
      items
        .map((item) => cleanText(item))
        .filter((item) => item.length > 0)
        .slice(0, maxItems)
    )
  ];
}

function userMinExperienceMonths(workflow: HiringWorkflow): number | null {
  return workflow.objective.minExperienceYears && workflow.objective.minExperienceYears > 0
    ? workflow.objective.minExperienceYears * 12
    : null;
}

function queryFrom(parts: string[]): string | undefined {
  const query = parts.map((part) => cleanText(part, 240)).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return query || undefined;
}

function roleSynonymsFor(term: string): string[] {
  const normalized = term.toLowerCase();
  const synonyms: string[] = [];

  if (/full[-\s]?stack/.test(normalized)) {
    synonyms.push('full-stack developer', 'full stack developer', 'software developer');
  }
  if (/back[-\s]?end/.test(normalized)) {
    synonyms.push('backend developer', 'server-side developer');
  }
  if (/front[-\s]?end/.test(normalized)) {
    synonyms.push('frontend developer', 'web developer');
  }
  if (/software\s+engineer/.test(normalized)) {
    synonyms.push('software developer', 'programmer');
  }
  if (/\bengineer\b/.test(normalized)) {
    synonyms.push('developer', 'software developer');
  }
  if (/\bdeveloper\b/.test(normalized)) {
    synonyms.push('engineer', 'software engineer');
  }
  if (/\bprogrammer\b/.test(normalized)) {
    synonyms.push('developer', 'software engineer');
  }

  return synonyms;
}

function roleSeedTerms(workflow: HiringWorkflow): string[] {
  const userRoles = workflow.objective.roles;
  return userRoles.length ? userRoles : [workflow.company.roleSummary];
}

function expandedRoleSearchTerms(workflow: HiringWorkflow): string[] {
  const baseTerms = roleSeedTerms(workflow);
  const expanded = baseTerms.flatMap((term) => [
    ...(workflow.objective.roles.includes(term) ? [term] : []),
    ...roleSynonymsFor(term)
  ]);
  return [
    ...new Set(
      expanded
        .map((term) => cleanText(term, 48))
        .filter(Boolean)
    )
  ].slice(0, 8);
}

function roleSynonymSearchTerms(workflow: HiringWorkflow): string[] {
  const baseTerms = roleSeedTerms(workflow);
  const original = new Set(workflow.objective.roles.map((term) => cleanText(term, 48).toLowerCase()).filter(Boolean));
  const synonyms = baseTerms.flatMap((term) => roleSynonymsFor(term));

  return [
    ...new Set(
      synonyms
        .map((term) => cleanText(term, 48))
        .filter((term) => term && !original.has(term.toLowerCase()))
    )
  ].slice(0, 6);
}

function attemptKey(attempt: CandidateSearchAttempt): string {
  return JSON.stringify({
    q: attempt.q || '',
    roles: attempt.roles,
    skills: attempt.skills,
    countries: attempt.countries,
    workModes: attempt.workModes,
    locations: attempt.locations,
    minExperienceMonths: attempt.minExperienceMonths
  });
}

function uniqueAttempts(attempts: CandidateSearchAttempt[]): CandidateSearchAttempt[] {
  const seen = new Set<string>();
  const unique: CandidateSearchAttempt[] = [];
  const limit = defaultSearchAttemptsLimit;

  for (const attempt of attempts) {
    const key = attemptKey(attempt);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...attempt, id: `search-${unique.length + 1}` });
    if (unique.length >= limit) break;
  }

  return unique;
}

function clampSearchAttemptsLimit(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return defaultSearchAttemptsLimit;
  return Math.max(minSearchAttemptsLimit, Math.min(maxSearchAttemptsLimit, Math.round(numeric)));
}

function limitAttempts(attempts: CandidateSearchAttempt[], limit: number): CandidateSearchAttempt[] {
  const seen = new Set<string>();
  const unique: CandidateSearchAttempt[] = [];

  for (const attempt of attempts) {
    const key = attemptKey(attempt);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...attempt, id: `search-${unique.length + 1}` });
    if (unique.length >= limit) break;
  }

  return unique;
}

function createAttempt(
  workflow: HiringWorkflow,
  input: Partial<CandidateSearchAttempt>,
  strategy: CandidateSearchAttempt['strategy'],
  index: number
): CandidateSearchAttempt {
  const userCountries = workflow.objective.countries;
  const userWorkModes = workflow.objective.workModes;
  const userLocations = workflow.objective.locations;
  const maxMonths = userMinExperienceMonths(workflow);
  const requestedMonths = Number(input.minExperienceMonths);
  const minExperienceMonths =
    maxMonths && Number.isFinite(requestedMonths)
      ? Math.max(0, Math.min(maxMonths, Math.round(requestedMonths)))
      : null;

  return {
    id: `search-${index}`,
    label: cleanText(input.label, 48) || (strategy === 'ai_planned' ? 'AI planned search' : 'Broadened search'),
    strategy,
    q: cleanText(input.q, 240) || undefined,
    roles: cleanList(input.roles),
    skills: cleanList(input.skills),
    countries: cleanList(input.countries).filter((country) => userCountries.includes(country)),
    workModes: cleanList(input.workModes)
      .map((item) => item.toLowerCase())
      .filter((mode) => isWorkMode(mode) && userWorkModes.includes(mode)),
    locations: cleanList(input.locations).filter((location) => userLocations.includes(location)),
    minExperienceMonths: minExperienceMonths && minExperienceMonths > 0 ? minExperienceMonths : null,
    reason: cleanText(input.reason, 180) || 'Search candidates from Markidy profiles.',
    resultCount: 0
  };
}

export function buildFallbackSearchAttempts(workflow: HiringWorkflow): CandidateSearchAttempt[] {
  const roles = workflow.objective.roles;
  const skills = workflow.objective.skills;
  const countries = workflow.objective.countries;
  const workModes = workflow.objective.workModes;
  const locations = workflow.objective.locations;
  const minExperienceMonths = userMinExperienceMonths(workflow);
  const roleSummary = workflow.company.roleSummary;
  const coreSkill = skills[0] || '';
  const roleSearchTerms = expandedRoleSearchTerms(workflow);
  const roleSynonymTerms = roleSynonymSearchTerms(workflow);
  const coreRole = roles[0] || roleSynonymTerms[0] || '';

  return uniqueAttempts([
    createAttempt(
      workflow,
      {
        label: 'Exact fit search',
        q: queryFrom([
          roleSummary,
          roles.slice(0, 3).join(' '),
          skills.slice(0, 4).join(' ')
        ]),
        roles,
        skills,
        countries,
        workModes,
        locations,
        minExperienceMonths,
        reason: 'Start with all user-provided search filters.'
      },
      'fallback',
      1
    ),
    createAttempt(
      workflow,
      {
        label: 'Role synonym search',
        q: queryFrom([roleSummary, roleSynonymTerms.join(' '), skills.slice(0, 3).join(' ')]),
        roles: [],
        skills: skills.slice(0, 3),
        countries,
        workModes,
        locations,
        minExperienceMonths,
        reason: 'Search equivalent role wording such as engineer, developer, software developer, or programmer.'
      },
      'broadened',
      2
    ),
    createAttempt(
      workflow,
      {
        label: 'Remove location filters',
        q: queryFrom([
          roleSummary,
          roles.slice(0, 2).join(' '),
          roleSearchTerms.join(' '),
          skills.slice(0, 2).join(' ')
        ]),
        roles: roles.slice(0, 2),
        skills: skills.slice(0, 3),
        minExperienceMonths,
        reason: 'Keep role and skill intent, but remove country, work mode, and location filters.'
      },
      'broadened',
      3
    ),
    createAttempt(
      workflow,
      {
        label: 'Role-first search',
        q: queryFrom([roleSummary, coreRole, roleSearchTerms.join(' ')]),
        roles: [],
        skills: coreSkill ? [coreSkill] : [],
        reason: 'Use the target role with only the strongest skill signal.'
      },
      'broadened',
      4
    ),
    createAttempt(
      workflow,
      {
        label: 'Skill-first search',
        q: queryFrom(skills.slice(0, 3)),
        skills: skills.slice(0, 3),
        reason: 'Find people with related skill signals even if role wording differs.'
      },
      'broadened',
      5
    ),
    createAttempt(
      workflow,
      {
        label: 'Broad discovery search',
        q: queryFrom([roleSummary, roleSearchTerms.join(' ')]),
        reason: 'Final broad search to fill the review pool with potentially adjacent candidates.'
      },
      'broadened',
      6
    )
  ]);
}

function plannerPrompt(workflow: HiringWorkflow): string {
  return JSON.stringify(
    {
      task: 'Create a sequence of Markidy profile search API requests for an AI talent finder.',
      apiTool: {
        name: 'markidy.profiles.search',
        supportedParams: [
          'q',
          'roles',
          'skills',
          'countries',
          'workModes',
          'locations',
          'minExperienceMonths'
        ]
      },
      outputContract: {
        attempts: [
          {
            label: 'short label',
            q: 'search text or empty string',
            roles: ['role terms'],
            skills: ['skill terms'],
            countries: ['only selected country codes, or empty'],
            workModes: ['only selected work modes, or empty'],
            locations: ['only selected locations, or empty'],
            minExperienceMonths: 'number no higher than requested, or null',
            reason: 'why this request is useful'
          }
        ]
      },
      planningRules: [
        'Treat workflow.company.roleSummary as the primary description of the work this person should fit.',
        `Return up to ${clampSearchAttemptsLimit(workflow.search.searchAttemptsLimit)} attempts, ordered from strict to broad.`,
        'The first attempt may use most user-provided filters.',
        'Later attempts should remove optional filters when results may be too narrow.',
        'Use q for synonyms and adjacent role wording instead of inventing unsupported enum values.',
        'Always include common job-title synonyms in q when relevant, such as engineer/developer/software developer/programmer.',
        'Do not add countries, work modes, or locations that the user did not select.',
        'Do not use protected classes, sensitive traits, or non-job-related criteria.',
        'This is sourcing research only, not a hiring decision.'
      ],
      workflow
    },
    null,
    2
  );
}

function attemptsFromAiPlan(plan: Record<string, unknown>, workflow: HiringWorkflow): CandidateSearchAttempt[] {
  const attempts = Array.isArray(plan.attempts) ? plan.attempts : [];
  return attempts
    .map((attempt, index) =>
      createAttempt(
        workflow,
        typeof attempt === 'object' && attempt !== null ? (attempt as Partial<CandidateSearchAttempt>) : {},
        'ai_planned',
        index + 1
      )
    )
    .filter((attempt) => attempt.q || attempt.roles.length || attempt.skills.length);
}

export async function planCandidateSearch(
  config: AiConfig,
  workflow: HiringWorkflow,
  warnings: string[]
): Promise<CandidateSearchAttempt[]> {
  const attemptsLimit = clampSearchAttemptsLimit(workflow.search.searchAttemptsLimit);
  const fallbackAttempts = buildFallbackSearchAttempts(workflow);

  try {
    const aiPlan = await generateStructuredJson(
      { ...config, rateLimitLabel: 'AI search planner' },
      plannerPrompt(workflow),
      'You plan safe recruiting sourcing API requests. Return only valid JSON.',
      1400
    );
    const aiAttempts = attemptsFromAiPlan(aiPlan, workflow);
    if (!aiAttempts.length) {
      warnings.push('AI search planner returned no usable attempts; fallback search was used.');
    }
    return limitAttempts([...fallbackAttempts.slice(0, 2), ...aiAttempts, ...fallbackAttempts.slice(2)], attemptsLimit);
  } catch (error) {
    warnings.push(
      `AI search planner failed; fallback search was used. ${
        error instanceof Error ? error.message : 'Unknown planner error.'
      }`
    );
    return limitAttempts(fallbackAttempts, attemptsLimit);
  }
}

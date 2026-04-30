import type {
  CandidateProfile,
  HiringWorkflow,
  MarkidyProfileDetail,
  MarkidyProfileSearchItem,
  ObjectiveAssessment
} from './types';

function stripHtml(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalize(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.+#\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function arrayFromUnknown(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function getNestedStringArray(...values: unknown[]): string[] {
  for (const value of values) {
    const arr = arrayFromUnknown(value);
    if (arr.length) return arr;
  }
  return [];
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function matchingItems(haystack: string, needles: string[]): string[] {
  const normalizedHaystack = normalize(haystack);
  return needles.filter((needle) => normalizedHaystack.includes(normalize(needle)));
}

function formatList(items: string[]): string {
  return items.filter(Boolean).join(', ');
}

export function buildCandidateProfile(
  item: MarkidyProfileSearchItem,
  detail: MarkidyProfileDetail | null,
  appBaseUrl = 'https://markidy.com'
): CandidateProfile {
  const detailRecord = getRecord(detail);
  const recruitingSummary = getRecord(item.recruitingSummary ?? detailRecord.recruitingSummary ?? null);
  const userId = item.userId || String(detailRecord.userId ?? detailRecord.id ?? '');
  const detailName = String(detailRecord.name ?? detailRecord.displayName ?? '').trim();
  const itemName = String(item.name ?? item.displayName ?? '').trim();

  return {
    userId,
    source: 'profile_search',
    sourceLabel: 'Profile search',
    name: itemName || detailName || 'Unknown',
    avatar: item.avatar ?? (typeof detailRecord.avatar === 'string' ? detailRecord.avatar : null),
    country: String(item.country ?? detailRecord.country ?? ''),
    verifiedLevel: Number(item.verifiedLevel ?? detailRecord.verifiedLevel ?? 0),
    bioSnippet:
      item.bioSnippet ||
      stripHtml(detailRecord.bio) ||
      stripHtml(detailRecord.description),
    topCareer: item.topCareer ?? null,
    desiredRoles: item.desiredRoles || arrayFromUnknown(recruitingSummary.desiredRoles),
    recruitingSummary: Object.keys(recruitingSummary).length ? recruitingSummary : null,
    detail,
    profileUrl: `${appBaseUrl.replace(/\/$/, '')}/profile/${encodeURIComponent(userId)}`
  };
}

export function candidateText(candidate: CandidateProfile): string {
  const detailRecord = getRecord(candidate.detail);
  const recruitingSummary = getRecord(candidate.recruitingSummary);
  const recruitingPreferences = getRecord(detailRecord.recruitingPreferences);
  const careers = Array.isArray(detailRecord.careers) ? detailRecord.careers : [];
  const socialLinks = getRecord(detailRecord.socialLinks);
  const trustLinks = detailRecord.trustLinks;
  return [
    candidate.name,
    candidate.country,
    candidate.bioSnippet,
    formatList(candidate.desiredRoles),
    formatList(arrayFromUnknown(recruitingSummary.skills)),
    formatList(arrayFromUnknown(recruitingSummary.desiredRoles)),
    formatList(arrayFromUnknown(recruitingPreferences.skills)),
    formatList(arrayFromUnknown(recruitingPreferences.targetRoles)),
    JSON.stringify(socialLinks),
    JSON.stringify(trustLinks ?? ''),
    JSON.stringify(candidate.linkInsights ?? []),
    JSON.stringify(candidate.topCareer ?? ''),
    JSON.stringify(careers.slice(0, 3))
  ]
    .filter(Boolean)
    .join(' ');
}

export function getCandidateExperienceMonths(candidate: CandidateProfile): number | null {
  const summary = getRecord(candidate.recruitingSummary);
  const detail = getRecord(candidate.detail);
  const candidates = [
    summary.careerTotalMonths,
    summary.experienceMonths,
    detail.careerTotalMonths,
    detail.experienceMonths
  ];

  for (const value of candidates) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  }
  return null;
}

export function evaluateObjectiveFit(
  workflow: HiringWorkflow,
  candidate: CandidateProfile
): ObjectiveAssessment {
  const matches: string[] = [];
  const misses: string[] = [];
  const text = candidateText(candidate);
  const summary = getRecord(candidate.recruitingSummary);
  const detail = getRecord(candidate.detail);
  const preferences = getRecord(detail.recruitingPreferences);

  const minExperienceMonths = workflow.objective.minExperienceYears
    ? workflow.objective.minExperienceYears * 12
    : null;
  const candidateExperience = getCandidateExperienceMonths(candidate);
  if (minExperienceMonths) {
    if (candidateExperience === null) {
      misses.push(`Experience is not public; target is ${workflow.objective.minExperienceYears} years or more.`);
    } else if (candidateExperience >= minExperienceMonths) {
      matches.push(
        `Public experience is about ${Math.floor(candidateExperience / 12)} years, meeting the ${workflow.objective.minExperienceYears}+ year target.`
      );
    } else {
      misses.push(
        `Public experience is about ${Math.floor(candidateExperience / 12)} years, below the ${workflow.objective.minExperienceYears}+ year target.`
      );
    }
  }

  if (workflow.objective.countries.length) {
    if (workflow.objective.countries.some((country) => normalize(country) === normalize(candidate.country))) {
      matches.push(`Country is ${candidate.country}, matching selected country filter.`);
    } else {
      misses.push(`Country is ${candidate.country || 'unknown'}, target is ${formatList(workflow.objective.countries)}.`);
    }
  }

  if (workflow.objective.roles.length) {
    const roleText = [
      text,
      formatList(candidate.desiredRoles),
      formatList(arrayFromUnknown(summary.desiredRoles)),
      formatList(arrayFromUnknown(preferences.targetRoles))
    ].join(' ');
    const matchedRoles = matchingItems(roleText, workflow.objective.roles);
    if (matchedRoles.length) {
      matches.push(`Role signal mentions ${formatList(matchedRoles)} in public profile or preferences.`);
    } else {
      misses.push(`No clear role signal for ${formatList(workflow.objective.roles)}.`);
    }
  }

  if (workflow.objective.skills.length) {
    const matchedSkills = matchingItems(text, workflow.objective.skills);
    if (matchedSkills.length) {
      matches.push(`Public profile includes selected skills: ${formatList(matchedSkills)}.`);
    } else {
      misses.push(`No clear skill signal for ${formatList(workflow.objective.skills)}.`);
    }
  }

  const workModes = getNestedStringArray(
    summary.workMode,
    summary.workModes,
    preferences.workMode,
    preferences.workModes
  );
  if (workflow.objective.workModes.length) {
    const workText = formatList(workModes);
    const matchedWorkModes = matchingItems(workText, workflow.objective.workModes);
    if (matchedWorkModes.length) {
      matches.push(`Public work mode includes ${formatList(matchedWorkModes)}.`);
    } else {
      misses.push(`Work mode is ${workText || 'unknown'}, target is ${formatList(workflow.objective.workModes)}.`);
    }
  }

  const score = Math.max(0, Math.min(100, 100 - misses.length * 18 + Math.min(matches.length, 5) * 2));

  return { score, matches, misses };
}

import type { CandidateSearchAttempt, MarkidyProfileSearchItem } from '$lib/fit/types';
import type { MarkidyApiClient } from '$lib/server/markidy-api';

type SearchProgress = {
  attempt: CandidateSearchAttempt;
  added: MarkidyProfileSearchItem[];
  discovered: MarkidyProfileSearchItem[];
};

type DiscoverProfilesOptions = {
  client: MarkidyApiClient;
  searchAttempts: CandidateSearchAttempt[];
  maxCandidates: number;
  shouldStop?: () => boolean;
  onProgress?: (progress: SearchProgress) => void | Promise<void>;
};

function appendUniqueProfiles(
  target: MarkidyProfileSearchItem[],
  seen: Set<string>,
  items: MarkidyProfileSearchItem[],
  maxAdd: number
): MarkidyProfileSearchItem[] {
  const added: MarkidyProfileSearchItem[] = [];
  for (const item of items) {
    if (added.length >= maxAdd) break;
    if (!item.userId || seen.has(item.userId)) continue;
    seen.add(item.userId);
    target.push(item);
    added.push(item);
  }
  return added;
}

async function runSearchAttempt(
  options: DiscoverProfilesOptions & {
    attempt: CandidateSearchAttempt;
    discovered: MarkidyProfileSearchItem[];
    seenProfileIds: Set<string>;
    maxAdd: number;
    maxPages: number;
  }
): Promise<void> {
  const {
    client,
    attempt,
    discovered,
    seenProfileIds,
    maxCandidates,
    maxAdd,
    maxPages,
    shouldStop,
    onProgress
  } = options;

  let page = 1;
  let addedForAttempt = 0;
  let pagesRead = 0;

  while (
    discovered.length < maxCandidates &&
    addedForAttempt < maxAdd &&
    pagesRead < maxPages &&
    !shouldStop?.()
  ) {
    const remainingAdd = Math.min(maxAdd - addedForAttempt, maxCandidates - discovered.length);
    if (remainingAdd <= 0) break;

    const response = await client.searchProfiles({
      q: attempt.q || undefined,
      roles: attempt.roles,
      skills: attempt.skills,
      country: attempt.countries,
      workMode: attempt.workModes,
      location: attempt.locations,
      minExperienceMonths: attempt.minExperienceMonths,
      page,
      pageSize: Math.min(50, Math.max(remainingAdd, 10))
    });

    pagesRead += 1;

    const added = appendUniqueProfiles(
      discovered,
      seenProfileIds,
      response.profiles,
      Math.min(remainingAdd, maxCandidates - discovered.length)
    );

    addedForAttempt += added.length;
    attempt.resultCount += added.length;

    await onProgress?.({ attempt, added, discovered });

    if (!response.profiles.length || page * response.pageSize >= response.total) break;
    page += 1;
  }
}

export async function discoverProfileCandidates({
  client,
  searchAttempts,
  maxCandidates,
  shouldStop,
  onProgress
}: DiscoverProfilesOptions): Promise<MarkidyProfileSearchItem[]> {
  const discovered: MarkidyProfileSearchItem[] = [];
  const seenProfileIds = new Set<string>();
  const coverageLimit = Math.max(1, Math.ceil(maxCandidates / Math.max(searchAttempts.length, 1)));

  for (const attempt of searchAttempts) {
    if (discovered.length >= maxCandidates || shouldStop?.()) break;
    await runSearchAttempt({
      client,
      searchAttempts,
      maxCandidates,
      shouldStop,
      onProgress,
      attempt,
      discovered,
      seenProfileIds,
      maxAdd: coverageLimit,
      maxPages: 1
    });
  }

  for (const attempt of searchAttempts) {
    if (discovered.length >= maxCandidates || shouldStop?.()) break;
    const remaining = maxCandidates - discovered.length;
    await runSearchAttempt({
      client,
      searchAttempts,
      maxCandidates,
      shouldStop,
      onProgress,
      attempt,
      discovered,
      seenProfileIds,
      maxAdd: remaining,
      maxPages: Math.max(1, Math.ceil(remaining / 50) + 1)
    });
  }

  return discovered;
}

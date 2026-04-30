import type { CandidateProfile, LinkInsight } from '$lib/fit/types';
import { fetchWithRateLimitRetry, type RateLimitRetryHandler } from '$lib/server/rate-limit';

const maxLinksPerCandidate = 10;
const maxSnippetLength = 900;
const maxHtmlLength = 180_000;
const maxTraversalDepth = 8;

type CandidateLink = {
  url: string;
  label: string;
  fieldPath: string;
  sourceKind: 'field' | 'text';
  context?: string;
  priority: number;
  order: number;
};

interface LinkInsightOptions {
  onRateLimited?: RateLimitRetryHandler;
}

const urlPattern = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const preferredPathPattern = /\b(social|trust|portfolio|website|github|linkedin|link|links|url|href|channel|career|project)\b/i;
const ignoredPathPattern = /\b(avatar|image|images|thumbnail|thumb|logo|icon|photo|cover|banner|screenshot|media|asset)\b/i;
const ignoredMediaExtensionPattern = /\.(?:png|jpe?g|gif|webp|svg|ico|bmp|avif|mp4|webm|mov|avi)(?:[?#].*)?$/i;
const markidyInternalHostPattern = /(^|\.)api\.markidy\.com$/i;

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function metaContent(html: string, name: string): string {
  const pattern = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    'i'
  );
  return html.match(pattern)?.[1]?.trim() || '';
}

function titleContent(html: string): string {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || '';
}

function blockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('169.254.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
}

function trimUrlCandidate(value: string): string {
  return value.trim().replace(/[),.;\]}>'"]+$/g, '');
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(trimUrlCandidate(value));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (blockedHost(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function labelFromPath(fieldPath: string): string {
  const segments = fieldPath.split('.').map((segment) => segment.replace(/\[\d+\]$/, '')).filter(Boolean);
  const segment = segments.at(-1) || 'link';
  if (/^(url|href|link)$/i.test(segment) && segments.length > 1) {
    return segments.at(-2) || 'link';
  }
  return segment || 'link';
}

function labelFromRecord(record: Record<string, unknown>, fallback: string): string {
  return firstString(record.label, record.type, record.platform, record.provider, record.name) || fallback;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function isProbablyLinkField(key: string): boolean {
  return /(?:url|href|link|website|portfolio|profile)$/i.test(key);
}

function isLikelyAssetUrl(url: string, fieldPath: string): boolean {
  try {
    const parsed = new URL(url);
    if (markidyInternalHostPattern.test(parsed.hostname)) return true;
    if (ignoredMediaExtensionPattern.test(parsed.pathname)) return true;
  } catch {
    return true;
  }

  return ignoredPathPattern.test(fieldPath);
}

function urlMatchesFromText(value: string): string[] {
  const urls: string[] = [];
  for (const match of value.matchAll(urlPattern)) {
    const url = safeUrl(match[0]);
    if (url) urls.push(url);
  }
  return urls;
}

function contextFor(value: string, url: string): string {
  const index = value.indexOf(url);
  if (index === -1) return value.slice(0, 220);
  return value.slice(Math.max(0, index - 80), Math.min(value.length, index + url.length + 120)).trim();
}

function priorityFor(fieldPath: string, sourceKind: CandidateLink['sourceKind']): number {
  if (/trustlinks|sociallinks/i.test(fieldPath)) return 0;
  if (preferredPathPattern.test(fieldPath)) return sourceKind === 'field' ? 1 : 2;
  return sourceKind === 'field' ? 3 : 4;
}

function collectLinks(
  value: unknown,
  fieldPath: string,
  links: CandidateLink[],
  order: { value: number },
  parentRecord: Record<string, unknown> | null,
  depth: number
): void {
  if (depth > maxTraversalDepth || value === null || value === undefined) return;

  if (typeof value === 'string') {
    const directUrl = safeUrl(value);
    const urls = directUrl ? [directUrl] : urlMatchesFromText(value);
    const sourceKind = directUrl || (parentRecord && isProbablyLinkField(labelFromPath(fieldPath))) ? 'field' : 'text';
    const label = parentRecord
      ? labelFromRecord(parentRecord, labelFromPath(fieldPath))
      : labelFromPath(fieldPath);

    for (const url of urls) {
      if (isLikelyAssetUrl(url, fieldPath)) continue;
      links.push({
        url,
        label,
        fieldPath,
        sourceKind,
        context: sourceKind === 'text' ? contextFor(value, url) : undefined,
        priority: priorityFor(fieldPath, sourceKind),
        order: order.value++
      });
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectLinks(item, `${fieldPath}[${index}]`, links, order, null, depth + 1);
    });
    return;
  }

  const record = getRecord(value);
  if (!Object.keys(record).length) return;

  for (const [key, item] of Object.entries(record)) {
    collectLinks(item, fieldPath ? `${fieldPath}.${key}` : key, links, order, record, depth + 1);
  }
}

export function candidateLinks(candidate: CandidateProfile): Array<Omit<CandidateLink, 'priority' | 'order'>> {
  const links: CandidateLink[] = [];
  const order = { value: 0 };
  collectLinks(candidate.detail, 'detail', links, order, null, 0);
  collectLinks(
    {
      bioSnippet: candidate.bioSnippet,
      desiredRoles: candidate.desiredRoles,
      recruitingSummary: candidate.recruitingSummary,
      topCareer: candidate.topCareer
    },
    'candidate',
    links,
    order,
    null,
    0
  );

  const seen = new Set<string>();
  return links
    .sort((a, b) => a.priority - b.priority || a.order - b.order)
    .filter((link) => {
      if (seen.has(link.url)) return false;
      seen.add(link.url);
      return true;
    })
    .slice(0, maxLinksPerCandidate)
    .map(({ priority, order, ...link }) => link);
}

async function fetchLinkInsight(
  link: Omit<CandidateLink, 'priority' | 'order'>,
  options: LinkInsightOptions = {}
): Promise<LinkInsight> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetchWithRateLimitRetry(
      link.url,
      {
        headers: {
          Accept: 'text/html,text/plain;q=0.9,*/*;q=0.1',
          'User-Agent': 'TalentScout/0.1 link-preview'
        },
        signal: controller.signal
      },
      {
        label: 'Public link preview',
        maxRetries: 1,
        baseDelayMs: 1000,
        maxDelayMs: 5000,
        onRateLimited: options.onRateLimited
      },
    );

    if (!res.ok) {
      return { ...link, error: `HTTP ${res.status}` };
    }

    const contentLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxHtmlLength) {
      return { ...link, error: 'Link content is too large to preview.' };
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType && !/text\/html|text\/plain|application\/xhtml\+xml/i.test(contentType)) {
      return { ...link, error: `Unsupported content type: ${contentType.split(';')[0]}` };
    }

    const body = (await res.text()).slice(0, maxHtmlLength);
    const description = metaContent(body, 'description') || metaContent(body, 'og:description');
    const title = metaContent(body, 'og:title') || titleContent(body);
    return {
      ...link,
      title: stripHtml(title).slice(0, 180),
      description: stripHtml(description).slice(0, 320),
      snippet: stripHtml(body).slice(0, maxSnippetLength)
    };
  } catch (error) {
    return {
      ...link,
      error: error instanceof Error ? error.message : 'Could not preview link.'
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function enrichCandidateLinks(
  candidate: CandidateProfile,
  options: LinkInsightOptions = {}
): Promise<CandidateProfile> {
  const links = candidateLinks(candidate);
  if (!links.length) return candidate;
  const insights = await Promise.all(links.map((link) => fetchLinkInsight(link, options)));
  return {
    ...candidate,
    linkInsights: insights
  };
}

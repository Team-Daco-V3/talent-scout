import type {
  MarkidyProfileDetail,
  MarkidyProfileSearchItem
} from '$lib/fit/types';
import { fetchWithRateLimitRetry, type RateLimitRetryHandler } from '$lib/server/rate-limit';

export interface MarkidyClientOptions {
  apiUrl: string;
  apiKey: string;
  onRateLimited?: RateLimitRetryHandler;
}

export interface ProfileSearchParams {
  q?: string;
  roles?: string[];
  skills?: string[];
  country?: string[];
  workMode?: string[];
  minExperienceMonths?: number | null;
  location?: string[];
  page?: number;
  pageSize?: number;
}

export interface ProfileSearchResponse {
  profiles: MarkidyProfileSearchItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore?: boolean;
}

function normalizeApiUrl(apiUrl: string): string {
  const trimmed = (apiUrl || 'https://api.markidy.com').trim().replace(/\/$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function joinValues(values?: string[]): string | undefined {
  const filtered = (values || []).map((value) => value.trim()).filter(Boolean);
  return filtered.length ? filtered.join(',') : undefined;
}

export class MarkidyApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'MarkidyApiError';
    this.status = status;
  }
}

export class MarkidyApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly onRateLimited?: RateLimitRetryHandler;

  constructor(options: MarkidyClientOptions) {
    this.baseUrl = normalizeApiUrl(options.apiUrl);
    this.apiKey = options.apiKey.trim();
    this.onRateLimited = options.onRateLimited;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchWithRateLimitRetry(
      `${this.baseUrl}${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...(init?.headers || {})
        }
      },
      {
        label: 'Markidy API',
        onRateLimited: this.onRateLimited
      }
    );

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const message =
        body?.error ||
        body?.message ||
        body?.code ||
        `Markidy API request failed with ${res.status}`;
      throw new MarkidyApiError(message, res.status);
    }

    return res.json() as Promise<T>;
  }

  async getChannels(): Promise<{ channels: Array<{ channel: string; connected: boolean; reason?: string }> }> {
    return this.request('/me/channels');
  }

  async searchProfiles(params: ProfileSearchParams): Promise<ProfileSearchResponse> {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    qs.set('sort', 'relevance');
    const country = joinValues(params.country);
    const roles = joinValues(params.roles);
    const skills = joinValues(params.skills);
    const workMode = joinValues(params.workMode);
    const location = joinValues(params.location);
    if (country) qs.set('country', country);
    if (roles) qs.set('roles', roles);
    if (skills) qs.set('skills', skills);
    if (workMode) qs.set('workMode', workMode);
    if (location) qs.set('location', location);
    if (params.minExperienceMonths) {
      qs.set('minExperienceMonths', String(params.minExperienceMonths));
    }
    qs.set('page', String(params.page || 1));
    qs.set('pageSize', String(Math.min(50, Math.max(1, params.pageSize || 20))));

    return this.request(`/profiles/search?${qs}`);
  }

  async getProfile(userId: string): Promise<MarkidyProfileDetail> {
    const data = await this.request<{ profile: MarkidyProfileDetail }>(
      `/profiles/${encodeURIComponent(userId)}`
    );
    return data.profile;
  }
}

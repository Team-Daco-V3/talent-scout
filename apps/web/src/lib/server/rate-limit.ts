export interface RateLimitRetryEvent {
  label: string;
  url: string;
  status: number;
  retryAttempt: number;
  maxRetries: number;
  waitMs: number;
}

export type RateLimitRetryHandler = (event: RateLimitRetryEvent) => void | Promise<void>;

export interface RateLimitRetryOptions {
  label?: string;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  onRateLimited?: RateLimitRetryHandler;
}

const defaultMaxRetries = 3;
const defaultBaseDelayMs = 2000;
const defaultMaxDelayMs = 30_000;

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - now);
  return null;
}

function retryDelayMs(response: Response, retryAttempt: number, options: RateLimitRetryOptions): number {
  const retryAfter = retryAfterMs(response.headers.get('retry-after'));
  const maxDelayMs = options.maxDelayMs ?? defaultMaxDelayMs;
  if (retryAfter !== null) return Math.min(retryAfter, maxDelayMs);

  const baseDelayMs = options.baseDelayMs ?? defaultBaseDelayMs;
  return Math.min(baseDelayMs * 2 ** Math.max(0, retryAttempt - 1), maxDelayMs);
}

export function rateLimitRetryMessage(event: RateLimitRetryEvent): string {
  const seconds = Math.max(1, Math.ceil(event.waitMs / 1000));
  return `${event.label} rate limit reached. Waiting ${seconds}s before retrying (${event.retryAttempt}/${event.maxRetries}).`;
}

export async function fetchWithRateLimitRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: RateLimitRetryOptions = {}
): Promise<Response> {
  const fetchFn = options.fetchFn ?? fetch;
  const sleepFn = options.sleepFn ?? defaultSleep;
  const maxRetries = options.maxRetries ?? defaultMaxRetries;
  const label = options.label || 'API request';

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetchFn(input, init);
    if (response.status !== 429 || attempt >= maxRetries) return response;

    const retryAttempt = attempt + 1;
    const waitMs = retryDelayMs(response, retryAttempt, options);
    await response.body?.cancel().catch(() => undefined);
    await options.onRateLimited?.({
      label,
      url: inputUrl(input),
      status: response.status,
      retryAttempt,
      maxRetries,
      waitMs
    });
    await sleepFn(waitMs);
  }

  return fetchFn(input, init);
}

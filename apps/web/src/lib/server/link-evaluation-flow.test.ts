import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as findCandidates } from '../../routes/api/find/+server';

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
}

function openAiResponse(value: unknown): Response {
  return jsonResponse({
    choices: [
      {
        message: {
          content: JSON.stringify(value)
        }
      }
    ]
  });
}

function htmlResponse(value: string): Response {
  return new Response(value, {
    headers: {
      'Content-Type': 'text/html'
    }
  });
}

function requestBody() {
  return {
    credentials: {
      markidyApiUrl: 'https://api.test',
      markidyApiKey: 'markidy-test-key',
      aiProvider: 'openai',
      aiApiKey: 'ai-test-key',
      aiBaseUrl: 'https://ai.test',
      aiModel: 'test-evaluator'
    },
    workflow: {
      company: {
        roleSummary: 'Find a backend engineer with public TypeScript platform evidence.',
        idealCandidate: ''
      },
      objective: {
        minExperienceYears: null,
        roles: ['Backend Engineer'],
        skills: ['TypeScript'],
        countries: [],
        workModes: [],
        locations: []
      },
      search: {
        maxCandidates: 1,
        searchAttemptsLimit: 3
      }
    }
  };
}

describe('candidate link evaluation flow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extracts links from profile detail, previews them, and sends link evidence to the evaluator', async () => {
    const fetchedUrls: string[] = [];
    let evaluatorPrompt = '';

    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = input instanceof Request ? input.url : String(input);
      fetchedUrls.push(url);

      if (url === 'https://api.test/v1/me/channels') {
        return jsonResponse({ channels: [] });
      }

      if (url.startsWith('https://api.test/v1/profiles/search')) {
        return jsonResponse({
          profiles: [
            {
              userId: 'usr_link_evidence',
              name: 'Link Evidence',
              country: 'US',
              verifiedLevel: 1,
              bioSnippet: 'Builder with a public portfolio.',
              desiredRoles: ['Backend Engineer']
            }
          ],
          total: 1,
          page: 1,
          pageSize: 10
        });
      }

      if (url === 'https://api.test/v1/profiles/usr_link_evidence') {
        return jsonResponse({
          profile: {
            userId: 'usr_link_evidence',
            displayName: 'Link Evidence',
            country: 'US',
            bio: 'Builder with a public portfolio.',
            trustLinks: [
              {
                type: 'portfolio',
                url: 'https://portfolio.example.com/case-study'
              }
            ],
            socialLinks: {
              github: 'https://github.example.com/link-evidence'
            },
            recruitingSummary: {
              desiredRoles: ['Backend Engineer']
            }
          }
        });
      }

      if (url === 'https://portfolio.example.com/case-study') {
        return htmlResponse(`
          <html>
            <head>
              <title>Launch Case Study</title>
              <meta name="description" content="TypeScript case study for automation and API integrations">
            </head>
            <body>Delivered a TypeScript platform with backend integrations and reporting workflows.</body>
          </html>
        `);
      }

      if (url === 'https://github.example.com/link-evidence') {
        return htmlResponse(`
          <html>
            <head><title>Public Engineering Profile</title></head>
            <body>Public repositories for API integrations.</body>
          </html>
        `);
      }

      if (url === 'https://ai.test/v1/chat/completions') {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
        const systemPrompt = String(body.messages?.[0]?.content || '');
        const prompt = String(body.messages?.[1]?.content || '');

        if (systemPrompt.includes('plan safe recruiting sourcing API requests')) {
          return openAiResponse({
            attempts: [
              {
                q: 'backend engineer platform',
                roles: ['Backend Engineer'],
                skills: ['TypeScript'],
                countries: [],
                workModes: [],
                locations: [],
                minExperienceMonths: null,
                reason: 'Search for backend platform engineers.'
              }
            ]
          });
        }

        evaluatorPrompt = prompt;
        const promptHasFetchedLinkEvidence =
          prompt.includes('linkInsights') &&
          prompt.includes('detail.trustLinks[0].url') &&
          prompt.includes('Launch Case Study') &&
          prompt.includes('TypeScript case study for automation and API integrations');

        return openAiResponse({
          summary: 'Public experience scope still needs review. However, the fetched portfolio shows relevant TypeScript platform work.',
          fitScore: promptHasFetchedLinkEvidence ? 94 : 35,
          recommendation: promptHasFetchedLinkEvidence ? 'strong_fit' : 'weak_fit',
          objectiveMatches: promptHasFetchedLinkEvidence
            ? ['Fetched portfolio link shows TypeScript platform evidence.']
            : [],
          objectiveMisses: [],
          fitReasons: promptHasFetchedLinkEvidence
            ? ['The evaluator received fetched link evidence from the candidate profile.']
            : ['No link evidence reached the evaluator.'],
          risks: []
        });
      }

      return new Response('not found', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);

    const response = await findCandidates({
      request: new Request('http://localhost/api/find', {
        method: 'POST',
        body: JSON.stringify(requestBody())
      })
    } as never);

    const result = await response.json();
    const candidate = result.candidates[0];
    const parsedPrompt = JSON.parse(evaluatorPrompt);

    expect(response.status).toBe(200);
    expect(fetchedUrls).toContain('https://portfolio.example.com/case-study');
    expect(fetchedUrls).toContain('https://github.example.com/link-evidence');
    expect(candidate.linkInsights).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://portfolio.example.com/case-study',
          fieldPath: 'detail.trustLinks[0].url',
          sourceKind: 'field',
          title: 'Launch Case Study',
          description: 'TypeScript case study for automation and API integrations'
        }),
        expect.objectContaining({
          url: 'https://github.example.com/link-evidence',
          fieldPath: 'detail.socialLinks.github',
          sourceKind: 'field',
          title: 'Public Engineering Profile'
        })
      ])
    );
    expect(parsedPrompt.candidate.linkInsights).toEqual(candidate.linkInsights);
    expect(parsedPrompt.objectiveAssessment.matches).toEqual(
      expect.arrayContaining([expect.stringContaining('TypeScript')])
    );
    expect(candidate.evaluation.fitScore).toBe(94);
    expect(candidate.evaluation.fitReasons).toEqual(
      expect.arrayContaining(['The evaluator received fetched link evidence from the candidate profile.'])
    );
  });
});

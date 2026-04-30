import { describe, expect, it } from 'vitest';
import { candidateLinks } from './link-insights';
import type { CandidateProfile } from '$lib/fit/types';

function candidate(detail: CandidateProfile['detail']): CandidateProfile {
  return {
    userId: 'usr_1',
    source: 'profile_search',
    sourceLabel: 'Profile search',
    name: 'Jane',
    avatar: null,
    country: 'US',
    verifiedLevel: 1,
    bioSnippet: '',
    topCareer: null,
    desiredRoles: [],
    recruitingSummary: null,
    detail,
    profileUrl: 'https://markidy.com/profile/usr_1'
  };
}

describe('candidateLinks', () => {
  it('falls back to public candidate fields when profile detail has no links', () => {
    const profile = candidate(null);
    profile.bioSnippet = 'Portfolio: https://fallback.example.com';

    const links = candidateLinks(profile);

    expect(links).toMatchObject([
      {
        url: 'https://fallback.example.com/',
        fieldPath: 'candidate.bioSnippet',
        sourceKind: 'text'
      }
    ]);
  });

  it('extracts public links from the full profile detail response with field paths', () => {
    const links = candidateLinks(
      candidate({
        userId: 'usr_1',
        avatar: 'https://cdn.example.com/avatar.png',
        socialLinks: {
          github: 'https://github.com/example',
          linkedin: 'https://linkedin.com/in/example'
        },
        trustLinks: [
          {
            type: 'portfolio',
            url: 'https://portfolio.example.com'
          }
        ],
        description: 'Built projects listed at https://case-study.example.com.',
        careers: [
          {
            title: 'Engineer',
            portfolioUrl: 'https://work.example.com/project'
          }
        ],
        activeChannels: [
          {
            channel: 'github',
            metadata: {
              profile: 'https://github.com/example'
            }
          }
        ]
      })
    );

    expect(links.map((link) => link.url)).toEqual([
      'https://github.com/example',
      'https://linkedin.com/in/example',
      'https://portfolio.example.com/',
      'https://work.example.com/project',
      'https://case-study.example.com/'
    ]);
    expect(links.find((link) => link.url === 'https://work.example.com/project')?.fieldPath).toBe(
      'detail.careers[0].portfolioUrl'
    );
    expect(links.find((link) => link.url === 'https://case-study.example.com/')?.sourceKind).toBe('text');
  });

  it('skips private hosts, internal API URLs, media assets, and duplicates', () => {
    const links = candidateLinks(
      candidate({
        website: 'http://localhost:5173/profile',
        apiUrl: 'https://api.markidy.com/v1/profiles/usr_1',
        logo: 'https://assets.example.com/logo.svg',
        projectUrl: 'https://project.example.com',
        profile: 'https://project.example.com'
      })
    );

    expect(links.map((link) => link.url)).toEqual(['https://project.example.com/']);
  });
});

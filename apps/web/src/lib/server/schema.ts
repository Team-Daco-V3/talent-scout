import { z } from 'zod';
import { aiProviderPresets } from '$lib/ai/providers';
import { workModeValues } from '$lib/fit/options';

const textArraySchema = z.array(z.string().trim().min(1)).max(20).default([]);
const workModeSchema = z.array(z.enum(workModeValues)).max(workModeValues.length).default([]);
const aiProviderIds = aiProviderPresets.map((provider) => provider.id) as [
  (typeof aiProviderPresets)[number]['id'],
  ...(typeof aiProviderPresets)[number]['id'][]
];

export const fitRequestSchema = z.object({
  credentials: z.object({
    markidyApiUrl: z.string().trim().url().default('https://api.markidy.com'),
    markidyApiKey: z.string().trim().min(1, 'Markidy API key is required.'),
    aiProvider: z.enum(aiProviderIds).default('openai'),
    aiApiKey: z.string().trim().min(1, 'AI API key is required.'),
    aiBaseUrl: z.string().trim().optional().default(''),
    aiModel: z.string().trim().optional().default('')
  }),
  workflow: z.object({
    company: z.object({
      roleSummary: z.string().trim().min(1, 'Role summary is required.'),
      idealCandidate: z.string().trim().default('')
    }),
    objective: z.object({
      minExperienceYears: z.number().nullable().default(null),
      roles: textArraySchema,
      skills: textArraySchema,
      countries: textArraySchema,
      workModes: workModeSchema,
      locations: textArraySchema
    }),
    search: z.object({
      maxCandidates: z.number().int().min(1).max(1000).default(8),
      searchAttemptsLimit: z.number().int().min(1).max(10).default(6)
    })
  })
});

export const validateRequestSchema = z.object({
  markidyApiUrl: z.string().trim().url().default('https://api.markidy.com'),
  markidyApiKey: z.string().trim().min(1, 'Markidy API key is required.')
});

export type FitRequest = z.infer<typeof fitRequestSchema>;

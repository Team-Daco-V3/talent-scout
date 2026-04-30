export type AiProviderId = 'openai' | 'anthropic' | 'gemini' | 'xai' | 'mistral';

export type AiProviderAdapter = 'openai-compatible' | 'anthropic' | 'gemini';

export interface AiProviderPreset {
  id: AiProviderId;
  label: string;
  shortLabel: string;
  adapter: AiProviderAdapter;
  defaultBaseUrl: string;
  defaultModel: string;
  keyPlaceholder: string;
  helpUrl: string;
}

export const aiProviderPresets: AiProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    shortLabel: 'OpenAI',
    adapter: 'openai-compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    keyPlaceholder: 'OpenAI API key',
    helpUrl: 'https://platform.openai.com/api-keys'
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    shortLabel: 'Claude',
    adapter: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-5',
    keyPlaceholder: 'Anthropic API key',
    helpUrl: 'https://console.anthropic.com/settings/keys'
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    shortLabel: 'Gemini',
    adapter: 'gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    keyPlaceholder: 'Gemini API key',
    helpUrl: 'https://aistudio.google.com/apikey'
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    shortLabel: 'Grok',
    adapter: 'openai-compatible',
    defaultBaseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4',
    keyPlaceholder: 'xAI API key',
    helpUrl: 'https://console.x.ai'
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    shortLabel: 'Mistral',
    adapter: 'openai-compatible',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    keyPlaceholder: 'Mistral API key',
    helpUrl: 'https://console.mistral.ai/api-keys'
  }
];

export function getAiProviderPreset(id: string): AiProviderPreset {
  return aiProviderPresets.find((provider) => provider.id === id) ?? aiProviderPresets[0];
}

export const workModeOptions = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'Onsite' },
  { value: 'flexible', label: 'Flexible' }
] as const;

export type WorkMode = (typeof workModeOptions)[number]['value'];

export const workModeValues = workModeOptions.map((option) => option.value) as [
  WorkMode,
  ...WorkMode[]
];

export function isWorkMode(value: string): value is WorkMode {
  return workModeValues.includes(value as WorkMode);
}

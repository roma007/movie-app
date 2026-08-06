export type ThemeId = 'dark' | 'light';

export type ColorMode = 'system' | 'dark' | 'light';

export interface ThemeColors {
  primary: string;
  primaryLight: string;
  background: string;
  sidebar: string;
  card: string;
  cardAccent: string;
  cardDim: string;
  hover: string;
  text: string;
  foreground: string;
  mutedForeground: string;
  disabledForeground: string;
  success: string;
  warning: string;
  error: string;
  favorite: string;
  border: string;
  borderHighlight: string;
  popover: string;
  secondary: string;
  secondaryForeground: string;
  accent: string;
  destructive: string;
  input: string;
  ring: string;
  surface: string;
  surfaceElevated: string;
  textSecondary: string;
  buttonPrimaryText: string;
  buttonSecondaryText: string;
  buttonDestructiveText: string;
  trackBg: string;
  swiftTrack: string;
  swiftActiveTrack: string;
  swiftThumb: string;
}

export interface ThemeConfig {
  id: ThemeId;
  name: string;
  description: string;
  colors: ThemeColors;
}
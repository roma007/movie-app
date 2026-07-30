export type ThemeId = 'dark' | 'light';

export type ColorMode = 'system' | 'dark' | 'light';

export interface ThemeColors {
  background: string;
  surface: string;
  card: string;
  surfaceElevated: string;
  hover: string;
  foreground: string;
  text: string;
  textSecondary: string;
  mutedForeground: string;
  disabledForeground: string;
  success: string;
  warning: string;
  error: string;
  favorite: string;
  border: string;
  borderHighlight: string;
  input: string;
  overlay: string;
  playerBg: string;
  playerHeader: string;
  buttonPrimaryBg: string;
  buttonPrimaryText: string;
  buttonSecondaryBg: string;
  buttonSecondaryText: string;
  buttonDestructiveBg: string;
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

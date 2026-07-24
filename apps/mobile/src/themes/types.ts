export type ThemeId = 'dark' | 'light' | 'ocean' | 'forest' | 'sunset' | 'purple';

export interface ThemeColors {
  primary: string;
  primaryHover: string;
  primaryLight: string;
  primaryForeground: string;
  background: string;
  surface: string;
  card: string;
  surfaceElevated: string;
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
  borderLight: string;
  borderHighlight: string;
  input: string;
  switchTrack: string;
  overlay: string;
  playerBg: string;
  playerHeader: string;
}

export interface ThemeConfig {
  id: ThemeId;
  name: string;
  description: string;
  colors: ThemeColors;
}

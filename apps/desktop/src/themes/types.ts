export type ThemeId = 'dark' | 'light' | 'ocean' | 'forest' | 'sunset' | 'purple';

export interface ThemeColors {
  primary: string;
  primaryHover: string;
  primaryLight: string;
  primaryForeground: string;
  background: string;
  sidebar: string;
  card: string;
  hover: string;
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
  popoverForeground: string;
  secondary: string;
  secondaryForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  input: string;
  ring: string;
}

export interface ThemeConfig {
  id: ThemeId;
  name: string;
  description: string;
  colors: ThemeColors;
}
import { THEMES, DEFAULT_THEME, type Theme } from '../../shared/themes';

export { THEMES };

export function findTheme(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME)!;
}

/** Writes a theme's palette into CSS variables (and caches it so the next load paints instantly). */
export function applyTheme(id: string | null | undefined) {
  const theme = findTheme(id);
  const root = document.documentElement;
  const vars: Record<string, string> = { ...theme.colors, 'on-accent': theme.dark ? theme.colors.bg : '#ffffff' };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(`--${k}`, v);
  root.dataset.mode = theme.dark ? 'dark' : 'light';
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
  try {
    localStorage.setItem('mm-theme-colors', JSON.stringify(vars));
  } catch {
    /* storage may be unavailable */
  }
  return theme;
}

/** Map client "color" names to theme palette variables. */
export const tone = (c: string | null | undefined) => `var(--${c && ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'orange'].includes(c) ? c : 'accent'})`;

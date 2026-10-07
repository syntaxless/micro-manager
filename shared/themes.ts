/** Terminal-inspired color themes. Each maps a popular terminal palette onto the app's UI roles. */
export interface Theme {
  id: string;
  name: string;
  dark: boolean;
  colors: {
    bg: string;
    surface: string;
    overlay: string;
    border: string;
    fg: string;
    muted: string;
    accent: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    orange: string;
  };
}

const t = (id: string, name: string, dark: boolean, c: string): Theme => {
  const [bg, surface, overlay, border, fg, muted, accent, red, green, yellow, blue, magenta, cyan, orange] = c.trim().split(/\s+/);
  return { id, name, dark, colors: { bg, surface, overlay, border, fg, muted, accent, red, green, yellow, blue, magenta, cyan, orange } };
};

//                                    bg      surface overlay border  fg      muted   accent  red     green   yellow  blue    magenta cyan    orange
export const THEMES: Theme[] = [
  t('tokyo-night', 'Tokyo Night', true, '#1a1b26 #1f2335 #24283b #2f3549 #c0caf5 #737aa2 #7aa2f7 #f7768e #9ece6a #e0af68 #7aa2f7 #bb9af7 #7dcfff #ff9e64'),
  t('catppuccin-mocha', 'Catppuccin Mocha', true, '#1e1e2e #181825 #313244 #45475a #cdd6f4 #9399b2 #cba6f7 #f38ba8 #a6e3a1 #f9e2af #89b4fa #f5c2e7 #94e2d5 #fab387'),
  t('dracula', 'Dracula', true, '#282a36 #21222c #343746 #44475a #f8f8f2 #8b95c4 #bd93f9 #ff5555 #50fa7b #f1fa8c #8be9fd #ff79c6 #8be9fd #ffb86c'),
  t('nord', 'Nord', true, '#2e3440 #3b4252 #434c5e #4c566a #eceff4 #a0a9bb #88c0d0 #bf616a #a3be8c #ebcb8b #81a1c1 #b48ead #8fbcbb #d08770'),
  t('gruvbox-dark', 'Gruvbox Dark', true, '#282828 #32302f #3c3836 #504945 #ebdbb2 #a89984 #fe8019 #fb4934 #b8bb26 #fabd2f #83a598 #d3869b #8ec07c #fe8019'),
  t('one-dark', 'One Dark', true, '#282c34 #21252b #2c313a #3e4451 #abb2bf #7f848e #61afef #e06c75 #98c379 #e5c07b #61afef #c678dd #56b6c2 #d19a66'),
  t('solarized-dark', 'Solarized Dark', true, '#002b36 #073642 #0b4352 #174d5c #93a1a1 #6c8289 #268bd2 #dc322f #859900 #b58900 #268bd2 #d33682 #2aa198 #cb4b16'),
  t('monokai', 'Monokai', true, '#272822 #1e1f1c #3e3d32 #49483e #f8f8f2 #90908a #a6e22e #f92672 #a6e22e #e6db74 #66d9ef #ae81ff #66d9ef #fd971f'),
  t('rose-pine', 'Rosé Pine', true, '#191724 #1f1d2e #26233a #403d52 #e0def4 #908caa #c4a7e7 #eb6f92 #3e8fb0 #f6c177 #9ccfd8 #c4a7e7 #9ccfd8 #ebbcba'),
  t('everforest', 'Everforest', true, '#2d353b #343f44 #3d484d #475258 #d3c6aa #9da9a0 #a7c080 #e67e80 #a7c080 #dbbc7f #7fbbb3 #d699b6 #83c092 #e69875'),
  t('kanagawa', 'Kanagawa', true, '#1f1f28 #16161d #2a2a37 #363646 #dcd7ba #9a9886 #7e9cd8 #e46876 #98bb6c #e6c384 #7e9cd8 #957fb8 #7aa89f #ffa066'),
  t('catppuccin-latte', 'Catppuccin Latte', false, '#eff1f5 #e6e9ef #ffffff #ccd0da #4c4f69 #6c6f85 #8839ef #d20f39 #40a02b #df8e1d #1e66f5 #ea76cb #179299 #fe640b'),
  t('gruvbox-light', 'Gruvbox Light', false, '#fbf1c7 #f2e5bc #fffbe6 #d5c4a1 #3c3836 #7c6f64 #af3a03 #9d0006 #79740e #b57614 #076678 #8f3f71 #427b58 #af3a03'),
  t('solarized-light', 'Solarized Light', false, '#fdf6e3 #eee8d5 #fffcf4 #d9d2bc #586e75 #7b8e94 #268bd2 #dc322f #859900 #b58900 #268bd2 #d33682 #2aa198 #cb4b16'),
  t('rose-pine-dawn', 'Rosé Pine Dawn', false, '#faf4ed #f2e9e1 #fffaf3 #dfdad9 #575279 #797593 #907aa9 #b4637a #286983 #ea9d34 #56949f #907aa9 #56949f #d7827e'),
];

export const THEME_IDS = THEMES.map((x) => x.id) as [string, ...string[]];
export const DEFAULT_THEME = 'tokyo-night';

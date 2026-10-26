import { Monitor, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { IconButton } from '../components/Button.tsx';
import { strings } from '../strings.ts';
import { getTheme, setTheme, type Theme } from '../theme.ts';

const next: Record<Theme, Theme> = { light: 'dark', dark: 'system', system: 'light' };
const icon = { light: Sun, dark: Moon, system: Monitor };

/** One click cycles light → dark → system; the icon shows the current choice. */
export function ThemeButton() {
  const [theme, setT] = useState<Theme>(getTheme());
  const Icon = icon[theme];
  return (
    <IconButton label={strings.header.theme(theme)} onClick={() => { setTheme(next[theme]); setT(next[theme]); }}>
      <Icon aria-hidden className="size-5" />
    </IconButton>
  );
}

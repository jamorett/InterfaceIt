export type Theme = 'light' | 'dark' | 'system';

const KEY = 'ci-theme';

function stored(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system'; // storage blocked: follow the OS
  }
}

export function getTheme(): Theme {
  return stored();
}

export function setTheme(t: Theme) {
  try {
    if (t === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch { /* the theme still applies for this page load */ }
  apply(t);
}

function apply(t: Theme) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

/** Call once at startup. `?theme=dark|light` wins (used by the dev pages and screenshots). */
export function initTheme() {
  const q = new URLSearchParams(location.search).get('theme');
  apply(q === 'light' || q === 'dark' ? q : stored());
}

import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './theme.css';
import { initTheme } from './theme.ts';

initTheme();

// The design gallery is a development tool: Vite removes this whole branch from the production build.
const Dev = import.meta.env.DEV
  ? lazy(async () => {
      const [{ DevTokens }, { DevShell }] = await Promise.all([import('./dev/DevTokens.tsx'), import('./dev/DevShell.tsx')]);
      return { default: location.pathname === '/dev/shell' ? DevShell : DevTokens };
    })
  : null;
const isDev = import.meta.env.DEV && location.pathname.startsWith('/dev/');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDev && Dev ? <Suspense fallback={null}><Dev /></Suspense> : <App />}
  </StrictMode>,
);

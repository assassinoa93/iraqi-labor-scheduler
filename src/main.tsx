import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { AppShell } from './components/AppShell';

// v3.0.0 — webfonts bundled locally via @fontsource so the Electron app
// works fully offline. Pre-3.0 the fonts came from Google Fonts CDN; a
// first-launch with no internet rendered the app in the system fallback
// stack until the user got online. Each `@fontsource/<family>/<weight>.css`
// import injects an `@font-face` referencing a hashed `.woff2` that Vite
// emits next to the bundle. The CSS variables in `index.css` (`--font-sans`
// etc.) keep the same family names so component classes stay unchanged.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '@fontsource/inter/900.css';
import '@fontsource/outfit/300.css';
import '@fontsource/outfit/400.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/800.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
// Noto Naskh + Kufi ship with `arabic-` prefixed subsets to match the
// Arabic codepoint range only. Saves a few hundred kB vs the full
// universal subset.
import '@fontsource/noto-naskh-arabic/arabic-400.css';
import '@fontsource/noto-naskh-arabic/arabic-500.css';
import '@fontsource/noto-naskh-arabic/arabic-700.css';
import '@fontsource/noto-kufi-arabic/arabic-400.css';
import '@fontsource/noto-kufi-arabic/arabic-700.css';
import '@fontsource/noto-kufi-arabic/arabic-800.css';

import './index.css';
import { LocaleProvider } from './lib/i18n';
import { ThemeProvider } from './lib/theme';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* v5.27 — reducedMotion="user" makes every motion/react animation honour
        the OS "reduce motion" setting (the CSS @media reset in index.css covers
        Tailwind animate-* + transitions for the rest). */}
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <LocaleProvider>
          <AppShell />
        </LocaleProvider>
      </ThemeProvider>
    </MotionConfig>
  </StrictMode>,
);

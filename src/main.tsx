import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { LocaleProvider } from './lib/i18n';
import { ThemeProvider } from './lib/theme';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <LocaleProvider>
        <App />
      </LocaleProvider>
    </ThemeProvider>
  </StrictMode>,
);

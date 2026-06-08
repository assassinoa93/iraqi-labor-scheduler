import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { loadEnv } from 'vite';
// `vitest/config`'s defineConfig is a superset of vite's (it also types the
// `test` block) and works for both `vite build` and `vitest run`.
import { defineConfig } from 'vitest/config';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      watch: {
        ignored: ['**/data/**'],
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    // v5.39.1 — CI timeout hardening. Every test passes locally in well under
    // a second, but on a shared 2-core GitHub Actions runner vitest spawns one
    // worker per core and the heavy `whatIfSimulator` test (it runs the full
    // auto-scheduler) starves sibling workers of CPU, so even trivial tests
    // wall-clock past the default 5s timeout (observed ~7s). The fixtures are
    // tiny — this is runner contention, not a perf regression — so we give the
    // suite generous headroom rather than weaken any test. `maxWorkers` caps
    // parallelism so the heavy file can't monopolise the runner.
    test: {
      testTimeout: 30000,
      hookTimeout: 30000,
      maxWorkers: 2,
    },
  };
});

/**
 * Bundles server.ts into a single CommonJS file (server-bundle.js)
 * that Electron's main process can require() at runtime.
 *
 * Usage: node scripts/build-server.js
 */
const { build } = require('esbuild');
const path = require('path');

build({
  entryPoints: [path.join(__dirname, '..', 'server.ts')],
  bundle:   true,
  platform: 'node',
  format:   'cjs',
  outfile:  path.join(__dirname, '..', 'server-bundle.js'),
  // Vite is only needed in dev; exclude from production bundle
  external: ['vite', 'electron'],
  // Inline the source map for easier debugging
  sourcemap: 'inline',
}).then(() => {
  console.log('✅ server-bundle.js created');
}).catch((e) => {
  console.error('❌ Server bundle failed:', e);
  process.exit(1);
});

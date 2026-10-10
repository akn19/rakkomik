// Vite build for the React frontend (Fase 3 tooling + Fase 4 shell).
//
// What this builds (and what it deliberately does NOT):
// - Bundles ONLY the React UI (`src/web/ui/main.jsx` → `ui/dist/ui.js` +
//   `ui/dist/ui.css`, fixed names so `index.html` can load them).
// - Engine (`mjs/engine/*`) and connectors (`mjs/connectors/*`) are NOT
//   bundled: connectors are runtime-discovered through the cache listing via
//   dynamic `import()` and must stay individual static files (audit §4.1).
//
// Flows:
// - dev (cache-directory = ./src/web): `pnpm run watch:ui`, then
//   `pnpm run start:dev`.
// - prod: `pnpm run build:web` (`vite build --mode web`) builds the UI and then
//   assembles the static bundle (incl. `ui/dist` and VersionInfo) in `build/web`
//   (see vite.web-bundle.mjs).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { webBundle } from './vite.web-bundle.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const UIDIR = path.join(ROOT, 'src', 'web', 'ui');

export default ({ mode }) => ({
    plugins: [
        react(),
        tailwindcss(),
        // `vite build --mode web`: also assemble the complete web bundle in build/web
        ...(mode === 'web'
            ? [webBundle({ source: path.dirname(UIDIR), target: path.join(ROOT, 'build', 'web'), include: ['index.html', 'js', 'img', 'mjs', 'ui/dist'] })]
            : [])
    ],
    root: UIDIR,
    // The bundle runs in a de-privileged renderer (no nodeIntegration):
    // stub the only Node global the UI libs touch so dead dev branches
    // fold away at build time instead of throwing at import time.
    define: {
        'process.env.NODE_ENV': JSON.stringify('production')
    },
    build: {
        outDir: path.join(UIDIR, 'dist'),
        emptyOutDir: true,
        lib: {
            entry: path.join(UIDIR, 'main.jsx'),
            name: 'RakkomikUI',
            formats: ['es'],
            fileName: () => 'ui.js'
        },
        rollupOptions: {
            // Fixed names for the files index.html references directly;
            // hashed names for the rest (assets such as fonts). There are no lazy
            // chunks on purpose, see src/web/ui/router.jsx.
            output: {
                assetFileNames: asset => asset.names?.some(name => name.endsWith('.css')) ? 'ui.[ext]' : 'ui-asset-[name]-[hash].[ext]'
            }
        },
        // Binary assets referenced from CSS (e.g. fonts) are inlined by Vite
        // in lib mode; for this local-disk app that is acceptable (no network,
        // parsed once). Keep emitted files, if any, next to the bundle.
        assetsInlineLimit: 0
    }
});

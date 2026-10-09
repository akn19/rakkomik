// Vite build for the React frontend (Fase 3 tooling + Fase 4 shell).
//
// What this builds (and what it deliberately does NOT):
// - Bundles ONLY the new React UI (`src/web/ui/main.jsx` → `ui/dist/ui.js` +
//   `ui/dist/ui.css`, fixed names so `index.html` can load them).
// - Engine (`mjs/engine/*`) and connectors (`mjs/connectors/*`) are NOT
//   bundled: connectors are runtime-discovered over `hakuneko://cache` via
//   dynamic `import()` and must stay individual static files (audit §4.1).
// - The classic Polymer frontend keeps working untouched (HTML Imports cannot
//   be bundled — audit §4.1); its files travel as static assets as before.
//
// Flows:
// - dev (cache-directory = ./src/web): `pnpm run watch:ui`, then
//   `pnpm run start:dev`; select `frontend@react` in settings.
// - prod: `pnpm run build:web` chains `build:ui` first, then the legacy
//   polymer-build carries `ui/dist/**/*` into the bundle (see
//   build-web.config).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const UIDIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'src', 'web', 'ui');

export default {
    plugins: [react(), tailwindcss()],
    root: UIDIR,
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
            // hashed names for the rest (fonts, lazy chunks).
            output: {
                assetFileNames: asset => asset.names?.some(name => name.endsWith('.css')) ? 'ui.[ext]' : 'ui-asset-[name]-[hash].[ext]'
            }
        },
        // Binary assets referenced from CSS (e.g. fonts) are inlined by Vite
        // in lib mode; for this local-disk app that is acceptable (no network,
        // parsed once). Keep emitted files, if any, next to the bundle.
        assetsInlineLimit: 0
    }
};

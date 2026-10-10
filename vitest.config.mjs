// Unit tests (Fase 3/F-B2). The Vite build config (`vite.config.mjs`) is a
// library build rooted in `src/web/ui`, so tests get their own config.
// The e2e suite runs on Playwright (`playwright.config.mjs`), not here.
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        reporters: ['default', ['junit', { outputFile: 'junit.xml' }]],
        projects: [
            {
                test: {
                    name: 'app',
                    globals: true,
                    environment: 'node',
                    include: ['src/app/**/*.test.js']
                }
            },
            {
                test: {
                    name: 'web',
                    globals: true,
                    environment: 'node',
                    include: ['src/web/**/*.test.js']
                }
            }
        ]
    }
});

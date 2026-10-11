// Unit tests. The Vite build config (`vite.config.mjs`) is a
// library build rooted in `src/web/ui`, so tests get their own config.
// The e2e suite runs on Playwright (`playwright.config.mjs`), not here.
//
// Three projects: the main process (`app`), the engine and its helpers (`web`, plain Node) and the React components
// of the user interface (`ui`, a DOM). `pnpm run test:coverage` measures everything except the connectors of the
// websites: they are tested by running them against the sites (`pnpm run test:e2e:sites`), not by unit tests.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        reporters: ['default', ['junit', { outputFile: 'junit.xml' }]],
        coverage: {
            provider: 'v8',
            reportsDirectory: 'coverage',
            reporter: ['text-summary', 'text', 'html'],
            include: [
                'src/app/**/*.js',
                'src/web/mjs/**/*.mjs',
                'src/web/ui/**/*.{js,jsx}',
                'scripts/**/*.{js,mjs}',
                'build-app.js',
                'deploy-web.js',
                'vite.web-bundle.mjs'
            ],
            exclude: [
                '**/__tests__/**',
                // the connectors of the websites; the built-in sources in `connectors/system` are features and stay
                'src/web/mjs/connectors/templates/**',
                'src/web/mjs/connectors/*.mjs',
                // generated, vendored, or not part of the application (the history worker is switched off in HakuNeko.mjs)
                'src/web/mjs/VersionInfo.mjs',
                'src/web/mjs/engine/HistoryWorker.mjs',
                'src/web/ui/dist/**',
                'src/app/main.js'
            ]
        },
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
            },
            {
                plugins: [react()],
                test: {
                    name: 'ui',
                    globals: true,
                    environment: 'happy-dom',
                    // a test never goes to the network: the page of an iframe or a window that a markup holds is not loaded
                    environmentOptions: {
                        happyDOM: { settings: { navigation: { disableChildFrameNavigation: true, disableChildPageNavigation: true } } }
                    },
                    include: ['src/web/ui/__tests__/**/*.test.jsx'],
                    setupFiles: ['src/web/ui/__tests__/support/setup.js']
                }
            }
        ]
    }
});

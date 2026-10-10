// End-to-end tests on the packaged web bundle inside Electron (F-B2).
// - project `ui`: hermetic UI tests (isolated profile, no site access)
// - project `sites`: live connector smoke tests against the real websites
// Both launch Electron through Playwright's `_electron` API (no remote debugging port).
import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: 'src/__tests__',
    workers: 1,
    fullyParallel: false,
    reporter: [['list'], ['junit', { outputFile: 'junit-e2e.xml' }]],
    use: {
        trace: 'retain-on-failure'
    },
    projects: [
        {
            name: 'ui',
            testMatch: 'App.e2e.mjs',
            timeout: 60000
        },
        {
            name: 'sites',
            testMatch: 'Connectors.e2e.mjs',
            timeout: 90000
        }
    ]
});

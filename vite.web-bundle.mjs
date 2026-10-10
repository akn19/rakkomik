// Vite plugin: assembles the web-application bundle (`vite build --mode web`).
//
// The engine (`mjs/engine`) and the connectors (`mjs/connectors`) are NOT bundled:
// connectors are discovered at runtime (`hakuneko://cache/mjs/connectors/`) and
// imported individually, and they share the engine modules by URL (one `Connector`
// class instance, `instanceof` keeps working). So the bundle is the static source
// tree plus the freshly built React UI (`ui/dist`) and a generated VersionInfo.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

function git(...args) {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/**
 * Write `mjs/VersionInfo.mjs` (branch and revision of the checkout).
 */
async function createVersionInfo(file) {
    const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
    const revision = git('rev-parse', 'HEAD');
    const content = [
        'export default {',
        '    branch: {',
        `        label: '${branch}',`,
        `        link: 'https://github.com/manga-download/hakuneko/commits/${branch}',`,
        '    },',
        '    revision: {',
        `        label: '${revision.slice(0, 6)}',`,
        `        link: 'https://github.com/manga-download/hakuneko/commits/${revision}',`,
        '    }',
        '};'
    ].join('\n');
    await fs.writeFile(file, content);
}

/**
 * @param {{ source: string, target: string, include: string[] }} options
 *   `include` are paths relative to `source`; `ui/dist` must be listed after the UI build ran.
 */
export function webBundle({ source, target, include }) {
    return {
        name: 'rakkomik-web-bundle',
        apply: 'build',
        async closeBundle() {
            // runs after the UI bundle (`ui/dist`) has been written
            await fs.rm(target, { recursive: true, force: true });
            for (const entry of include) {
                await fs.cp(path.join(source, entry), path.join(target, entry), { recursive: true });
            }
            await createVersionInfo(path.join(target, 'mjs', 'VersionInfo.mjs'));
        }
    };
}

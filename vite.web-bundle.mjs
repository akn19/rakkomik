// Vite plugin: assembles the web-application bundle (`vite build --mode web`).
//
// The engine (`mjs/engine`) and the connectors (`mjs/connectors`) are NOT bundled:
// connectors are discovered at runtime (the `mjs/connectors/` listing of the cache) and
// imported individually, and they share the engine modules by URL (one `Connector`
// class instance, `instanceof` keeps working). So the bundle is the static source
// tree plus the freshly built React UI (`ui/dist`) and a generated VersionInfo.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

function git(...args) {
    // stderr stays out of the build log: a failure is thrown with its message anyway
    return execFileSync('git', args, { encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'pipe' ] }).trim();
}

/**
 * The name of the checkout: its branch, or the tag of a detached checkout (CI builds a release from its tag).
 * RAKKOMIK_BRANCH names it when the checkout has a made-up branch, like the one makepkg checks a release tag out on
 * (packaging/aur/PKGBUILD).
 */
function checkoutName() {
    if(process.env.RAKKOMIK_BRANCH) {
        return process.env.RAKKOMIK_BRANCH;
    }
    const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
    if(branch === 'HEAD') {
        try {
            return git('describe', '--tags', '--exact-match', 'HEAD');
        } catch {
            // a detached checkout that is not at a tag keeps the name HEAD
        }
    }
    return branch;
}

/**
 * Write `mjs/VersionInfo.mjs` (branch and revision of the checkout).
 */
async function createVersionInfo(file) {
    const branch = checkoutName();
    const revision = git('rev-parse', 'HEAD');
    const content = [
        'export default {',
        '    branch: {',
        `        label: '${branch}',`,
        `        link: 'https://github.com/akn19/rakkomik/commits/${branch}',`,
        '    },',
        '    revision: {',
        `        label: '${revision.slice(0, 6)}',`,
        `        link: 'https://github.com/akn19/rakkomik/commits/${revision}',`,
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

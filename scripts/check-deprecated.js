/**
 * CI gate: refuse deprecated dependencies (AGENTIC-PLAN Fase 0.7 / audit Aturan 8).
 *
 * The `deprecated` flag lives in registry metadata (it is NOT part of the
 * published tarball), so this gate queries the registry for every declared
 * package at its INSTALLED version via the registry metadata API
 * (`https://registry.npmjs.org/<name>` → `versions[<v>].deprecated`).
 *
 * Any deprecated package NOT on the recorded exception list below fails
 * the gate (exit 1). Requires network (always available in CI install jobs).
 *
 * Recorded exceptions (pengecualian tercatat — allowed by Aturan 8):
 * - `rcedit`: deprecated upstream ("Package no longer supported"), no
 *   maintained drop-in; build-time only (Windows exe metadata), isolated
 *   from runtime. Re-evaluate in Fase 0.7 (build matrix).
 *   (Fase 0.5 removed the former `@hakuneko/*` + `@logtrine/logtrine`
 *   exceptions with the packages themselves.)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');

const ALLOWLIST = new Map([
    ['rcedit', 'deprecated upstream, no maintained drop-in; build-time Windows-only; re-evaluate Fase 0.7'],
]);

function declaredPackages() {
    const pkgs = new Map(); // name -> { declaredIn }
    const root = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    for (const name of Object.keys(root.devDependencies || {})) {
        pkgs.set(name, { declaredIn: 'package.json:devDependencies' });
    }
    const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'app', 'package.json'), 'utf8'));
    for (const name of Object.keys(app.dependencies || {})) {
        if (!pkgs.has(name)) {
            pkgs.set(name, { declaredIn: 'src/app/package.json:dependencies' });
        }
    }
    return pkgs;
}

function installedVersion(name) {
    // Root install first, then the nested src/app install (Fase 0 keeps the
    // nested layout: `cd src/app && pnpm install`, no workspace symlinks).
    const candidates = [
        path.join(ROOT, 'node_modules', name, 'package.json'),
        path.join(ROOT, 'src', 'app', 'node_modules', name, 'package.json'),
    ];
    for (const file of candidates) {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8')).version;
        }
    }
    return null;
}

function registryDocument(name) {
    // Scoped names need the slash encoded for the registry URL.
    const encoded = name.replace('/', '%2f');
    const url = `https://registry.npmjs.org/${encoded}`;
    return new Promise((resolve, reject) => {
        const request = https.get(url, { timeout: 20000 }, response => {
            if (response.statusCode !== 200) {
                reject(new Error(`registry responded ${response.statusCode} for ${name}`));
                response.resume();
                return;
            }
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch {
                    reject(new Error(`invalid registry response for ${name}`));
                }
            });
        });
        request.on('timeout', () => request.destroy(new Error(`registry timeout for ${name}`)));
        request.on('error', reject);
    });
}

async function registryDeprecated(name, version) {
    const doc = await registryDocument(name);
    const entry = doc.versions && doc.versions[version];
    if (!entry) {
        throw new Error(`${name}@${version} not found on registry`);
    }
    return entry.deprecated || null;
}

async function main() {
    const pkgs = declaredPackages();
    console.log(`Checking ${pkgs.size} declared packages at installed versions ...`);

    const missing = [];
    const queries = [];
    for (const [name, info] of pkgs) {
        const version = installedVersion(name);
        if (!version) {
            missing.push(name);
            continue;
        }
        queries.push({ name, version, declaredIn: info.declaredIn });
    }
    if (missing.length > 0) {
        console.error(`FAIL: ${missing.length} package(s) not installed (run install first): ${missing.join(', ')}`);
        process.exit(1);
    }

    const results = await Promise.all(queries.map(async q => {
        try {
            return { ...q, deprecated: await registryDeprecated(q.name, q.version) };
        } catch (error) {
            return { ...q, error: error.message };
        }
    }));

    let violations = 0;
    let allowlisted = 0;
    let errors = 0;
    for (const r of results) {
        if (r.error) {
            errors++;
            console.log(`  ! ${r.name}@${r.version}: registry check failed — ${r.error}`);
            continue;
        }
        if (!r.deprecated) {
            continue;
        }
        if (ALLOWLIST.has(r.name)) {
            allowlisted++;
            console.log(`  ~ ${r.name}@${r.version}: deprecated but allowlisted — ${ALLOWLIST.get(r.name)}`);
            console.log(`    upstream note: ${r.deprecated}`);
            continue;
        }
        violations++;
        console.log(`  X ${r.name}@${r.version} (${r.declaredIn}): DEPRECATED — ${r.deprecated}`);
    }
    if (errors > 0) {
        console.error(`\nFAIL: ${errors} registry check(s) errored (network required for this gate).`);
        process.exit(1);
    }
    if (violations > 0) {
        console.error(`\nFAIL: ${violations} deprecated package(s) without recorded exception.`);
        console.error('Add a replacement, or record an exception in scripts/check-deprecated.js ALLOWLIST.');
        process.exit(1);
    }
    console.log(`\nOK: no unrecorded deprecated packages (${allowlisted} allowlisted).`);
}

main().catch(error => {
    console.error(`FAIL: ${error.message}`);
    process.exit(1);
});

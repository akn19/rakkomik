const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { zipSync } = require('fflate');
const config = require('./deploy-web.config');

const run = promisify(execFile);

/**
 * Run the GitHub CLI (authenticated through GITHUB_TOKEN).
 */
async function gh(args, silent) {
    if(!silent) {
        console.log('> gh', args.join(' '));
    }
    const { stdout } = await run('gh', args, { maxBuffer: 16 * 1024 * 1024 });
    if(!silent) {
        console.log(stdout);
    }
    return stdout;
}

/**
 * Channel this deployment publishes (`main`, `6.1.7`, ...).
 * In CI derived from GITHUB_REF (`refs/heads/<branch>`), otherwise from
 * the CHANNEL environment variable (manual runs).
 */
function resolveChannel() {
    if(config.channel) {
        return config.channel;
    }
    const ref = process.env.GITHUB_REF || '';
    const match = ref.match(/^refs\/heads\/(.+)$/);
    if(match) {
        return match[1].replace(/\//g, '-');
    }
    throw new Error('Cannot derive deployment channel: set CHANNEL or run in GitHub Actions (GITHUB_REF)! E.g. CHANNEL=main node deploy-web.js');
}

function validateEnvironment() {
    if(!process.env.RAKKOMIK_PRIVATE_KEY) {
        throw new Error('Missing environment variable "RAKKOMIK_PRIVATE_KEY" providing the PEM signing key!');
    }
    if(!process.env.RAKKOMIK_PASSPHRASE) {
        throw new Error('Missing environment variable "RAKKOMIK_PASSPHRASE" to decrypt private key for signature!');
    }
    if(!process.env.GITHUB_TOKEN) {
        throw new Error('Missing environment variable "GITHUB_TOKEN" for GitHub Releases upload (gh CLI)!');
    }
    if(!process.env.GITHUB_REPOSITORY) {
        throw new Error('Missing environment variable "GITHUB_REPOSITORY" (owner/repo) for GitHub Releases upload!');
    }
}

/**
 * All files below `directory` as { "posix/relative/path": bytes } (the ZIP entry layout).
 */
async function readTree(directory) {
    const entries = await fs.readdir(directory, { recursive: true, withFileTypes: true });
    const files = {};
    for(const entry of entries.filter(entry => entry.isFile())) {
        const file = path.join(entry.parentPath, entry.name);
        files[path.relative(directory, file).split(path.sep).join('/')] = new Uint8Array(await fs.readFile(file));
    }
    return files;
}

/**
 * Create the ZIP archive of the web bundle and its meta file:
 * `<archive>?signature=<hex>` with an RSA/SHA-256 signature (PKCS#1 v1.5) the
 * client verifies with its public key (UpdatePackageInfo). The private key
 * stays in memory; it is never written to disk.
 * @returns {Promise<string[]>} paths of the archive and the meta file
 */
async function pack(directory, archive, meta) {
    const data = zipSync(await readTree(directory), { level: 6 });
    const signature = crypto.sign('sha256', data, {
        key: process.env.RAKKOMIK_PRIVATE_KEY,
        passphrase: process.env.RAKKOMIK_PASSPHRASE
    }).toString('hex');
    await fs.writeFile(path.join(directory, archive), data);
    await fs.writeFile(path.join(directory, meta), `${archive}?signature=${signature}`);
    return [ path.join(directory, archive), path.join(directory, meta) ];
}

/**
 * Publish the archive + meta file as assets of the rolling channel release
 * (created on first deploy). `--clobber` overwrites the previous assets, so
 * the static `.../releases/download/<tag>/latest` URL keeps working.
 */
async function publishRelease(tag, files) {
    const repo = process.env.GITHUB_REPOSITORY;
    const sha = process.env.GITHUB_SHA || '';
    try {
        await gh([ 'release', 'view', tag, '--repo', repo ], true);
    } catch(error) {
        const notes = 'Rolling web-application cache for update channel. Do not use these assets directly, they are consumed by the desktop client updater.';
        await gh([ 'release', 'create', tag, '--repo', repo, '--title', `Web cache (${tag})`, '--notes', notes, ...sha ? [ '--target', sha ] : [] ]);
    }
    await gh([ 'release', 'upload', tag, ...files, '--repo', repo, '--clobber' ]);
}

async function main() {
    validateEnvironment();
    const channel = resolveChannel();
    const tag = config.tagPrefix + channel;
    const archive = Date.now().toString(36).toUpperCase() + '.zip';
    const files = await pack(path.resolve(config.build), archive, config.meta);
    await publishRelease(tag, files);
}

module.exports = { pack, readTree, resolveChannel };

if(require.main === module) {
    // exit application as soon as any uncaught exception is thrown
    process.on('unhandledRejection', error => { throw error; });
    main();
}

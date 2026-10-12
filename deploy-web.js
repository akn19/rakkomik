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
    const files = await readTree(directory);
    // an earlier run in this folder left its archive (the one its meta file names) and its meta file behind: they are not part of the bundle
    if(files[meta]) {
        delete files[new TextDecoder().decode(files[meta]).split('?')[0]];
        delete files[meta];
    }
    const data = zipSync(files, { level: 6 });
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
 * (created on first deploy). `--clobber` overwrites the previous meta file, so
 * the static `.../releases/download/<tag>/latest` URL keeps working. Every
 * archive has a name of its own: the earlier ones are removed afterwards.
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

/**
 * Delete the archives of the earlier deployments from the rolling release. The application only reads the meta file and
 * the archive that it names, every other archive is megabytes that nobody asks for. What stays is decided by the meta
 * file as it is now, not by the archive that this run uploaded: a deployment that overlaps this one may have replaced
 * it already, and its archive must survive. When the meta file cannot be read, or names no archive of the release,
 * nothing is deleted. Cleaning up is not part of publishing: a failure is reported, the next deployment tries again.
 */
async function removeOldArchives(tag, meta) {
    const repo = process.env.GITHUB_REPOSITORY;
    try {
        const current = (await gh([ 'release', 'download', tag, '--repo', repo, '--pattern', meta, '--output', '-' ], true)).split('?')[0].trim();
        const { assets } = JSON.parse(await gh([ 'release', 'view', tag, '--repo', repo, '--json', 'assets' ], true));
        const names = assets.map(asset => asset.name);
        if(!current || !names.includes(current)) {
            throw new Error(`The meta file "${meta}" names "${current}", which is not an asset of the release "${tag}"`);
        }
        for(const name of names.filter(name => name.endsWith('.zip') && name !== current)) {
            await gh([ 'release', 'delete-asset', tag, name, '--repo', repo, '--yes' ]);
        }
    } catch(error) {
        console.warn(`Could not remove the old archives of "${tag}": ${error.message}`);
    }
}

async function main() {
    validateEnvironment();
    const channel = resolveChannel();
    const tag = config.tagPrefix + channel;
    const archive = Date.now().toString(36).toUpperCase() + '.zip';
    const files = await pack(path.resolve(config.build), archive, config.meta);
    await publishRelease(tag, files);
    await removeOldArchives(tag, config.meta);
}

module.exports = { pack, readTree, resolveChannel };

if(require.main === module) {
    // exit application as soon as any uncaught exception is thrown
    process.on('unhandledRejection', error => { throw error; });
    main();
}

const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const exec = require('child_process').exec;
const config = require('./deploy-web.config');

function execute(command, silent) {
    if(!silent) {
        console.log('>', command);
    }
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if(!silent) {
                console.log(stdout);
                console.log(stderr);
            }
            if(error) {
                reject(error);
            } else {
                resolve(stdout);
            }
        });
    });
}

/**
 * Channel this deployment publishes (`master`, `6.1.7`, ...).
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
    throw new Error('Cannot derive deployment channel: set CHANNEL or run in GitHub Actions (GITHUB_REF)! E.g. CHANNEL=master node deploy-web.js');
}

function validateEnvironment() {
    if(!process.env.HAKUNEKO_PRIVATE_KEY) {
        throw new Error('Missing environment variable "HAKUNEKO_PRIVATE_KEY" providing the PEM signing key!');
    }
    if(!process.env.HAKUNEKO_PASSPHRASE) {
        throw new Error('Missing environment variable "HAKUNEKO_PASSPHRASE" to decrypt private key for signature!');
    }
    if(!process.env.GITHUB_TOKEN) {
        throw new Error('Missing environment variable "GITHUB_TOKEN" for GitHub Releases upload (gh CLI)!');
    }
    if(!process.env.GITHUB_REPOSITORY) {
        throw new Error('Missing environment variable "GITHUB_REPOSITORY" (owner/repo) for GitHub Releases upload!');
    }
}

/**
 * Materialize the PEM signing key from the HAKUNEKO_PRIVATE_KEY secret
 * into a temp file (0600). Returns the file path; caller must delete it.
 */
async function writePrivateKey() {
    let file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'hakuneko-deploy-')), 'key.pem');
    await fs.writeFile(file, process.env.HAKUNEKO_PRIVATE_KEY, { mode: 0o600 });
    return file;
}

async function sslPack(keyFile, archive, meta) {
    let cwd = process.cwd();
    if(config.build) {
        process.chdir(config.build);
    }
    await execute(`zip -r ${archive} . > /dev/null`);
    let signature = await execute(`openssl dgst -sha256 -hex -sign ${keyFile} -passin env:HAKUNEKO_PASSPHRASE ${archive} | cut -d' ' -f2`);
    await fs.writeFile(meta, `${archive}?signature=${signature.trim()}`);
    process.chdir(cwd);
}

/**
 * Publish the archive + meta file as assets of the rolling channel release
 * (created on first deploy). `--clobber` overwrites the previous assets, so
 * the static `.../releases/download/<tag>/latest` URL keeps working.
 */
async function publishRelease(tag, files) {
    let repo = process.env.GITHUB_REPOSITORY;
    let sha = process.env.GITHUB_SHA || '';
    try {
        await execute(`gh release view ${tag} --repo ${repo}`, true);
    } catch(error) {
        await execute(`gh release create ${tag} --repo ${repo} --title "Web cache (${tag})" --notes "Rolling web-application cache for update channel. Do not use these assets directly, they are consumed by the desktop client updater." ${sha ? `--target ${sha}` : ''}`);
    }
    await execute(`gh release upload ${tag} ${files.map(file => `"${file}"`).join(' ')} --repo ${repo} --clobber`);
}

async function main() {
    validateEnvironment();
    let channel = resolveChannel();
    let tag = config.tagPrefix + channel;
    let archive = Date.now().toString(36).toUpperCase() + '.zip';
    let keyFile = await writePrivateKey();
    try {
        await sslPack(keyFile, archive, config.meta);
        let directory = path.resolve(config.build);
        await publishRelease(tag, [path.join(directory, archive), path.join(directory, config.meta)]);
    } finally {
        await fs.remove(path.dirname(keyFile));
    }
}

// exit application as soon as any uncaught exception is thrown
process.on('unhandledRejection', error => { throw error; });
main();

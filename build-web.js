const path = require('path');
const fs = require('fs/promises');
const exec = require('child_process').exec;
const config = require('./build-web.config');
config.source = config.source || 'src';
config.target = config.target || 'build';

function execute(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout) => error ? reject(error) : resolve(stdout));
    });
}

/**
 * Copy a file or a whole directory tree (the bundle is plain static files).
 */
async function copyTree(source, target) {
    let stats = await fs.stat(source);
    if(!stats.isDirectory()) {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(source, target);
        return;
    }
    await fs.mkdir(target, { recursive: true });
    for(let entry of await fs.readdir(source)) {
        await copyTree(path.join(source, entry), path.join(target, entry));
    }
}

async function createVersionInfo(file) {
    let branch = (await execute(`git rev-parse --abbrev-ref HEAD`)).trim();
    let revision = (await execute(`git rev-parse HEAD`)).trim();
    let content = [
        `export default {`,
        `    branch: {`,
        `        label: '${branch}',`,
        `        link: 'https://github.com/manga-download/hakuneko/commits/${branch}',`,
        `    },`,
        `    revision: {`,
        `        label: '${revision.slice(0, 6)}',`,
        `        link: 'https://github.com/manga-download/hakuneko/commits/${revision}',`,
        `    }`,
        `};`
    ].join('\n');
    await fs.writeFile(file, content);
}

async function main() {
    // the UI bundle must have been built first (`pnpm run build:ui`)
    await fs.access(path.join(config.source, 'ui', 'dist', 'ui.js'));
    await fs.rm(config.target, { recursive: true, force: true });
    for(let entry of config.include) {
        await copyTree(path.join(config.source, entry), path.join(config.target, entry));
    }
    await createVersionInfo(path.join(config.target, config.version));
}

// exit application as soon as any uncaught exception is thrown
process.on('unhandledRejection', error => { throw error; });
main();

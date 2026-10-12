// Fakes and fixtures for the tests of the packagers (`build-app.js`): they run in a temporary working directory, on a
// shell that only records the commands it is given, and with a network that does not exist.
const fs = require('node:fs');
const path = require('node:path');
const { loadToolScript, createConsole } = require('./toolScripts');

const REPOSITORY = path.resolve(__dirname, '..', '..', '..', '..');
const BUILD_APP = path.join(REPOSITORY, 'build-app.js');

// what `@electron/fuses` looks for in the executable, followed by the version of the wire and its length
const FUSE_SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX';
// the wire of a stock Electron 44 (nine fuses, the first one is RunAsNode): "1" is enabled, "0" disabled
const STOCK_FUSES = '101100011';

// the Info.plist of an Electron application, reduced to a few keys; Apple indents with tabs
const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleDisplayName</key>
\t<string>Electron</string>
\t<key>CFBundleExecutable</key>
\t<string>Electron</string>
\t<key>CFBundleIconFile</key>
\t<string>electron.icns</string>
\t<key>CFBundleIdentifier</key>
\t<string>com.github.Electron</string>
\t<key>CFBundleInfoDictionaryVersion</key>
\t<string>6.0</string>
\t<key>CFBundleName</key>
\t<string>Electron</string>
\t<key>CFBundlePackageType</key>
\t<string>APPL</string>
\t<key>CFBundleShortVersionString</key>
\t<string>44.7.0</string>
\t<key>CFBundleVersion</key>
\t<string>44.7.0</string>
\t<key>LSMinimumSystemVersion</key>
\t<string>12.0</string>
\t<key>NSPrincipalClass</key>
\t<string>AtomApplication</string>
</dict>
</plist>
`;

/**
 * Stands in for `exec` of `node:child_process`: records the commands instead of running them. `respond` decides the
 * answer; it returns the stdout, an Error (the command fails) or `{ stdout, stderr, error }`.
 */
function createCommandRunner() {
    const runner = {
        commands: [],
        respond: () => '',
        exec(command, callback) {
            runner.commands.push(command);
            Promise.resolve().then(() => {
                let answer;
                try {
                    answer = runner.respond(command);
                } catch (error) {
                    answer = error;
                }
                if (answer instanceof Error) {
                    callback(answer, '', answer.message);
                } else if (typeof answer === 'string') {
                    callback(null, answer, '');
                } else {
                    callback(answer.error ?? null, answer.stdout ?? '', answer.stderr ?? '');
                }
            });
        },
    };
    return runner;
}

/**
 * Load a copy of `build-app.js` that never touches the real shell, the network or the real process: it gets a
 * recording shell, a console that records, a `fetch` that fails, and the `process` of a platform of the test's choice.
 * `@electron/asar`, `@electron/fuses`, the file system and the path module are the real ones unless `modules` says
 * otherwise (`node:path` can be `path.win32`, for the content that only a Windows host writes).
 * @param {object} [options]
 * @param {string} [options.platform] `process.platform` of the script
 * @param {string[]} [options.argv] `process.argv` of the script
 * @param {Record<string, any>} [options.modules] modules that `require` answers with something else
 * @param {Function} [options.fetch] `fetch` of the script (it fails on any access by default)
 * @param {boolean} [options.entry] the script is the entry point of the process (`require.main === module`)
 * @param {(module: object) => void} [options.onEntry] called when the script is about to run its entry point
 * @param {string[]} [options.expose] private bindings of the script that `exposed` returns
 */
function loadBuildApp({
    platform = process.platform,
    argv = ['node', 'build-app.js'],
    modules = {},
    fetch,
    entry = false,
    onEntry,
    expose,
} = {}) {
    const runner = createCommandRunner();
    const output = createConsole();
    const fakeProcess = { platform, argv, on: vi.fn() };
    const noNetwork = async (uri) => {
        throw new Error(`Unexpected network access: ${uri}`);
    };
    const { module, exposed } = loadToolScript(BUILD_APP, {
        modules: { 'node:child_process': { exec: runner.exec }, ...modules },
        globals: { process: fakeProcess, console: output, fetch: fetch ?? noNetwork },
        entry,
        onEntry,
        expose,
    });
    return { ...module.exports, runner, output, process: fakeProcess, exposed };
}

/**
 * The bytes of an Electron executable as far as the fuses are concerned: the sentinel, the version of the wire (1),
 * its length and the states.
 */
function electronExecutable(wire = STOCK_FUSES) {
    return Buffer.concat([
        Buffer.from('binary header\0'),
        Buffer.from(FUSE_SENTINEL),
        Buffer.from([1, wire.length]),
        Buffer.from(wire, 'latin1'),
        Buffer.from('\0binary tail'),
    ]);
}

/**
 * The fuse wire that an executable holds, read from its bytes (and not with `@electron/fuses`, which is under test).
 * @returns {string} the states, e.g. "000001011"
 */
function readFuseWire(file) {
    const bytes = fs.readFileSync(file);
    const end = bytes.indexOf(FUSE_SENTINEL) + FUSE_SENTINEL.length;
    return bytes.toString('latin1', end + 2, end + 2 + bytes[end + 1]);
}

function write(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

/**
 * What the archive of an Electron release holds, as far as the packagers use it, written to `directory`.
 * @param {string} directory
 * @param {'linux'|'win32'|'darwin'} platform
 * @param {Buffer} [executable] the executable (a file with a fuse wire by default)
 */
function writeElectronArchive(directory, platform, executable = electronExecutable()) {
    const files = {
        linux: {
            electron: executable,
            'chrome-sandbox': 'sandbox',
            'libffmpeg.so': 'library',
            'locales/en-US.pak': 'locale',
            'resources/default_app.asar': 'default app',
        },
        win32: {
            'electron.exe': executable,
            'ffmpeg.dll': 'library',
            'd3dcompiler_47.dll': 'shader compiler',
            'locales/en-US.pak': 'locale',
            'resources/default_app.asar': 'default app',
        },
        darwin: {
            'Electron.app/Contents/MacOS/Electron': executable,
            'Electron.app/Contents/Resources/default_app.asar': 'default app',
            'Electron.app/Contents/Resources/electron.icns': 'icons of electron',
            'Electron.app/Contents/Info.plist': INFO_PLIST,
        },
    }[platform];
    for (const [name, content] of Object.entries(files)) {
        write(path.join(directory, ...name.split('/')), content);
    }
}

/**
 * The sources of the application (what `config.src` names) and the web part that every package carries, written to the
 * working directory.
 */
function writeSources() {
    write(path.join('src', 'app', 'main.js'), 'process.exit(0);');
    write(
        path.join('src', 'app', 'package.json'),
        '{ "name": "app", "main": "main.js", "dependencies": { "dep": "1.0.0" } }',
    );
    // a dependency with a file for its developers, and a unit test of the shell: neither is part of a package
    write(
        path.join('src', 'app', 'node_modules', 'dep', 'package.json'),
        '{ "name": "dep", "main": "index.js" }',
    );
    write(path.join('src', 'app', 'node_modules', 'dep', 'index.js'), 'module.exports = {};');
    write(path.join('src', 'app', 'node_modules', 'dep', 'index.d.ts'), 'export {};');
    write(path.join('src', 'app', '__tests__', 'main.test.js'), 'test();');
    write(path.join('build', 'web', 'index.html'), '<html>web part</html>');
    write(path.join('build', 'web', 'mjs', 'engine', 'Engine.mjs'), 'export default {};');
}

// the entries of an app.asar that every package holds, and the ones that none holds (see writeSources)
const PACKED = [
    '/main.js',
    '/package.json',
    '/node_modules/dep/package.json',
    '/node_modules/dep/index.js',
];
const NOT_PACKED = ['/node_modules/dep/index.d.ts', '/__tests__/main.test.js'];

module.exports = {
    REPOSITORY,
    FUSE_SENTINEL,
    STOCK_FUSES,
    INFO_PLIST,
    loadBuildApp,
    electronExecutable,
    readFuseWire,
    writeElectronArchive,
    writeSources,
    PACKED,
    NOT_PACKED,
    write,
};

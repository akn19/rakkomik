// The command line of the packagers: `node build-app.js [windows] [linux] [macos]`. The function that reads it is not
// exported, so the tests load the script twice over: with `main` handed out, to run it with the targets of their
// choice, and as the entry point of a process, to see what it does with `process.argv` and with the platform.
const config = require('../../../build-app.config');
const { loadBuildApp } = require('./support/buildAppHarness');
const { settle } = require('./support/toolScripts');

// every build step of every packager becomes a record in `calls`; nothing is built
function recordBuilds({ ElectronPackagerWindows, ElectronPackagerLinux, ElectronPackagerDarwin }, calls, failing = null) {
    const steps = [
        [ ElectronPackagerWindows, [ 'buildIS', 'buildZIP' ] ],
        [ ElectronPackagerLinux, [ 'buildDEB', 'buildRPM' ] ],
        [ ElectronPackagerDarwin, [ 'buildDMG' ] ]
    ];
    for(const [ Packager, methods ] of steps) {
        for(const method of methods) {
            Packager.prototype[method] = async function (architecture) {
                calls.push(`${method} ${architecture}`);
                expect(this._configuration).toBe(config);
                if(method === failing) {
                    throw new Error(`${method} failed`);
                }
            };
        }
    }
}

function mainOf(platform) {
    const app = loadBuildApp({ platform, expose: [ 'main', 'hosts' ] });
    const calls = [];
    recordBuilds(app, calls);
    return { ...app, calls, main: app.exposed.main, hosts: app.exposed.hosts };
}

describe('main', () => {
    it('should know the host that builds each target', () => {
        expect(mainOf('linux').hosts).toEqual({ windows: 'win32', linux: 'linux', macos: 'darwin' });
    });

    describe('the targets', () => {
        it.each([
            [ 'windows', 'win32', [ 'buildIS 64', 'buildIS ARM64', 'buildZIP 64', 'buildZIP ARM64' ] ],
            [ 'linux', 'linux', [ 'buildDEB 64', 'buildDEB ARM64', 'buildRPM 64', 'buildRPM ARM64' ] ],
            [ 'macos', 'darwin', [ 'buildDMG 64', 'buildDMG ARM64' ] ]
        ])('should build the packages of %s for both architectures on its own host, the 64-bit one first', async (target, host, expected) => {
            const { main, calls } = mainOf(host);
            await main([ target ]);
            expect(calls).toEqual(expected);
        });

        it.each([ 'linux', 'darwin' ])('should build the archive of Windows on %s, and skip the installer that needs Windows', async host => {
            const { main, calls, output } = mainOf(host);
            await main([ 'windows' ]);
            expect(calls).toEqual([ 'buildZIP 64', 'buildZIP ARM64' ]);
            expect(output.lines()).toEqual([ 'Skipping the Inno Setup installers, they can only be built on Windows.' ]);
        });

        it('should say nothing about the installer on a Windows host, which builds it', async () => {
            const { main, output } = mainOf('win32');
            await main([ 'windows' ]);
            expect(output.lines()).toEqual([]);
        });

        it('should build the targets in the order they are given', async () => {
            const { main, calls } = mainOf('linux');
            await main([ 'windows', 'linux' ]);
            expect(calls).toEqual([ 'buildZIP 64', 'buildZIP ARM64', 'buildDEB 64', 'buildDEB ARM64', 'buildRPM 64', 'buildRPM ARM64' ]);
        });

        it('should build nothing for no target', async () => {
            const { main, calls } = mainOf('linux');
            await main([]);
            expect(calls).toEqual([]);
        });

        it('should stop at the first build that fails, and let the error out', async () => {
            const app = loadBuildApp({ platform: 'linux', expose: [ 'main' ] });
            const calls = [];
            recordBuilds(app, calls, 'buildRPM');
            await expect(app.exposed.main([ 'linux', 'windows' ])).rejects.toThrow('buildRPM failed');
            expect(calls).toEqual([ 'buildDEB 64', 'buildDEB ARM64', 'buildRPM 64' ]);
        });
    });

    describe('the arguments that it refuses', () => {
        it.each([ 'android', 'Windows', '--help', '', 'windows,linux' ])('should name the targets that exist when it is given "%s"', async target => {
            const { main, calls } = mainOf('linux');
            await expect(main([ target ])).rejects.toThrow(`Unknown target "${target}", use one of: windows, linux, macos`);
            expect(calls).toEqual([]);
        });

        it.each([
            [ 'linux', 'win32' ],
            [ 'linux', 'darwin' ],
            [ 'macos', 'linux' ],
            [ 'macos', 'win32' ]
        ])('should refuse the target %s on a host of %s, which has not the tools for it', async (target, host) => {
            const { main, calls } = mainOf(host);
            await expect(main([ target ])).rejects.toThrow(`The ${target} packages can only be built on ${target}; the "Build Desktop Installers" workflow builds them.`);
            expect(calls).toEqual([]);
        });

        it('should refuse all the arguments before it builds the first target', async () => {
            const { main, calls } = mainOf('linux');
            await expect(main([ 'windows', 'macos' ])).rejects.toThrow('The macos packages can only be built on macos');
            await expect(main([ 'linux', 'bogus' ])).rejects.toThrow('Unknown target "bogus"');
            expect(calls).toEqual([]);
        });

        it.each([ 'constructor', 'toString', 'hasOwnProperty', '__proto__' ])('should not take "%s" for a target', async target => {
            const { main } = mainOf('linux');
            await expect(main([ target ])).rejects.toThrow(`Unknown target "${target}", use one of: windows, linux, macos`);
        });
    });
});

describe('the entry point', () => {
    // the entry point runs `main` as soon as the script is loaded: the builds are replaced before that, by the hook
    // that runs when the script asks whether it is the entry point (after its exports are assigned)
    async function run({ platform, argv = [ 'node', 'build-app.js' ] }) {
        const calls = [];
        const app = loadBuildApp({ platform, argv, entry: true, onEntry: module => recordBuilds(module.exports, calls) });
        await settle();
        return { ...app, calls };
    }

    it('should export the packagers and run nothing when it is only required', () => {
        const app = loadBuildApp();
        expect(Object.keys(app).filter(key => key.startsWith('ElectronPackager'))).toEqual([ 'ElectronPackagerLinux', 'ElectronPackagerWindows', 'ElectronPackagerDarwin' ]);
        expect(app.process.on).not.toHaveBeenCalled();
        expect(app.runner.commands).toEqual([]);
    });

    it.each([
        [ 'win32', [ 'buildIS 64', 'buildIS ARM64', 'buildZIP 64', 'buildZIP ARM64' ] ],
        [ 'linux', [ 'buildDEB 64', 'buildDEB ARM64', 'buildRPM 64', 'buildRPM ARM64' ] ],
        [ 'darwin', [ 'buildDMG 64', 'buildDMG ARM64' ] ]
    ])('should build the packages of the platform it runs on when it has no argument (%s)', async (platform, expected) => {
        const { calls } = await run({ platform });
        expect(calls).toEqual(expected);
    });

    // NOTE: a platform without a packager (FreeBSD) gets no message and an exit code of 0, with nothing built
    it('should build nothing on a platform that has no packages', async () => {
        const { calls } = await run({ platform: 'freebsd' });
        expect(calls).toEqual([]);
    });

    it('should build the targets that are named, in that order, and not those of the platform', async () => {
        const { calls } = await run({ platform: 'linux', argv: [ 'node', 'build-app.js', 'windows', 'linux' ] });
        expect(calls).toEqual([ 'buildZIP 64', 'buildZIP ARM64', 'buildDEB 64', 'buildDEB ARM64', 'buildRPM 64', 'buildRPM ARM64' ]);
        const named = await run({ platform: 'win32', argv: [ 'node', 'build-app.js', 'windows' ] });
        expect(named.calls).toEqual([ 'buildIS 64', 'buildIS ARM64', 'buildZIP 64', 'buildZIP ARM64' ]);
    });

    it('should turn a promise that nobody handles into an uncaught exception, which ends the build with an error', async () => {
        const { process: fake } = await run({ platform: 'linux' });
        const registered = fake.on.mock.calls.filter(([ event ]) => event === 'unhandledRejection');
        expect(registered).toHaveLength(1);
        const error = new Error('the build failed');
        expect(() => registered[0][1](error)).toThrow(error);
    });
});

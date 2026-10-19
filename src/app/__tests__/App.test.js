const { mockModule } = require('./support/mockRequire');
const fs = require('node:fs');
const path = require('node:path');

mockModule('electron', () => {
    return {
        ipcMain: {
            handle: vi.fn(),
            on: vi.fn(),
        },
        app: {
            getAppPath: vi.fn(() => '/usr/bin'),
            getPath: vi.fn((type) => {
                switch (type) {
                    case 'exe':
                        return '/usr/bin/rakkomik';
                    case 'appData':
                        return 'data';
                    case 'userData':
                        return 'data/rakkomik';
                    case 'userCache':
                        return 'cache/rakkomik';
                    default:
                        return undefined;
                }
            }),
            name: 'RakKomik',
        },
        dialog: {},
        shell: {},
        session: {},
        BrowserWindow: vi.fn(),
    };
});

const electron = require('electron');
const App = require('../App.js');
const Configuration = require('../Configuration');
const ConfigurationLinux = require('../ConfigurationLinux');
const ConfigurationDarwin = require('../ConfigurationDarwin');
const ConfigurationWindows = require('../ConfigurationWindows');
const { FileLogger, ConsoleLogger } = require('../Logger');
var logger = new FileLogger(__filename + '.log', FileLogger.LEVEL.All);
logger.clear();

// a logger that says nothing and can be asked what it was told
function quiet() {
    return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), verbose: vi.fn() };
}

describe('App', function () {
    beforeEach(() => {
        vi.clearAllMocks();
        // builtins are not module-mocked: stub the shared `fs` export object instead
        vi.spyOn(fs, 'existsSync');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('_configuration', function () {
        it('should return default configuration when in portable mode', () => {
            fs.existsSync.mockReturnValueOnce(true);
            let testee = new App(logger);
            expect(testee._configuration instanceof Configuration).toBeTruthy();
            expect(testee._configuration instanceof ConfigurationWindows).toBeFalsy();
            expect(testee._configuration instanceof ConfigurationDarwin).toBeFalsy();
            expect(testee._configuration instanceof ConfigurationLinux).toBeFalsy();
        });
        it('should return platform specific configuration', () => {
            fs.existsSync.mockReturnValueOnce(false);
            let testee = new App(logger);
            if (process.platform === 'linux') {
                expect(testee._configuration instanceof ConfigurationLinux).toBeTruthy();
            }
            if (process.platform === 'darwin') {
                expect(testee._configuration instanceof ConfigurationDarwin).toBeTruthy();
            }
            if (process.platform === 'win32') {
                expect(testee._configuration instanceof ConfigurationWindows).toBeTruthy();
            }
        });

        describe('with a web part that ships with the application', () => {
            const resources = path.join('/opt', 'rakkomik', 'resources');
            const argv = process.argv;

            afterEach(() => {
                electron.app.getAppPath.mockImplementation(() => '/usr/bin');
                process.argv = argv;
            });

            // the folder is only what the cache is filled with: the cache directory and the update URL stay as they were
            it('should leave the cache directory and the update URL as they are', () => {
                let without = new App(logger)._configuration;
                electron.app.getAppPath.mockImplementation(() => path.join(resources, 'app.asar'));
                fs.existsSync.mockImplementation(
                    (file) => file === path.join(resources, 'web', 'index.html'),
                );
                let testee = new App(logger);
                // the directory as the configuration names it, before it is made absolute against the application
                expect(testee._configuration._applicationCacheDirectory).toEqual(
                    without._applicationCacheDirectory,
                );
                expect(testee._configuration.applicationUpdateURL).toEqual(
                    'https://github.com/akn19/rakkomik/releases/download/web-main/latest',
                );
            });
            it('should leave the cache directory and the update URL to the command line', () => {
                electron.app.getAppPath.mockImplementation(() => path.join(resources, 'app.asar'));
                process.argv = [
                    ...argv,
                    '--cache-directory=/custom/cache',
                    '--update-url=DISABLED',
                ];
                let testee = new App(logger);
                expect(testee._configuration.applicationCacheDirectory).toEqual(
                    path.resolve('/custom/cache'),
                );
                expect(testee._configuration.applicationUpdateURL).toEqual('DISABLED');
            });
        });
    });

    describe('with the platform it runs on', () => {
        const platform = Object.getOwnPropertyDescriptor(process, 'platform');

        function onPlatform(value) {
            Object.defineProperty(process, 'platform', { ...platform, value });
        }

        afterEach(() => {
            Object.defineProperty(process, 'platform', platform);
        });

        it.each([
            ['linux', ConfigurationLinux],
            ['darwin', ConfigurationDarwin],
            ['win32', ConfigurationWindows],
        ])('should configure %s for itself', (name, Expected) => {
            onPlatform(name);
            let testee = new App(quiet());
            expect(testee._configuration.constructor).toBe(Expected);
        });

        it.each(['linux', 'darwin', 'win32'])(
            'should leave the platform out of it in the portable mode (%s)',
            (name) => {
                onPlatform(name);
                fs.existsSync.mockReturnValueOnce(true);
                let testee = new App(quiet());
                expect(testee._configuration.constructor).toBe(Configuration);
            },
        );

        // NOTE: Electron does not run on other systems, so there is nothing to configure and nothing to start.
        it('should not start on a system without a configuration', () => {
            onPlatform('freebsd');
            expect(() => new App(quiet())).toThrow(TypeError);
        });
    });

    describe('constructor', () => {
        it('should register every channel of the preload bridge once, as Electron does not take a second handler', () => {
            new App(quiet());
            let channels = electron.ipcMain.handle.mock.calls.map(([channel]) => channel);
            expect(new Set(channels).size).toBe(channels.length);
            expect(channels).toHaveLength(29);
            // one of each part of the main process
            expect(channels).toEqual(
                expect.arrayContaining([
                    'rakkomik:fs:readFile',
                    'rakkomik:exec',
                    'rakkomik:fetch',
                    'rakkomik:presence:ensureStarted',
                    'rakkomik:sqlite:query',
                    'rakkomik:pdf:render',
                ]),
            );
        });

        it('should log through a console logger of its own when it is given none', () => {
            expect(new App()._logger).toBeInstanceOf(ConsoleLogger);
        });

        it('should hand its logger to the parts that report', () => {
            let own = quiet();
            let testee = new App(own);
            expect(testee._logger).toBe(own);
            expect(testee._updater._logger).toBe(own);
            expect(testee._electron._logger).toBe(own);
        });
    });

    describe('printInfo()', () => {
        const versions = Object.getOwnPropertyDescriptor(process, 'versions');

        afterEach(() => {
            Object.defineProperty(process, 'versions', versions);
        });

        it('should print the versions of Electron, Chromium and Node.js', () => {
            let log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
            let testee = new App(quiet());
            Object.defineProperty(process, 'versions', {
                ...versions,
                value: { ...process.versions, electron: '44.7.0', chrome: '152.0.7977.130' },
            });
            testee.printInfo();
            let lines = log.mock.calls.map((args) => args.join(' '));
            expect(lines).toContain('Framework Info');
            expect(lines).toContain('Electron : 44.7.0');
            expect(lines).toContain('Chrome   : 152.0.7977.130');
            expect(lines).toContain(`Node     : ${process.versions.node}`);
        });
    });

    describe('run()', () => {
        const portable = process.env.RAKKOMIK_PORTABLE;
        let calls = null;
        let own = null;
        let testee = null;

        // what the process does with the web part, in the order it happens
        function fakeElectron(application) {
            application._electron = {
                launch: vi.fn(async () => {
                    calls.push(['launch', process.env.RAKKOMIK_PORTABLE]);
                }),
                loadHTML: vi.fn(async (html) => {
                    calls.push(['loadHTML', html]);
                }),
                loadURL: vi.fn(async (url) => {
                    calls.push(['loadURL', url]);
                }),
            };
        }

        function fakeUpdater(application) {
            application._updater = {
                updateCache: vi.fn(async (key) => {
                    calls.push(['updateCache', key]);
                }),
            };
        }

        function fakeParts(application) {
            fakeElectron(application);
            fakeUpdater(application);
        }

        beforeEach(() => {
            calls = [];
            // `run()` prints the usage, the framework and the configuration
            vi.spyOn(console, 'log').mockImplementation(() => undefined);
            own = quiet();
            testee = new App(own);
            fakeParts(testee);
        });

        afterEach(() => {
            if (portable === undefined) {
                delete process.env.RAKKOMIK_PORTABLE;
            } else {
                process.env.RAKKOMIK_PORTABLE = portable;
            }
        });

        it('should show the loading page while the web part is updated, then start the application', async () => {
            await testee.run();
            expect(calls.map(([step]) => step)).toEqual([
                'launch',
                'loadHTML',
                'updateCache',
                'loadURL',
            ]);
            expect(own.error).not.toHaveBeenCalled();
        });

        it('should show a loading page that says what is going on', async () => {
            await testee.run();
            let html = calls.find(([step]) => step === 'loadHTML')[1];
            expect(html).toContain('Checking for Update');
            // a document of its own, in a language, with a progress bar that a screen reader can name
            expect(html).toContain('<html lang="en">');
            expect(html).toMatch(/<progress aria-label="[^"]+"><\/progress>/);
        });

        it('should check the update against the public key of the configuration and start the startup URL', async () => {
            process.argv = [...process.argv, '--startup-url=hakuneko://cache/start.html'];
            try {
                testee = new App(own);
                fakeParts(testee);
                await testee.run();
            } finally {
                process.argv = process.argv.slice(0, -1);
            }
            expect(calls.find(([step]) => step === 'updateCache')[1]).toBe(
                testee._configuration.publicKey,
            );
            expect(calls.find(([step]) => step === 'loadURL')[1]).toBe(
                'hakuneko://cache/start.html',
            );
        });

        it('should print the usage, the framework and the configuration before it launches', async () => {
            vi.spyOn(testee._extractor, 'printInfo').mockImplementation(() =>
                calls.push(['usage']),
            );
            vi.spyOn(testee, 'printInfo').mockImplementation(() => calls.push(['framework']));
            vi.spyOn(testee._configuration, 'printInfo').mockImplementation(() =>
                calls.push(['configuration']),
            );
            await testee.run();
            expect(calls.map(([step]) => step).slice(0, 4)).toEqual([
                'usage',
                'framework',
                'configuration',
                'launch',
            ]);
        });

        it('should tell the renderer about the portable mode before the window is created', async () => {
            fs.existsSync.mockReturnValue(true);
            await testee.run();
            expect(calls.find(([step]) => step === 'launch')[1]).toBe('TRUE');
        });

        it('should take the portable mode away when the application is not portable (any left-over of the environment)', async () => {
            process.env.RAKKOMIK_PORTABLE = 'TRUE';
            fs.existsSync.mockReturnValue(false);
            await testee.run();
            expect(calls.find(([step]) => step === 'launch')[1]).toBeUndefined();
            expect('RAKKOMIK_PORTABLE' in process.env).toBe(false);
        });

        it('should log the failure and do nothing more when the application cannot be launched', async () => {
            let failure = new Error('no display');
            testee._electron.launch.mockRejectedValue(failure);
            await expect(testee.run()).resolves.toBeUndefined();
            expect(own.error).toHaveBeenCalledWith('Failed to start application!', failure);
            expect(testee._electron.loadHTML).not.toHaveBeenCalled();
            expect(testee._updater.updateCache).not.toHaveBeenCalled();
            expect(testee._electron.loadURL).not.toHaveBeenCalled();
        });

        it('should log the failure when the update cannot even be attempted', async () => {
            let failure = new Error('unexpected');
            testee._updater.updateCache.mockRejectedValue(failure);
            await expect(testee.run()).resolves.toBeUndefined();
            expect(own.error).toHaveBeenCalledWith('Failed to start application!', failure);
        });

        describe('the web part that ships with the application', () => {
            const resources = path.join('/opt', 'rakkomik', 'resources');

            beforeEach(() => {
                electron.app.getAppPath.mockImplementation(() => path.join(resources, 'app.asar'));
                fs.existsSync.mockImplementation(
                    (file) => file === path.join(resources, 'web', 'index.html'),
                );
                testee = new App(own);
                fakeParts(testee);
                testee._cacheManager = {
                    seedFrom: vi.fn(async (directory) => {
                        calls.push(['seedFrom', directory]);
                        return true;
                    }),
                };
            });

            afterEach(() => {
                electron.app.getAppPath.mockImplementation(() => '/usr/bin');
            });

            it('should be copied into the cache before the update is looked for, and the update goes on', async () => {
                await testee.run();
                expect(calls.map(([step]) => step)).toEqual([
                    'launch',
                    'loadHTML',
                    'seedFrom',
                    'updateCache',
                    'loadURL',
                ]);
                expect(calls.find(([step]) => step === 'seedFrom')[1]).toBe(
                    path.join(resources, 'web'),
                );
                expect(own.info).toHaveBeenCalledWith(
                    'The web part of the application was copied to the cache directory',
                );
            });

            it('should say nothing when the cache has its web part already', async () => {
                testee._cacheManager.seedFrom.mockResolvedValue(false);
                await testee.run();
                expect(own.info).not.toHaveBeenCalled();
                expect(calls.map(([step]) => step)).toContain('updateCache');
            });

            it('should look for the update, and start, when the copy fails', async () => {
                let failure = new Error('disk is full');
                testee._cacheManager.seedFrom.mockRejectedValue(failure);
                await testee.run();
                expect(own.error).toHaveBeenCalledWith(
                    'The web part of the application could not be copied!',
                    failure,
                );
                expect(calls.map(([step]) => step)).toEqual([
                    'launch',
                    'loadHTML',
                    'updateCache',
                    'loadURL',
                ]);
            });
        });

        it('should not copy anything when nothing ships with the application', async () => {
            let seedFrom = vi.spyOn(testee._cacheManager, 'seedFrom');
            await testee.run();
            expect(seedFrom).toHaveBeenCalledWith(undefined);
            await expect(seedFrom.mock.results[0].value).resolves.toBe(false);
        });

        // NOTE: the startup page is not awaited: `run()` is done when the page is requested, not when it has loaded (Electron
        // keeps the rejection of a failed load from becoming an unhandled one). So a page that cannot be loaded is
        // not logged here. Characterisation.
        it('should be done when the startup page is requested, not when it has loaded', async () => {
            testee._electron.loadURL.mockReturnValue(new Promise(() => undefined));
            await expect(testee.run()).resolves.toBeUndefined();
            expect(testee._electron.loadURL).toHaveBeenCalledTimes(1);
        });
    });
});

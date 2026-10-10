const { mockModule } = require('./support/mockRequire');
const fs = require('node:fs');
const path = require('node:path');

mockModule('electron', () => {
    return {
        ipcMain: {
            handle: vi.fn(),
            on: vi.fn()
        },
        app: {
            getAppPath: vi.fn(() => '/usr/bin'),
            getPath: vi.fn(type => {
                switch(type) {
                    case 'exe': return '/usr/bin/rakkomik';
                    case 'appData': return 'data';
                    case 'userData': return 'data/rakkomik';
                    case 'userCache': return 'cache/rakkomik';
                    default: return undefined;
                }
            }),
            name: 'RakKomik'
        },
        dialog: {},
        shell: {},
        session: {},
        BrowserWindow: vi.fn()
    };
});


const electron = require('electron');
const App = require('../App.js');
const Configuration = require('../Configuration');
const ConfigurationLinux = require('../ConfigurationLinux');
const ConfigurationDarwin = require('../ConfigurationDarwin');
const ConfigurationWindows = require('../ConfigurationWindows');
const { FileLogger } = require('../Logger');
var logger = new FileLogger(__filename + '.log', FileLogger.LEVEL.All);
logger.clear();

describe('App', function() {

    beforeEach(() => {
        vi.clearAllMocks();
        // builtins are not module-mocked: stub the shared `fs` export object instead
        vi.spyOn(fs, 'existsSync');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('_configuration', function() {

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
            if(process.platform === 'linux') {
                expect(testee._configuration instanceof ConfigurationLinux).toBeTruthy();
            }
            if(process.platform === 'darwin') {
                expect(testee._configuration instanceof ConfigurationDarwin).toBeTruthy();
            }
            if(process.platform === 'win32') {
                expect(testee._configuration instanceof ConfigurationWindows).toBeTruthy();
            }

        });

        describe('with a web part that ships with the application', () => {
            const resources = path.join('/opt', 'rakkomik', 'resources');
            const argv = process.argv;

            beforeEach(() => {
                electron.app.getAppPath.mockImplementation(() => path.join(resources, 'app.asar'));
                fs.existsSync.mockImplementation(file => file === path.join(resources, 'web', 'index.html'));
            });

            afterEach(() => {
                electron.app.getAppPath.mockImplementation(() => '/usr/bin');
                process.argv = argv;
            });

            it('should use it as the cache directory and leave the update off', () => {
                let testee = new App(logger);
                expect(testee._configuration.applicationCacheDirectory).toEqual(path.join(resources, 'web'));
                expect(testee._configuration.applicationUpdateURL).toEqual('DISABLED');
            });
            it('should leave the cache directory and the update URL to the command line', () => {
                process.argv = [ ...argv, '--cache-directory=/custom/cache', '--update-url=https://example.org/latest' ];
                let testee = new App(logger);
                expect(testee._configuration.applicationCacheDirectory).toEqual(path.resolve('/custom/cache'));
                expect(testee._configuration.applicationUpdateURL).toEqual('https://example.org/latest');
            });
            it('should decide on each of the two by itself', () => {
                process.argv = [ ...argv, '--update-url=https://example.org/latest' ];
                let testee = new App(logger);
                expect(testee._configuration.applicationCacheDirectory).toEqual(path.join(resources, 'web'));
                expect(testee._configuration.applicationUpdateURL).toEqual('https://example.org/latest');
            });
        });
    });
});
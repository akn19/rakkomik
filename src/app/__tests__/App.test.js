const { mockModule } = require('./support/mockRequire');
const fs = require('node:fs');

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
                    case 'exe': return '/usr/bin/hakuneko';
                    case 'appData': return 'data';
                    case 'userData': return 'data/hakuneko';
                    case 'userCache': return 'cache/hakuneko';
                    default: return undefined;
                }
            }),
            name: 'HakuNeko'
        },
        dialog: {},
        shell: {},
        session: {},
        BrowserWindow: vi.fn()
    };
});


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
    });
});
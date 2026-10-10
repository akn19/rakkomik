const { mockModule } = require('./support/mockRequire');
const path = require('node:path');

const fs = require('node:fs');

mockModule('electron', () => {
    let path = require('node:path');
    return {
        app: {
            getAppPath: vi.fn(() => '/usr/bin'),
            getPath: vi.fn(type => {
                switch(type) {
                    case 'exe': return '/usr/bin/rakkomik';
                    case 'userData': return path.resolve(process.env.HOME, '.config', 'RakKomik');
                    case 'userCache': return path.resolve(process.env.HOME, '.cache', 'RakKomik');
                    default: return undefined;
                }
            })
        }
    };
});
const electron = require('electron');
const Configuration = require('../ConfigurationLinux.js');

var suite = function() {

    beforeEach(() => {
        vi.clearAllMocks();
        // builtins are not module-mocked: stub the shared `fs` export object instead
        vi.spyOn(fs, 'existsSync');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    let expected = {
        publicKey: 'publicKey',
        applicationProtocol: 'applicationProtocol',
        applicationUpdateURL: 'applicationUpdateURL',
        connectorProtocol: 'connectorProtocol',
        applicationStartupURL: 'protocol://applicationStartupURL',
        applicationCacheDirectory: path.resolve('/home/.cache/rakkomik'),
        applicationUserDataDirectory: path.resolve('/home/.config/rakkomik')
    };

    describe('isPortable', function() {
        it('should be true when file exists', () => {
            fs.existsSync.mockReturnValueOnce(true);
            expect(Configuration.isPortableMode).toEqual(true);
            expect(fs.existsSync).toHaveBeenCalledTimes(1);
            expect(fs.existsSync).toHaveBeenLastCalledWith('/usr/bin/rakkomik.portable');
        });
        it('should be false when file not exists', () => {
            fs.existsSync.mockReturnValueOnce(false);
            expect(Configuration.isPortableMode).toEqual(false);
            expect(fs.existsSync).toHaveBeenCalledTimes(1);
            expect(fs.existsSync).toHaveBeenLastCalledWith('/usr/bin/rakkomik.portable');
        });
    });

    describe('publicKey', function() {
        it('should be valid after initialization', () => {
            let testee = new Configuration(undefined);
            expect(testee.publicKey.startsWith('-----BEGIN PUBLIC KEY-----')).toBeTruthy();
            expect(testee.publicKey.endsWith('-----END PUBLIC KEY-----')).toBeTruthy();
            expect(testee.publicKey.includes('owIDAQAB')).toBeTruthy();
            expect(testee.publicKey.length).toEqual(450);
        });
        it('should not be overwritten by public key from options', () => {
            let testee = new Configuration(expected);
            expect(testee.publicKey).not.toEqual(expected.publicKey);
        });
    });

    describe('applicationProtocol', function() {
        it('should have default after initialization', () => {
            let testee = new Configuration(undefined);
            expect(testee.applicationProtocol).toEqual('hakuneko');
        });
        it('should be overwritten by startup URL from options', () => {
            let testee = new Configuration(expected);
            expect(testee.applicationProtocol).toEqual(expected.applicationStartupURL.split(':')[0]);
        });
    });

    describe('applicationUpdateURL', function() {
        it('should have default after initialization', () => {
            let testee = new Configuration(undefined);
            expect(testee.applicationUpdateURL).toEqual('https://github.com/akn19/rakkomik/releases/download/web-main/latest');
        });
        it('should be overwritten by update URL from options', () => {
            let testee = new Configuration(expected);
            expect(testee.applicationUpdateURL).toEqual(expected.applicationUpdateURL);
        });
    });

    describe('connectorProtocol', function() {
        it('should have default after initialization', () => {
            let testee = new Configuration(undefined);
            expect(testee.connectorProtocol).toEqual('connector');
        });
        it('should not be overwritten by protocol from options', () => {
            let testee = new Configuration(expected);
            expect(testee.connectorProtocol).not.toEqual(expected.connectorProtocol);
        });
    });

    describe('applicationStartupURL', function() {
        it('should have default after initialization', () => {
            let testee = new Configuration(undefined);
            expect(testee.applicationStartupURL).toEqual('hakuneko://cache/index.html');
        });
        it('should be overwritten by startup URL from options', () => {
            let testee = new Configuration(expected);
            expect(testee.applicationStartupURL).toEqual(expected.applicationStartupURL);
        });
    });

    describe('applicationCacheDirectory', function() {
        it('should have default after initialization', () => {
            let testee = new Configuration(undefined);
            expect(testee.applicationCacheDirectory).toEqual(path.resolve(process.env.HOME, '.cache', 'RakKomik'));
            expect(electron.app.getPath).toHaveBeenCalledTimes(3);
            expect(electron.app.getPath).toHaveBeenCalledWith('exe');
            expect(electron.app.getPath).toHaveBeenCalledWith('userData');
            expect(electron.app.getPath).toHaveBeenCalledWith('userCache');
        });
        it('should be overwritten by absolute cache directory from options', () => {
            let testee = new Configuration(expected);
            expect(testee.applicationCacheDirectory).toEqual(expected.applicationCacheDirectory);
        });
        it('should be overwritten by relative cache directory from options', () => {
            let testee = new Configuration({ applicationCacheDirectory: '../cache' });
            expect(testee.applicationCacheDirectory).toEqual(path.resolve('/usr/cache'));
        });
    });

    describe('applicationUserDataDirectory', function() {
        it('should have default after initialization', () => {
            let testee = new Configuration(undefined);
            expect(testee.applicationUserDataDirectory).toEqual(path.resolve(process.env.HOME, '.config', 'RakKomik'));
            expect(electron.app.getPath).toHaveBeenCalledTimes(3);
            expect(electron.app.getPath).toHaveBeenCalledWith('exe');
            expect(electron.app.getPath).toHaveBeenCalledWith('userData');
            expect(electron.app.getPath).toHaveBeenCalledWith('userCache');
        });
        it('should be overwritten by absolute user data directory from options', () => {
            let testee = new Configuration(expected);
            expect(testee.applicationUserDataDirectory).toEqual(expected.applicationUserDataDirectory);
        });
        it('should be overwritten by relative user data directory from options', () => {
            let testee = new Configuration({ applicationUserDataDirectory: '../data' });
            expect(testee.applicationUserDataDirectory).toEqual(path.resolve('/usr/data'));
        });
    });

    describe('applicationUserPluginsDirectory', function() {
        it('should have default after initialization', () => {
            let testee = new Configuration(undefined);
            expect(testee.applicationUserPluginsDirectory).toEqual(path.resolve(process.env.HOME, '.config', 'RakKomik', 'rakkomik.plugins'));
            expect(electron.app.getPath).toHaveBeenCalledTimes(3);
            expect(electron.app.getPath).toHaveBeenCalledWith('exe');
            expect(electron.app.getPath).toHaveBeenCalledWith('userData');
            expect(electron.app.getPath).toHaveBeenCalledWith('userCache');
        });
        it('should be changed by absolute user data directory from options', () => {
            let testee = new Configuration(expected);
            expect(testee.applicationUserPluginsDirectory).toEqual(path.resolve(expected.applicationUserDataDirectory, 'rakkomik.plugins'));
        });
        it('should be changed by relative user data directory from options', () => {
            let testee = new Configuration({ applicationUserDataDirectory: '../data' });
            expect(testee.applicationUserPluginsDirectory).toEqual(path.resolve('/usr/data/rakkomik.plugins'));
        });
    });
};

if(process.platform === 'linux') {
    describe('ConfigurationLinux', suite);
} else {
    describe.skip(`ConfigurationLinux @ ${process.platform}`, suite);
}
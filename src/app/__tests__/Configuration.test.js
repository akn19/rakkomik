const { mockModule } = require('./support/mockRequire');
const path = require('node:path');

const fs = require('node:fs');

mockModule('electron', () => {
    return {
        app: {
            getAppPath: vi.fn(() => '/usr/bin'),
            getPath: vi.fn((type) => {
                switch (type) {
                    case 'exe':
                        return '/usr/bin/rakkomik';
                    case 'userData':
                        return undefined;
                    case 'userCache':
                        return undefined;
                    default:
                        return undefined;
                }
            }),
        },
    };
});
const electron = require('electron');
const Configuration = require('../Configuration.js');

describe('Configuration', function () {
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
        applicationUserDataDirectory: path.resolve('/home/.config/rakkomik'),
    };

    describe('isPortable', function () {
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

    describe('bundledWebDirectory', function () {
        const resources = path.join('/opt', 'rakkomik', 'resources');
        it('should be undefined while the application is not packed', () => {
            expect(Configuration.bundledWebDirectory).toBeUndefined();
            expect(fs.existsSync).not.toHaveBeenCalled();
        });
        it('should be the web folder next to app.asar when it has an index page', () => {
            electron.app.getAppPath.mockReturnValueOnce(path.join(resources, 'app.asar'));
            fs.existsSync.mockReturnValueOnce(true);
            expect(Configuration.bundledWebDirectory).toEqual(path.join(resources, 'web'));
            expect(fs.existsSync).toHaveBeenLastCalledWith(
                path.join(resources, 'web', 'index.html'),
            );
        });
        it('should be undefined when the web folder next to app.asar has no index page', () => {
            electron.app.getAppPath.mockReturnValueOnce(path.join(resources, 'app.asar'));
            fs.existsSync.mockReturnValueOnce(false);
            expect(Configuration.bundledWebDirectory).toBeUndefined();
        });
    });

    describe('publicKey', function () {
        it('should be valid after initialization', () => {
            let testee = new Configuration(undefined);
            expect(testee.publicKey.startsWith('-----BEGIN PUBLIC KEY-----')).toBeTruthy();
            expect(testee.publicKey.endsWith('-----END PUBLIC KEY-----')).toBeTruthy();
            // a key the signatures of the updates can be verified with
            let key = require('node:crypto').createPublicKey(testee.publicKey);
            expect(key.asymmetricKeyType).toBe('rsa');
            expect(key.asymmetricKeyDetails.modulusLength).toBeGreaterThanOrEqual(2048);
        });
        it('should be the key of RakKomik (change this when the signing key is replaced on purpose)', () => {
            let crypto = require('node:crypto');
            let key = crypto.createPublicKey(new Configuration(undefined).publicKey);
            expect(
                crypto
                    .createHash('sha256')
                    .update(key.export({ type: 'spki', format: 'der' }))
                    .digest('hex'),
            ).toBe('7e68ab55af6e08460efbaa584b96103c10f0f6bb4b0b006d56de4bbe82f8be54');
        });
        it('should not be overwritten by public key from options', () => {
            let testee = new Configuration(expected);
            expect(testee.publicKey).not.toEqual(expected.publicKey);
        });
    });

    describe('applicationProtocol', function () {
        it('should have default after initialization', () => {
            let testee = new Configuration(undefined);
            expect(testee.applicationProtocol).toEqual('hakuneko');
        });
        it('should be overwritten by startup URL from options', () => {
            let testee = new Configuration(expected);
            expect(testee.applicationProtocol).toEqual(
                expected.applicationStartupURL.split(':')[0],
            );
        });
    });

    describe('applicationUpdateURL', function () {
        it('should have default after initialization', () => {
            let testee = new Configuration(undefined);
            expect(testee.applicationUpdateURL).toEqual(
                'https://github.com/akn19/rakkomik/releases/download/web-main/latest',
            );
        });
        it('should be overwritten by update URL from options', () => {
            let testee = new Configuration(expected);
            expect(testee.applicationUpdateURL).toEqual(expected.applicationUpdateURL);
        });
    });

    describe('connectorProtocol', function () {
        it('should have default after initialization', () => {
            let testee = new Configuration(undefined);
            expect(testee.connectorProtocol).toEqual('connector');
        });
        it('should not be overwritten by protocol from options', () => {
            let testee = new Configuration(expected);
            expect(testee.connectorProtocol).not.toEqual(expected.connectorProtocol);
        });
    });

    describe('applicationStartupURL', function () {
        it('should have default after initialization', () => {
            let testee = new Configuration(undefined);
            expect(testee.applicationStartupURL).toEqual('hakuneko://cache/index.html');
        });
        it('should be overwritten by startup URL from options', () => {
            let testee = new Configuration(expected);
            expect(testee.applicationStartupURL).toEqual(expected.applicationStartupURL);
        });
    });

    describe('applicationCacheDirectory', function () {
        it('should have default after initialization', () => {
            let testee = new Configuration(undefined);
            expect(testee.applicationCacheDirectory).toEqual(path.resolve('/usr/bin/cache'));
            expect(electron.app.getPath).toHaveBeenCalledTimes(1);
            expect(electron.app.getPath).toHaveBeenLastCalledWith('exe');
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

    describe('applicationUserDataDirectory', function () {
        it('should have default after initialization', () => {
            let testee = new Configuration(undefined);
            expect(testee.applicationUserDataDirectory).toEqual(path.resolve('/usr/bin/userdata'));
            expect(electron.app.getPath).toHaveBeenCalledTimes(1);
            expect(electron.app.getPath).toHaveBeenLastCalledWith('exe');
        });
        it('should be overwritten by absolute user data directory from options', () => {
            let testee = new Configuration(expected);
            expect(testee.applicationUserDataDirectory).toEqual(
                expected.applicationUserDataDirectory,
            );
        });
        it('should be overwritten by relative user data directory from options', () => {
            let testee = new Configuration({ applicationUserDataDirectory: '../data' });
            expect(testee.applicationUserDataDirectory).toEqual(path.resolve('/usr/data'));
        });
    });

    describe('options', function () {
        it.each([
            ['no options', undefined],
            ['null', null],
            ['an empty object', {}],
            [
                'empty values',
                {
                    applicationUpdateURL: '',
                    applicationStartupURL: '',
                    applicationCacheDirectory: '',
                    applicationUserDataDirectory: '',
                },
            ],
            [
                'values that are not set',
                { applicationUpdateURL: undefined, applicationStartupURL: null },
            ],
        ])('should use the defaults for %s', (_, options) => {
            let testee = new Configuration(options);
            expect(testee.applicationUpdateURL).toEqual(
                'https://github.com/akn19/rakkomik/releases/download/web-main/latest',
            );
            expect(testee.applicationStartupURL).toEqual('hakuneko://cache/index.html');
            expect(testee.applicationCacheDirectory).toEqual(path.resolve('/usr/bin/cache'));
            expect(testee.applicationUserDataDirectory).toEqual(path.resolve('/usr/bin/userdata'));
        });

        it('should not change the options it is given', () => {
            let options = { ...expected };
            new Configuration(options);
            expect(options).toEqual(expected);
        });

        it('should keep the directories next to the executable of a portable application', () => {
            electron.app.getPath.mockReturnValueOnce(
                path.join(path.resolve('/portable app'), 'RakKomik.exe'),
            );
            let testee = new Configuration(undefined);
            expect(testee.applicationCacheDirectory).toEqual(
                path.resolve('/portable app', 'cache'),
            );
            expect(testee.applicationUserDataDirectory).toEqual(
                path.resolve('/portable app', 'userdata'),
            );
            expect(testee.applicationUserPluginsDirectory).toEqual(
                path.resolve('/portable app', 'userdata', 'rakkomik.plugins'),
            );
        });

        it.each([
            ['a trailing separator', '/data/cache/'],
            ['dot segments', '/data/./x/../cache'],
            ['a doubled separator', '/data//cache'],
        ])('should tidy up %s of a directory', (_, directory) => {
            let testee = new Configuration({
                applicationCacheDirectory: directory,
                applicationUserDataDirectory: directory,
            });
            expect(testee.applicationCacheDirectory).toEqual(path.resolve('/data/cache'));
            expect(testee.applicationUserDataDirectory).toEqual(path.resolve('/data/cache'));
        });

        it('should resolve a relative directory against the application, not against the working directory', () => {
            let testee = new Configuration({ applicationCacheDirectory: 'web' });
            expect(testee.applicationCacheDirectory).toEqual(path.resolve('/usr/bin', 'web'));
            expect(testee.applicationCacheDirectory).not.toEqual(path.resolve('web'));
        });
    });

    describe('applicationProtocol of unusual startup URLs', function () {
        it.each([
            ['hakuneko://cache/index.html', 'hakuneko'],
            ['custom-scheme://app/', 'custom-scheme'],
            ['HAKUNEKO://cache/index.html', 'hakuneko'],
            ['http://localhost:8080/index.html?debug=1', 'http'],
            ['file:///opt/app/index.html', 'file'],
        ])('should be the scheme of %s', (url, protocol) => {
            expect(new Configuration({ applicationStartupURL: url }).applicationProtocol).toEqual(
                protocol,
            );
        });

        // NOTE: a startup URL without a scheme is accepted by the constructor and refused only when the protocol is asked for,
        // which is when the application starts. Characterisation of the current failure, not a promise.
        it.each(['index.html', './web/index.html', '/opt/app/index.html'])(
            'should throw when the startup URL has no scheme (%s)',
            (url) => {
                let testee = new Configuration({ applicationStartupURL: url });
                expect(testee.applicationStartupURL).toEqual(url);
                expect(() => testee.applicationProtocol).toThrow(TypeError);
            },
        );
    });

    describe('printInfo', function () {
        it('should print every setting with its name', () => {
            let log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
            let testee = new Configuration({
                ...expected,
                applicationStartupURL: 'custom://app/index.html',
            });
            testee.printInfo();
            let lines = log.mock.calls.map((args) => args.join(' '));
            let value = (label) =>
                lines
                    .find((line) => new RegExp(`^${label}\\s*: `).test(line))
                    .replace(new RegExp(`^${label}\\s*: `), '');
            expect(lines).toContain('Configuration');
            expect(value('Update URL')).toEqual(expected.applicationUpdateURL);
            expect(value('Connector Protocol')).toEqual('connector');
            expect(value('Application Protocol')).toEqual('custom');
            expect(value('Startup URL')).toEqual('custom://app/index.html');
            expect(value('AppCache Directory')).toEqual(expected.applicationCacheDirectory);
            expect(value('UserData Directory')).toEqual(expected.applicationUserDataDirectory);
        });
    });

    describe('applicationUserPluginsDirectory', function () {
        it('should have default after initialization', () => {
            let testee = new Configuration(undefined);
            expect(testee.applicationUserPluginsDirectory).toEqual(
                path.resolve('/usr/bin/userdata/rakkomik.plugins'),
            );
            expect(electron.app.getPath).toHaveBeenCalledTimes(1);
            expect(electron.app.getPath).toHaveBeenLastCalledWith('exe');
        });
        it('should be changed by absolute user data directory from options', () => {
            let testee = new Configuration(expected);
            expect(testee.applicationUserPluginsDirectory).toEqual(
                path.resolve(expected.applicationUserDataDirectory, 'rakkomik.plugins'),
            );
        });
        it('should be changed by relative user data directory from options', () => {
            let testee = new Configuration({ applicationUserDataDirectory: '../data' });
            expect(testee.applicationUserPluginsDirectory).toEqual(
                path.resolve('/usr/data/rakkomik.plugins'),
            );
        });
    });
});

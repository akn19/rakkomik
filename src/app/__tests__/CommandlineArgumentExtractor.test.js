const { mockModule } = require('./support/mockRequire');

mockModule('electron', () => {
    return {
        app: {
            getAppPath: vi.fn(() => '/usr/bin'),
            getPath: vi.fn(() => '/usr/bin/rakkomik'),
        },
    };
});
const CommandlineArgumentExtractor = require('../CommandlineArgumentExtractor.js');
const Configuration = require('../Configuration');

describe('CommandlineArgumentExtractor', function () {
    describe('_get', function () {
        it('contains flag', () => {
            let testee = new CommandlineArgumentExtractor(['-a', '-b', '-c']);
            expect(testee._get('-b', true)).toEqual(true);
        });

        it('does not contain flag', () => {
            let testee = new CommandlineArgumentExtractor(['-a', '-b', '-c']);
            expect(testee._get('-x', true)).toEqual(false);
        });

        it('contains flag when followed by value', () => {
            let testee = new CommandlineArgumentExtractor(['-a', '-b', '1']);
            expect(testee._get('-b', true)).toEqual(true);
        });

        it('followed by value', () => {
            let testee = new CommandlineArgumentExtractor(['-a', '-b', 'x']);
            expect(testee._get('-b')).toEqual('x');
        });

        it('followed by option instead of value', () => {
            let testee = new CommandlineArgumentExtractor(['-a', '-b', '-c']);
            expect(testee._get('-b')).toEqual(undefined);
        });

        it('no value because at end', () => {
            let testee = new CommandlineArgumentExtractor(['-a', '-b', '-c']);
            expect(testee._get('-c')).toEqual(undefined);
        });

        it('assigned value', () => {
            let testee = new CommandlineArgumentExtractor(['-a', '-b=x', '-c']);
            expect(testee._get('-b')).toEqual('x');
        });

        it('assigned nothing', () => {
            let testee = new CommandlineArgumentExtractor(['-a', '-b=', '-c']);
            expect(testee._get('-b')).toEqual(undefined);
        });
    });

    describe('options when containing argument', function () {
        it('--update-url', () => {
            let expected = 'https://example.test/rakkomik/releases/0.4.0/latest';
            let testee = new CommandlineArgumentExtractor([`--update-url=${expected}`]);
            expect(testee.options.applicationUpdateURL).toEqual(expected);
        });

        it('-u', () => {
            let expected = 'https://example.test/rakkomik/releases/0.4.0/latest';
            let testee = new CommandlineArgumentExtractor(['-u', expected]);
            expect(testee.options.applicationUpdateURL).toEqual(expected);
        });

        it('--startup-url', () => {
            let expected = 'cache://rakkomik/index.html';
            let testee = new CommandlineArgumentExtractor([`--startup-url=${expected}`]);
            expect(testee.options.applicationStartupURL).toEqual(expected);
        });

        it('--cache-directory', () => {
            let expected = './cache';
            let testee = new CommandlineArgumentExtractor([`--cache-directory=${expected}`]);
            expect(testee.options.applicationCacheDirectory).toEqual(expected);
        });

        it('-c', () => {
            let expected = './cache';
            let testee = new CommandlineArgumentExtractor(['-c', expected]);
            expect(testee.options.applicationCacheDirectory).toEqual(expected);
        });

        it('--user-directory', () => {
            let expected = './user';
            let testee = new CommandlineArgumentExtractor([`--user-directory=${expected}`]);
            expect(testee.options.applicationUserDataDirectory).toEqual(expected);
        });
    });

    describe('options when missing argument', function () {
        it('--update-url', () => {
            let testee = new CommandlineArgumentExtractor([]);
            expect(testee.options.applicationUpdateURL).toEqual(undefined);
        });

        it('-u', () => {
            let testee = new CommandlineArgumentExtractor([]);
            expect(testee.options.applicationUpdateURL).toEqual(undefined);
        });

        it('--startup-url', () => {
            let testee = new CommandlineArgumentExtractor([]);
            expect(testee.options.applicationStartupURL).toEqual(undefined);
        });

        it('--cache-directory', () => {
            let testee = new CommandlineArgumentExtractor([]);
            expect(testee.options.applicationCacheDirectory).toEqual(undefined);
        });

        it('-c', () => {
            let testee = new CommandlineArgumentExtractor([]);
            expect(testee.options.applicationCacheDirectory).toEqual(undefined);
        });

        it('--user-directory', () => {
            let testee = new CommandlineArgumentExtractor([]);
            expect(testee.options.applicationUserDataDirectory).toEqual(undefined);
        });
    });

    describe('options when the command line is not that simple', function () {
        // the options of the application, by the name they have in the configuration
        function optionsOf(...argv) {
            return new CommandlineArgumentExtractor(argv).options;
        }

        it('should take the first one when an option is given twice', () => {
            expect(
                optionsOf('--update-url=https://a.test/', '--update-url=https://b.test/')
                    .applicationUpdateURL,
            ).toEqual('https://a.test/');
            expect(optionsOf('-c', 'first', '-c', 'second').applicationCacheDirectory).toEqual(
                'first',
            );
        });

        it('should prefer the long name to the short one', () => {
            expect(
                optionsOf('-u=https://short.test/', '--update-url=https://long.test/')
                    .applicationUpdateURL,
            ).toEqual('https://long.test/');
            expect(
                optionsOf('-c', 'short', '--cache-directory', 'long').applicationCacheDirectory,
            ).toEqual('long');
        });

        it('should fall back to the short name when the long one has no value', () => {
            expect(
                optionsOf('--update-url=', '-u', 'https://short.test/').applicationUpdateURL,
            ).toEqual('https://short.test/');
            expect(optionsOf('--cache-directory', '-c=short').applicationCacheDirectory).toEqual(
                'short',
            );
        });

        it('should find the options among everything else the process was started with', () => {
            let options = optionsOf(
                process.execPath,
                'main.js',
                '--no-sandbox',
                '--user-data-dir=/chromium',
                '--startup-url',
                'hakuneko://cache/a.html',
                '--enable-logging',
            );
            expect(options).toEqual({
                applicationUpdateURL: undefined,
                applicationStartupURL: 'hakuneko://cache/a.html',
                applicationCacheDirectory: undefined,
                applicationUserDataDirectory: undefined,
            });
        });

        it.each([
            ['an option that only starts like it', ['--update-url-extra=https://x.test/']],
            ['a longer short option', ['-url', 'https://x.test/']],
            ['an option with the name in its value', ['--other=--update-url=https://x.test/']],
        ])('should not take %s for an option of the application', (_, argv) => {
            expect(optionsOf(...argv).applicationUpdateURL).toEqual(undefined);
        });

        it.each([
            ['a path with a space', ['-c', 'my cache dir'], 'my cache dir'],
            [
                'a Windows path',
                ['--user-directory=C:\\Users\\Zo\u00eb\\RakKomik'],
                'C:\\Users\\Zo\u00eb\\RakKomik',
            ],
            [
                'a path with characters of any writing system',
                ['--cache-directory', '/home/\u6f2b\u753b/\u00fcber'],
                '/home/\u6f2b\u753b/\u00fcber',
            ],
            ['a very long path', ['-c', '/' + 'a'.repeat(5000)], '/' + 'a'.repeat(5000)],
        ])('should hand over %s as it is', (_, argv, expected) => {
            let options = optionsOf(...argv);
            expect(
                options.applicationCacheDirectory || options.applicationUserDataDirectory,
            ).toEqual(expected);
        });

        it('should take a value that starts with a dash only after an equals sign, because it would be an option otherwise', () => {
            expect(optionsOf('-c', '-weird').applicationCacheDirectory).toEqual(undefined);
            expect(optionsOf('-c=-weird').applicationCacheDirectory).toEqual('-weird');
        });

        it('should keep the disabled update as a value like any other', () => {
            expect(optionsOf('--update-url=DISABLED').applicationUpdateURL).toEqual('DISABLED');
            expect(optionsOf('-u', 'DISABLED').applicationUpdateURL).toEqual('DISABLED');
        });

        it('should not change the arguments it was given', () => {
            let argv = ['-u', 'https://x.test/', '--startup-url=hakuneko://cache/a.html'];
            let before = [...argv];
            expect(new CommandlineArgumentExtractor(argv).options).toBeDefined();
            expect(argv).toEqual(before);
        });

        it('should keep the equals signs inside the value of --option=value', () => {
            let startup = 'http://localhost:8080/index.html?debug=1&mode=test';
            let update = 'https://example.org/latest?channel=beta';
            expect(optionsOf(`--startup-url=${startup}`).applicationStartupURL).toEqual(startup);
            expect(optionsOf(`--update-url=${update}`).applicationUpdateURL).toEqual(update);
        });
    });

    describe('printInfo', function () {
        function usage() {
            let log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
            new CommandlineArgumentExtractor([]).printInfo();
            let lines = log.mock.calls.map((args) => args.join(' '));
            log.mockRestore();
            return lines;
        }

        it('should print the usage with the executable and the options of the application', () => {
            let lines = usage().join('\n');
            expect(lines).toContain('Usage:');
            expect(lines).toContain(process.execPath);
            expect(lines).toContain('Options:');
            for (let flag of [
                '-u',
                '--update-url=<URL>',
                '--startup-url=<URL>',
                '-c',
                '--cache-directory=<DIR>',
                '--user-directory=<DIR>',
            ]) {
                expect(lines).toContain(flag);
            }
        });

        it('should print the defaults the configuration really has', () => {
            let lines = usage().join('\n');
            let configuration = new Configuration(undefined);
            expect(lines).toContain(`Default: "${configuration.applicationUpdateURL}"`);
            expect(lines).toContain(`Default: "${configuration.applicationStartupURL}"`);
        });

        it('should only name options that the command line understands, and every one of them', () => {
            let flags = [
                ...usage()
                    .join('\n')
                    .matchAll(/(--?[a-z][\w-]*)(?:=<|,)/g),
            ].map((match) => match[1]);
            expect(flags.sort()).toEqual([
                '--cache-directory',
                '--startup-url',
                '--update-url',
                '--user-directory',
                '-c',
                '-u',
            ]);
            for (let flag of flags) {
                let options = new CommandlineArgumentExtractor([`${flag}=value`]).options;
                expect(Object.values(options).filter((value) => value === 'value')).toHaveLength(1);
            }
        });
    });
});

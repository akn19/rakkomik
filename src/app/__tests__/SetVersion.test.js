// scripts/set-version.js writes the version of a release (its tag) into package.json and src/app/package.json, which is
// where the installers and the shell in app.asar take the version from. The script runs here with the `scripts` folder
// of a temporary project as its `__dirname`, and the project holds copies of the two real files for most of the tests,
// so that a change of those files that the script cannot handle shows up here and not in a release.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createConsole, loadToolScript } = require('./support/toolScripts');

const REPOSITORY = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPOSITORY, 'scripts', 'set-version.js');
const FILES = [ 'package.json', path.join('src', 'app', 'package.json') ];

let project = null;

beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'rakkomik-version-'));
});

afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
});

const read = file => fs.readFileSync(path.join(project, file), 'utf8');

function write(file, text) {
    fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
    fs.writeFileSync(path.join(project, file), text);
}

// the two files of the repository, as the project of a test
function copyTheRealFiles() {
    for(const file of FILES) {
        write(file, fs.readFileSync(path.join(REPOSITORY, file), 'utf8'));
    }
}

/** The script as if it were in `scripts/` of the project; `argv` and the answers of `exit` are what it is started with. */
function load({ argv = [ 'node', 'set-version.js' ], entry = false } = {}) {
    const exits = [];
    const output = createConsole();
    const { module } = loadToolScript(SCRIPT, {
        dirname: path.join(project, 'scripts'),
        globals: { process: { argv, exit: code => exits.push(code) }, console: output },
        entry
    });
    return { ...module.exports, exits, output };
}

describe('setting the version of a release', () => {
    it.each([
        [ 'the tag', 'v1.2.3' ],
        [ 'the number alone', '1.2.3' ]
    ])('should take %s (%s) and set the number in both files', (name, given) => {
        copyTheRealFiles();
        expect(load().setVersion(given)).toBe('1.2.3');
        for(const file of FILES) {
            expect(JSON.parse(read(file)).version, file).toBe('1.2.3');
        }
    });

    it('should take numbers of more than one digit', () => {
        copyTheRealFiles();
        expect(load().setVersion('v10.20.300')).toBe('10.20.300');
        expect(JSON.parse(read('package.json')).version).toBe('10.20.300');
    });

    it('should change nothing in the files but the number, as they are in the repository', () => {
        copyTheRealFiles();
        const before = FILES.map(read);
        load().setVersion('v7.8.9');
        FILES.forEach((file, index) => {
            const lines = before[index].split('\n');
            const changed = read(file).split('\n');
            expect(changed, file).toHaveLength(lines.length);
            const differing = lines.map((line, number) => [ line, changed[number] ]).filter(([ was, now ]) => was !== now);
            expect(differing, file).toHaveLength(1);
            expect(differing[0][1], file).toMatch(/^ {2}"version": "7\.8\.9",?\r?$/);
            expect(JSON.parse(read(file)), file).toEqual({ ...JSON.parse(before[index]), version: '7.8.9' });
        });
    });

    it('should leave the version as it is when it is set to the one it has', () => {
        copyTheRealFiles();
        const before = FILES.map(read);
        const { version } = JSON.parse(before[0]);
        load().setVersion(version);
        expect(FILES.map(read)).toEqual(before);
    });

    it.each([
        [ 'LF', '\n' ],
        [ 'CRLF', '\r\n' ]
    ])('should keep the line breaks of a file that has %s', (name, eol) => {
        for(const file of FILES) {
            write(file, [ '{', '  "name": "x",', '  "version": "1.0.0",', '  "main": "main.js"', '}', '' ].join(eol));
        }
        load().setVersion('v2.0.0');
        for(const file of FILES) {
            expect(read(file), file).toBe([ '{', '  "name": "x",', '  "version": "2.0.0",', '  "main": "main.js"', '}', '' ].join(eol));
        }
    });

    it('should set the version of the file, and not one that is nested in it', () => {
        for(const file of FILES) {
            write(file, '{\n  "config": {\n    "version": "0.0.1"\n  },\n  "name": "x",\n  "version": "1.0.0"\n}\n');
        }
        load().setVersion('3.0.0');
        for(const file of FILES) {
            expect(JSON.parse(read(file)), file).toEqual({ config: { version: '0.0.1' }, name: 'x', version: '3.0.0' });
        }
    });

});

describe('bringing the files up to a release only', () => {
    // both files, with the version that the root one has now (the other one is told by the first)
    function versioned(version) {
        for(const file of FILES) {
            write(file, `{\n  "name": "x",\n  "version": "${version}"\n}\n`);
        }
    }
    const versions = () => FILES.map(file => JSON.parse(read(file)).version);

    it.each([
        [ '1.0.0', 'v1.0.1' ],
        [ '1.0.0', 'v1.1.0' ],
        [ '1.0.0', 'v2.0.0' ],
        [ '1.9.0', 'v1.10.0' ],
        [ '1.99.99', 'v2.0.0' ],
        [ '9.0.0', 'v10.0.0' ]
    ])('should set a version that is newer than %s: %s', (current, tag) => {
        versioned(current);
        expect(load().setVersion(tag, { ifNewer: true })).toBe(tag.slice(1));
        expect(versions()).toEqual([ tag.slice(1), tag.slice(1) ]);
    });

    it.each([
        [ '1.0.0', 'v1.0.0', 'the same one' ],
        [ '1.0.1', 'v1.0.0', 'a patch older' ],
        [ '1.1.0', 'v1.0.9', 'a minor older' ],
        [ '2.0.0', 'v1.99.99', 'a major older' ],
        [ '1.10.0', 'v1.9.0', 'older, though it is the later text' ],
        [ '10.0.0', 'v9.0.0', 'older, though it is the later text' ]
    ])('should leave the files as they are when they have %s and the tag is %s (%s)', (current, tag) => {
        versioned(current);
        expect(load().setVersion(tag, { ifNewer: true })).toBeNull();
        expect(versions()).toEqual([ current, current ]);
    });

    it('should set the version of a tag that is older when it is not asked to leave the files alone', () => {
        versioned('2.0.0');
        expect(load().setVersion('v1.0.0')).toBe('1.0.0');
        expect(versions()).toEqual([ '1.0.0', '1.0.0' ]);
    });

    it.each([ '0.0.0-dev', 'dev', '' ])('should set the version when the one of the files (%j) is no number of a release', current => {
        versioned(current);
        expect(load().setVersion('v1.0.0', { ifNewer: true })).toBe('1.0.0');
        expect(versions()).toEqual([ '1.0.0', '1.0.0' ]);
    });

    it('should go by the version of package.json, which the other file follows', () => {
        write('package.json', '{\n  "version": "3.0.0"\n}\n');
        write(path.join('src', 'app', 'package.json'), '{\n  "version": "1.0.0"\n}\n');
        expect(load().setVersion('v2.0.0', { ifNewer: true })).toBeNull();
        expect(versions()).toEqual([ '3.0.0', '1.0.0' ]);
    });

    it('should still refuse what is not the tag of a release', () => {
        versioned('1.0.0');
        expect(() => load().setVersion('main', { ifNewer: true })).toThrow('"main" is not the tag of a release, which is of the form vX.Y.Z!');
    });
});

describe('what is not the tag of a release', () => {
    it.each([
        [ 'a number of two parts', 'v1.2' ],
        [ 'a number of four parts', 'v1.2.3.4' ],
        [ 'a suffix (the AUR takes the number as the pkgver)', 'v1.2.3-rc1' ],
        [ 'a ref instead of the tag', 'refs/tags/v1.2.3' ],
        [ 'a branch', 'main' ],
        [ 'a name that is not a number', 'vX.Y.Z' ],
        [ 'a tag of the web part', 'web-main' ],
        [ 'a space around the tag', ' v1.2.3' ],
        [ 'a second tag', 'v1.2.3\nv1.2.4' ],
        [ 'nothing', '' ]
    ])('should be refused, and change nothing: %s', (name, given) => {
        copyTheRealFiles();
        const before = FILES.map(read);
        expect(() => load().setVersion(given)).toThrow(`"${given}" is not the tag of a release, which is of the form vX.Y.Z!`);
        expect(FILES.map(read)).toEqual(before);
    });
});

describe('files that cannot be changed', () => {
    it('should leave both files as they were when the second has no version', () => {
        write('package.json', '{\n  "version": "1.0.0"\n}\n');
        write(path.join('src', 'app', 'package.json'), '{\n  "name": "app"\n}\n');
        expect(() => load().setVersion('v2.0.0')).toThrow('"' + path.join('src', 'app', 'package.json') + '" has no "version" to set!');
        expect(read('package.json')).toBe('{\n  "version": "1.0.0"\n}\n');
    });

    it('should not take a version that is written in another way than the project writes it', () => {
        write('package.json', '{\n    "version": "1.0.0"\n}\n');
        write(path.join('src', 'app', 'package.json'), '{\n  "version": "1.0.0"\n}\n');
        expect(() => load().setVersion('v2.0.0')).toThrow('"package.json" has no "version" to set!');
        expect(read(path.join('src', 'app', 'package.json'))).toBe('{\n  "version": "1.0.0"\n}\n');
    });

    it('should leave both files as they were when the second is not JSON', () => {
        write('package.json', '{\n  "version": "1.0.0"\n}\n');
        write(path.join('src', 'app', 'package.json'), '{\n  "version": "1.0.0",\n');
        expect(() => load().setVersion('v2.0.0')).toThrow(SyntaxError);
        expect(read('package.json')).toBe('{\n  "version": "1.0.0"\n}\n');
    });

    it('should say that a file is missing, and not write the other', () => {
        write('package.json', '{\n  "version": "1.0.0"\n}\n');
        expect(() => load().setVersion('v2.0.0')).toThrow(/ENOENT/);
        expect(read('package.json')).toBe('{\n  "version": "1.0.0"\n}\n');
    });
});

describe('the command', () => {
    it('should set the version of the tag that it is given, and say so', () => {
        copyTheRealFiles();
        const { main, output } = load();
        main([ 'v4.5.6' ]);
        expect(JSON.parse(read('package.json')).version).toBe('4.5.6');
        expect(JSON.parse(read(path.join('src', 'app', 'package.json'))).version).toBe('4.5.6');
        expect(output.lines('log')).toEqual([ `Set the version to 4.5.6 in ${FILES.join(' and ')}.` ]);
    });

    it.each([
        [ 'no tag', [] ],
        [ 'a flag and no tag', [ '--if-newer' ] ],
        [ 'two tags', [ 'v1.2.3', 'v1.2.4' ] ]
    ])('should say how it is used when it is given %s', (name, args) => {
        copyTheRealFiles();
        const before = FILES.map(read);
        expect(() => load().main(args)).toThrow('Usage: node scripts/set-version.js [--if-newer] <tag>, e.g. v1.2.3');
        expect(FILES.map(read)).toEqual(before);
    });

    it.each([
        [ 'before', [ '--if-newer', 'v9.0.0' ] ],
        [ 'after', [ 'v9.0.0', '--if-newer' ] ]
    ])('should set a version that is newer, with the flag %s the tag', (name, args) => {
        copyTheRealFiles();
        const { main, output } = load();
        main(args);
        expect(JSON.parse(read('package.json')).version).toBe('9.0.0');
        expect(output.lines('log')).toEqual([ `Set the version to 9.0.0 in ${FILES.join(' and ')}.` ]);
    });

    it('should say that it leaves the files as they are when the tag is not newer, and not fail', () => {
        write('package.json', '{\n  "version": "2.0.0"\n}\n');
        write(path.join('src', 'app', 'package.json'), '{\n  "version": "2.0.0"\n}\n');
        const { exits, output } = load({ argv: [ 'node', 'set-version.js', '--if-newer', 'v1.0.0' ], entry: true });
        expect(JSON.parse(read('package.json')).version).toBe('2.0.0');
        expect(output.lines('log')).toEqual([ 'The version stays as it is: v1.0.0 is not newer than the version of package.json.' ]);
        expect(output.lines('error')).toEqual([]);
        expect(exits).toEqual([]);
    });

    it('should run when it is started, with the tag of the command line, and leave without an error', () => {
        copyTheRealFiles();
        const { exits, output } = load({ argv: [ 'node', 'set-version.js', 'v5.6.7' ], entry: true });
        expect(JSON.parse(read('package.json')).version).toBe('5.6.7');
        expect(output.lines('error')).toEqual([]);
        expect(exits).toEqual([]);
    });

    it('should print what is wrong, and leave with an error, when it is started with something else than a tag', () => {
        copyTheRealFiles();
        const before = FILES.map(read);
        const { exits, output } = load({ argv: [ 'node', 'set-version.js', 'main' ], entry: true });
        expect(output.lines('error')).toEqual([ '"main" is not the tag of a release, which is of the form vX.Y.Z!' ]);
        expect(exits).toEqual([ 1 ]);
        expect(FILES.map(read)).toEqual(before);
    });

    it('should not do anything when it is only loaded', () => {
        copyTheRealFiles();
        const before = FILES.map(read);
        const { exits, output } = load({ argv: [ 'node', 'set-version.js', 'v5.6.7' ] });
        expect(FILES.map(read)).toEqual(before);
        expect(exits).toEqual([]);
        expect(output.entries).toEqual([]);
    });
});

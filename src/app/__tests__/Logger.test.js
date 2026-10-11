// The loggers keep the numeric levels of the retired private logger package and hand everything else to pino:
// the level decides what is written, the methods keep their meaning (`verbose` is `debug`, `critical` is `fatal`).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pino = require('pino');
const { ConsoleLogger, FileLogger } = require('../Logger');

const LEVEL = FileLogger.LEVEL;

// what pino writes as `level` for its own level names
const PINO = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

describe('Logger', () => {
    let directory = null;
    let opened = null;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-logger-'));
        opened = new Map();
    });

    afterEach(async () => {
        for (const logger of opened.keys()) {
            await close(logger);
        }
        fs.rmSync(directory, { recursive: true, force: true });
    });

    function fileLogger(level, name = 'test.log') {
        const file = path.join(directory, name);
        const logger = new FileLogger(file, level);
        opened.set(logger, file);
        return logger;
    }

    // pino writes asynchronously: ending the stream writes what is pending and closes the file (which Windows needs
    // before the directory can be removed)
    async function close(logger) {
        const stream = logger._logger[pino.symbols.streamSym];
        if (stream.destroyed) {
            return;
        }
        await new Promise(resolve => {
            stream.once('close', resolve);
            stream.end();
        });
    }

    // wait until the file holds the expected number of lines
    async function lines(logger, count) {
        let result = [];
        await vi.waitFor(() => {
            const content = fs.readFileSync(opened.get(logger), 'utf8');
            result = content.split('\n').filter(line => line !== '').map(line => JSON.parse(line));
            expect(result).toHaveLength(count);
        }, { interval: 5, timeout: 4000 });
        return result;
    }

    describe('LEVEL', () => {
        it('should be reachable on every logger and ordered from the finest to the coarsest', () => {
            expect(ConsoleLogger.LEVEL).toBe(FileLogger.LEVEL);
            const ordered = ['All', 'Trace', 'Debug', 'Verbose', 'Info', 'Warn', 'Error', 'Critical', 'None'].map(name => LEVEL[name]);
            expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
            expect(new Set(ordered).size).toBe(ordered.length);
        });

        it('should never be 0, which cannot be told from a missing level', () => {
            expect(Object.values(LEVEL)).not.toContain(0);
        });
    });

    describe('ConsoleLogger', () => {
        it.each([
            ['All', 'trace'],
            ['Trace', 'trace'],
            ['Debug', 'debug'],
            ['Verbose', 'debug'],
            ['Info', 'info'],
            ['Warn', 'warn'],
            ['Error', 'error'],
            ['Critical', 'fatal'],
            ['None', 'silent']
        ])('should map the level %s onto the pino level %s', (name, expected) => {
            expect(new ConsoleLogger(LEVEL[name])._logger.level).toBe(expected);
        });

        it.each([
            ['between two levels', 4.5, 'warn'],
            ['finer than the finest', -5, 'trace'],
            ['coarser than critical', 7.5, 'silent']
        ])('should map a number %s onto the level that covers it', (_, level, expected) => {
            expect(new ConsoleLogger(level)._logger.level).toBe(expected);
        });

        it.each([
            ['no level', undefined],
            ['the level 0', 0],
            ['null', null]
        ])('should log from Info on when it is given %s', (_, level) => {
            expect(new ConsoleLogger(level)._logger.level).toBe('info');
        });

        it('should forward every method to its pino method with all arguments', () => {
            const logger = new ConsoleLogger(LEVEL.None);
            const inner = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
            logger._logger = inner;
            const error = new Error('cause');
            logger.trace('t', 1);
            logger.debug('d', 2);
            logger.verbose('v', 3);
            logger.info('i', 4);
            logger.warn('w', 5);
            logger.error('e', error);
            logger.critical('c', 7);
            expect(inner.trace.mock.calls).toEqual([['t', 1]]);
            // pino has no verbose level: it shares debug
            expect(inner.debug.mock.calls).toEqual([['d', 2], ['v', 3]]);
            expect(inner.info.mock.calls).toEqual([['i', 4]]);
            expect(inner.warn.mock.calls).toEqual([['w', 5]]);
            expect(inner.error.mock.calls).toEqual([['e', error]]);
            expect(inner.fatal.mock.calls).toEqual([['c', 7]]);
        });
    });

    describe('FileLogger', () => {
        it('should write one JSON line per message with the pino level of the method', async () => {
            const logger = fileLogger(LEVEL.All);
            logger.trace('a');
            logger.debug('b');
            logger.verbose('c');
            logger.info('d');
            logger.warn('e');
            logger.error('f');
            logger.critical('g');
            const written = await lines(logger, 7);
            expect(written.map(line => line.msg)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
            expect(written.map(line => line.level)).toEqual([PINO.trace, PINO.debug, PINO.debug, PINO.info, PINO.warn, PINO.error, PINO.fatal]);
        });

        it.each([
            ['Debug', ['b', 'c', 'd', 'e', 'f', 'g']],
            ['Info', ['d', 'e', 'f', 'g']],
            ['Warn', ['e', 'f', 'g']],
            ['Error', ['f', 'g']],
            ['Critical', ['g']]
        ])('should leave out the messages below the level %s', async (name, expected) => {
            const logger = fileLogger(LEVEL[name]);
            logger.trace('a');
            logger.debug('b');
            logger.verbose('c');
            logger.info('d');
            logger.warn('e');
            logger.error('f');
            logger.critical('g');
            const written = await lines(logger, expected.length);
            expect(written.map(line => line.msg)).toEqual(expected);
        });

        it('should write nothing at all when the level is None', async () => {
            const logger = fileLogger(LEVEL.None);
            logger.critical('lost');
            logger.error('lost');
            await close(logger);
            expect(fs.readFileSync(opened.get(logger), 'utf8')).toBe('');
        });

        it('should log from Info on when no level is given', async () => {
            const logger = fileLogger(undefined);
            logger.debug('below');
            logger.info('on');
            expect((await lines(logger, 1))[0].msg).toBe('on');
        });

        it('should log an error object under its own key with its message', async () => {
            const logger = fileLogger(LEVEL.All);
            logger.warn(new Error('lonely'));
            const [line] = await lines(logger, 1);
            expect(line.msg).toBe('lonely');
            expect(line.err.message).toBe('lonely');
            expect(line.err.stack).toContain('Error: lonely');
        });

        it('should fill in the placeholders of the message', async () => {
            const logger = fileLogger(LEVEL.All);
            logger.info('%s of %d', 'one', 3);
            expect((await lines(logger, 1))[0].msg).toBe('one of 3');
        });

        it('should keep logging after the file has been cleared', async () => {
            const logger = fileLogger(LEVEL.All);
            logger.info('before');
            await lines(logger, 1);
            logger.clear();
            expect(fs.readFileSync(opened.get(logger), 'utf8')).toBe('');
            logger.info('after');
            expect((await lines(logger, 1))[0].msg).toBe('after');
        });

        it('should empty a file that holds the lines of an earlier run', () => {
            const file = path.join(directory, 'again.log');
            fs.writeFileSync(file, 'leftover of an earlier run\n');
            fileLogger(LEVEL.All, 'again.log').clear();
            expect(fs.readFileSync(file, 'utf8')).toBe('');
        });

        it('should keep the arguments that follow the message', async () => {
            const logger = fileLogger(LEVEL.All);
            logger.info('Remote Version:', 'ABC123');
            logger.verbose('Extracting:', path.join('web', 'index.html'));
            const [info, verbose] = await lines(logger, 2);
            expect(info.msg).toBe('Remote Version: ABC123');
            expect(verbose.msg).toBe(`Extracting: ${path.join('web', 'index.html')}`);
        });

        it('should keep the error that follows the message', async () => {
            const logger = fileLogger(LEVEL.All);
            logger.error('Update Failed!', new Error('Status: 404'));
            const [line] = await lines(logger, 1);
            expect(line.msg).toBe('Update Failed!');
            expect(line.err.message).toBe('Status: 404');
            expect(line.err.stack).toContain('Error: Status: 404');
        });

        it('should keep the error apart from the other values that follow the message', async () => {
            const logger = fileLogger(LEVEL.All);
            logger.warn('Cannot read', 'a.txt', 3, { code: 'EACCES' }, new Error('denied'));
            const [line] = await lines(logger, 1);
            expect(line.msg).toBe('Cannot read a.txt 3 { code: \'EACCES\' }');
            expect(line.err.message).toBe('denied');
        });

        it('should not take a percent sign that is no placeholder for one', async () => {
            const logger = fileLogger(LEVEL.All);
            logger.info('100% done:', 5);
            expect((await lines(logger, 1))[0].msg).toBe('100% done: 5');
        });
    });
});

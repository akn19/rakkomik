const fs = require('node:fs');
const util = require('node:util');
const pino = require('pino');

// Numeric levels compatible with the retired private logger package API.
const LEVEL = {
    // NOTE: never use 0, because it cannot be used for default assignment (0 => false)
    All: -Infinity,
    Trace: 1,
    Debug: 2,
    Verbose: 3,
    Info: 4,
    Warn: 5,
    Error: 6,
    Critical: 7,
    None: Infinity
};

function toPinoLevel(level) {
    if (level <= LEVEL.Trace) {
        return 'trace';
    }
    if (level <= LEVEL.Debug) {
        return 'debug';
    }
    if (level <= LEVEL.Verbose) {
        return 'debug'; // pino has no verbose level
    }
    if (level <= LEVEL.Info) {
        return 'info';
    }
    if (level <= LEVEL.Warn) {
        return 'warn';
    }
    if (level <= LEVEL.Error) {
        return 'error';
    }
    if (level <= LEVEL.Critical) {
        return 'fatal';
    }
    return 'silent';
}

// pino only uses the arguments after the message to fill the placeholders of the message and drops the others, but
// the application logs `info('Remote Version:', version)` and `error('Update Failed!', error)` like the retired logger,
// which printed all arguments: an Error becomes the error of the entry, the other values follow the message
const hooks = {
    logMethod(args, method) {
        const [message, ...values] = args;
        if (typeof message !== 'string' || values.length === 0 || /%[sdifjoO%]/.test(message)) {
            return method.apply(this, args);
        }
        const error = values.find(value => value instanceof Error);
        const text = util.format(message, ...values.filter(value => value !== error));
        return error ? method.call(this, { err: error }, text) : method.call(this, text);
    }
};

class BaseLogger {

    static get LEVEL() {
        return LEVEL;
    }

    constructor(logger) {
        this._logger = logger;
    }

    trace(...args) {
        this._logger.trace(...args);
    }

    debug(...args) {
        this._logger.debug(...args);
    }

    verbose(...args) {
        this._logger.debug(...args);
    }

    info(...args) {
        this._logger.info(...args);
    }

    warn(...args) {
        this._logger.warn(...args);
    }

    error(...args) {
        this._logger.error(...args);
    }

    critical(...args) {
        this._logger.fatal(...args);
    }
}

class ConsoleLogger extends BaseLogger {

    constructor(level) {
        super(pino({ level: toPinoLevel(level || LEVEL.Info), hooks }));
    }
}

class FileLogger extends BaseLogger {

    constructor(file, level) {
        super(pino({ level: toPinoLevel(level || LEVEL.Info), hooks }, pino.destination(file)));
        this._file = file;
    }

    clear() {
        fs.writeFileSync(this._file, '');
    }
}

module.exports = {
    ConsoleLogger: ConsoleLogger,
    FileLogger: FileLogger
};

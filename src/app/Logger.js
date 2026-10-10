const fs = require('node:fs');
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
        super(pino({ level: toPinoLevel(level || LEVEL.Info) }));
    }
}

class FileLogger extends BaseLogger {

    constructor(file, level) {
        super(pino({ level: toPinoLevel(level || LEVEL.Info) }, pino.destination(file)));
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

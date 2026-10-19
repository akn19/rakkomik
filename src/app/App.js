const { ConsoleLogger } = require('./Logger');
const Configuration = require('./Configuration');
const ConfigurationLinux = require('./ConfigurationLinux');
const ConfigurationDarwin = require('./ConfigurationDarwin');
const ConfigurationWindows = require('./ConfigurationWindows');
const CommandlineArgumentExtractor = require('./CommandlineArgumentExtractor');
const UpdateServerManager = require('./UpdateServerManager');
const CacheDirectoryManager = require('./CacheDirectoryManager');
const Updater = require('./Updater');
const ElectronBootstrap = require('./ElectronBootstrap');
const IpcBridge = require('./IpcBridge');
const FetchWindowManager = require('./FetchWindowManager');
const FsBridge = require('./FsBridge');
const DiscordBridge = require('./DiscordBridge');
const SqliteBridge = require('./SqliteBridge');
const PdfBridge = require('./PdfBridge');

// The page of the window while the update is checked: a document with a language and a title, text that a screen
// reader announces and that has the contrast WCAG asks for on the background of the window.
const loadingPage = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>RakKomik</title></head>
<body style="margin: 0; background-color: #f8f8f8; color: #404040;">
<div role="status" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -100%); font-family: monospace; font-size: 1.25em; font-weight: bold; text-align: center;">
    <div style="margin-bottom: 1.5em;">Checking for Update</div>
    <progress aria-label="Checking for update"></progress>
</div>
</body>
</html>
`;

module.exports = class App {
    constructor(logger) {
        this._logger = logger || new ConsoleLogger(ConsoleLogger.LEVEL.Warn);
        this._extractor = new CommandlineArgumentExtractor(process.argv);
        this._configuration = this._getConfiguration(this._extractor.options);
        let serverManager = new UpdateServerManager(
            this._configuration.applicationUpdateURL,
            this._logger,
        );
        let cacheManager = new CacheDirectoryManager(
            this._configuration.applicationCacheDirectory,
            this._logger,
        );
        this._cacheManager = cacheManager;
        this._updater = new Updater(serverManager, cacheManager, this._logger);
        this._electron = new ElectronBootstrap(this._configuration, this._logger);
        new IpcBridge(this._logger).register();
        new FetchWindowManager(this._logger).register();
        new FsBridge(this._logger).register();
        new DiscordBridge(this._logger).register();
        new SqliteBridge(this._logger).register();
        new PdfBridge(this._logger).register();
    }

    _getConfiguration(options) {
        if (Configuration.isPortableMode) {
            return new Configuration(options);
        }
        if (process.platform === 'linux') {
            return new ConfigurationLinux(options);
        }
        if (process.platform === 'darwin') {
            return new ConfigurationDarwin(options);
        }
        if (process.platform === 'win32') {
            return new ConfigurationWindows(options);
        }
    }

    /**
     * A packaged application carries its web part in the folder `web` next to `app.asar`. It is copied into the cache
     * directory when the cache has none yet, so that the first start needs no network and does not wait for an update. After
     * that the cache is what the updates replace, as it ever was.
     */
    async _seedCache() {
        try {
            if (await this._cacheManager.seedFrom(Configuration.bundledWebDirectory)) {
                this._logger.info(
                    'The web part of the application was copied to the cache directory',
                );
            }
        } catch (error) {
            this._logger.error('The web part of the application could not be copied!', error);
        }
    }

    printInfo() {
        let separator = '--------------';
        console.log('');
        console.log(separator);
        console.log('Framework Info');
        console.log(separator);
        console.log('Electron :', process.versions.electron);
        console.log('Chrome   :', process.versions.chrome);
        console.log('Node     :', process.versions.node);
        console.log('');
    }

    async run() {
        try {
            this._extractor.printInfo();
            this.printInfo();
            this._configuration.printInfo();
            // add the portable mode as environment variable to be easily available in render process
            if (Configuration.isPortableMode) {
                process.env.RAKKOMIK_PORTABLE = 'TRUE';
            } else {
                delete process.env.RAKKOMIK_PORTABLE;
            }
            await this._electron.launch();
            await this._electron.loadHTML(loadingPage);
            await this._seedCache();
            await this._updater.updateCache(this._configuration.publicKey);
            this._electron.loadURL(this._configuration.applicationStartupURL);
        } catch (error) {
            this._logger.error('Failed to start application!', error);
        }
    }
};

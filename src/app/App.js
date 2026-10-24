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
const UpdateBridge = require('./UpdateBridge');

const { version: applicationVersion } = require('./package.json');

// how long the reason of a failed update stays on the screen before the application starts with what it has
const FAILURE_NOTICE = 2500;

/**
 * The page of the window while the update is checked. It shows every step that it is given with `showStatus` (see
 * Updater.updateCache): what happens, the update it is about (a web part is named after the time of its build, in base
 * 36), how much of a download arrived, why an update failed. A document with a language and a title, text that a screen
 * reader announces, the contrast that WCAG asks for in the light and the dark theme of the system, no motion for those
 * who asked for less.
 * @param {string} version the version of the application
 * @returns {string}
 */
function startupPage(version) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>RakKomik</title>
<style>
    :root { color-scheme: light dark; --background: #eef1f5; --card: #ffffff; --text: #1d2430; --muted: #4f5a68; --accent: #155aa8; --track: #dde1e7; --error: #b03030; }
    @media (prefers-color-scheme: dark) {
        :root { --background: #15171b; --card: #212429; --text: #e8eaed; --muted: #a9b0ba; --accent: #7aa7e8; --track: #363a42; --error: #f28b82; }
    }
    html, body { height: 100%; margin: 0; }
    body { display: grid; place-items: center; background: var(--background); color: var(--text); font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
    main { box-sizing: border-box; width: min(26rem, calc(100% - 2rem)); padding: 1.75rem 2rem 2rem; border-radius: 12px; background: var(--card); box-shadow: 0 10px 30px rgb(0 0 0 / 0.14); }
    h1 { margin: 0; font-size: 1.5rem; line-height: 1.2; letter-spacing: -0.01em; }
    .version { margin: 0.25rem 0 1.5rem; color: var(--muted); font-size: 0.8125rem; }
    .status { margin: 0; font-weight: 600; }
    .detail { min-height: 1.5em; margin: 0.25rem 0 1rem; color: var(--muted); font-size: 0.8125rem; overflow-wrap: anywhere; }
    .failed .detail { color: var(--error); }
    .bar { position: relative; height: 6px; overflow: hidden; border-radius: 3px; background: var(--track); }
    .fill { position: absolute; top: 0; bottom: 0; left: 0; width: 0; border-radius: 3px; background: var(--accent); transition: width 0.2s ease-out; }
    .busy .fill { width: 35%; animation: busy 1.4s ease-in-out infinite; }
    .done .fill { width: 100%; }
    .failed .fill { width: 100%; background: var(--error); }
    @keyframes busy { from { left: -35%; } to { left: 100%; } }
    @media (prefers-reduced-motion: reduce) {
        .busy .fill { animation: none; width: 100%; opacity: 0.45; }
        .fill { transition: none; }
    }
</style>
</head>
<body>
<main id="startup" class="busy">
    <h1>RakKomik</h1>
    <p class="version">Version ${version}</p>
    <div role="status">
        <p class="status" id="status">Starting</p>
        <p class="detail" id="detail"></p>
    </div>
    <div class="bar" id="bar" role="progressbar" aria-label="Progress"><div class="fill" id="fill"></div></div>
</main>
<script>
    const megabytes = (bytes) => (bytes / 1048576).toFixed(1) + ' MB';
    function update(version) {
        const time = /^[0-9A-Z]+$/i.test(version || '') ? parseInt(version, 36) : NaN;
        if (time > Date.UTC(2015, 0) && time < Date.UTC(2100, 0)) {
            return 'update of ' + new Date(time).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
        }
        return version ? 'update ' + version : 'the update';
    }
    function capital(text) {
        return text.charAt(0).toUpperCase() + text.slice(1);
    }
    const STEPS = {
        disabled: () => ['Starting', 'Updates are switched off'],
        checking: () => ['Checking for updates', 'Asking the update server for the newest connectors and interface'],
        current: (step) => ['Up to date', 'Installed: ' + update(step.version)],
        downloading: (step) => [
            'Downloading the ' + update(step.version),
            step.total
                ? megabytes(step.received) + ' of ' + megabytes(step.total) + ' (' + Math.floor((100 * step.received) / step.total) + '%)'
                : step.received ? megabytes(step.received) : 'Connecting',
        ],
        verifying: (step) => ['Verifying the download', 'Checking the signature of the ' + update(step.version)],
        installing: (step) => ['Installing the update', capital(update(step.version))],
        updated: (step) => ['Updated', 'Installed: ' + update(step.version)],
        failed: (step) => ['The update failed', (step.message || 'Unknown error') + '. RakKomik starts with the installed version.'],
        starting: () => ['Starting RakKomik', ''],
    };
    window.showStatus = (step) => {
        const [status, detail] = (STEPS[step.stage] || STEPS.starting)(step);
        document.getElementById('status').textContent = status;
        document.getElementById('detail').textContent = detail;
        const bar = document.getElementById('bar');
        const fill = document.getElementById('fill');
        const known = step.stage === 'downloading' && step.total > 0;
        const done = step.stage === 'current' || step.stage === 'updated';
        const failed = step.stage === 'failed';
        document.getElementById('startup').className = failed ? 'failed' : done ? 'done' : known ? '' : 'busy';
        fill.style.width = known ? Math.min(100, (100 * step.received) / step.total) + '%' : '';
        if (known || done) {
            bar.setAttribute('aria-valuenow', known ? Math.floor((100 * step.received) / step.total) : 100);
        } else {
            bar.removeAttribute('aria-valuenow');
        }
    };
</script>
</body>
</html>
`;
}

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
        this._failureNotice = FAILURE_NOTICE;
        this._electron = new ElectronBootstrap(this._configuration, this._logger);
        new IpcBridge(this._logger).register();
        new FetchWindowManager(this._logger).register();
        new FsBridge(this._logger).register();
        new DiscordBridge(this._logger).register();
        new SqliteBridge(this._logger).register();
        new PdfBridge(this._logger).register();
        new UpdateBridge(
            this._updater,
            cacheManager,
            this._configuration.publicKey,
            this._logger,
        ).register();
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
            await this._electron.loadHTML(startupPage(applicationVersion));
            await this._seedCache();
            let last = null;
            await this._updater.updateCache(this._configuration.publicKey, (status) => {
                last = status;
                this._electron.showStartupStatus(status);
            });
            if (last && last.stage === 'failed') {
                await new Promise((resolve) => setTimeout(resolve, this._failureNotice));
            }
            this._electron.showStartupStatus({ stage: 'starting' });
            this._electron.loadURL(this._configuration.applicationStartupURL);
        } catch (error) {
            this._logger.error('Failed to start application!', error);
        }
    }
};

// the page of the start, for its tests
module.exports.startupPage = startupPage;

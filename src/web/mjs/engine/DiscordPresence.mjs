export default class DiscordPresence {

    constructor(settings) {
        this.updater = null;
        this.statusNew = false;

        this._settings = settings; // Engine.Settings
        this.enabled = false;
        this.enabledHentai = false;
        this.hentai = false; // Is current item hentai?

        this._settings.addEventListener('loaded', this._onSettingsChanged.bind(this));
        this._settings.addEventListener('saved', this._onSettingsChanged.bind(this));

        // Current status
        this.status = {
            largeImageKey: 'logo',
            largeImageText: 'Manga & Anime Downloader for Linux, Windows & MacOS'
        };

        // EventListener
        document.addEventListener( EventListener.onSelectConnector, this._onSelectConnector.bind(this) );
        document.addEventListener( EventListener.onSelectManga, this._onSelectManga.bind(this) );
        document.addEventListener( EventListener.onSelectChapter, this._onSelectChapter.bind(this) );
    }

    async _onSettingsChanged() {
        this.enabled = this._settings.discordPresence.value !== 'none';
        this.enabledHentai = this._settings.discordPresence.value === 'hentai';

        if (this.enabled) {
            this.statusNew = true;
            await this.startDiscordPresence();
        } else {
            await this.stopDiscordPresence();
        }
    }

    _onSelectConnector(event) {
        this.isThisHentai(event.detail.tags);
        this.status['details'] = 'Browsing ' + event.detail.label;
        if (this.status.state) delete this.status.state;
        this.status.startTimestamp = + new Date();
        this.statusNew = true;
        if (this.enabled) this.startDiscordPresence();
    }

    _onSelectManga(event) {
        this.isThisHentai(event.detail.connector.tags);
        this.status['details'] = 'Browsing ' + event.detail.connector.label;
        this.status['state'] = 'Looking at ' + event.detail.title;
        this.status.startTimestamp = + new Date();
        this.statusNew = true;
        if (this.enabled) this.startDiscordPresence();
    }

    _onSelectChapter(event) {
        this.isThisHentai(event.detail.manga.connector.tags);
        this.status['details'] = 'Viewing ' + event.detail.manga.title;
        this.status['state'] = event.detail.title.padEnd(2); // State min. length is 2 char
        this.status.startTimestamp = + new Date();
        this.statusNew = true;
        if (this.enabled) this.startDiscordPresence();
    }

    isThisHentai(tags) {
        // Hentai check
        tags = tags.map(t => t.toLowerCase());
        if(tags.includes('hentai') || tags.includes('porn')) {
            this.hentai = true;
        } else {
            this.hentai = false;
        }
    }

    async updateStatus() {
        if(this.enabled && this.statusNew) {
            if(!this.hentai || this.hentai && this.enabledHentai) {
                // Fase 1 Slice C: transport lives in main (DiscordBridge);
                // success clears the pending flag (replaces socket heuristics).
                if(await window.hakuneko.presence.setActivity(this.status)) {
                    this.statusNew = false;
                }
            } else {
                this.statusNew = false;
            }
        }
    }

    async stopDiscordPresence() {
        this.statusNew = false;
        clearInterval(this.updater);
        this.updater = null;
        await window.hakuneko.presence.clearAndDestroy();
    }

    async startDiscordPresence() {
        // NOTE: main side is idempotent, safe to call on every selection event
        if(await window.hakuneko.presence.ensureStarted()) {
            this.status.startTimestamp = + new Date();

            // some delay for Discord to be receptive
            setTimeout(() => {
                this.updateStatus();
            }, 2000);

            // activity can only be set every 15 seconds (API limit)
            if(!this.updater) {
                this.updater = setInterval(() => {
                    this.updateStatus();
                }, 15200);
            }
        } else {
            // Waiting delay for Discord API to allow new connection
            setTimeout(() => {
                // Re-evaluate if enabled
                this._onSettingsChanged();
            }, 120000);
        }
    }
}

const events = {
    registered: 'registered',
    ready: 'ready'
};

// Modules are imported concurrently in batches (the files are small static
// resources, sequential awaits made startup scale with the connector count).
const BATCH_SIZE = 128;

export default class Connectors extends EventTarget {

    constructor(ipc) {
        super();
        ipc.listen('on-connector-protocol-handler', this._onConnectorProtocolHandler.bind(this));
        this._list = [];
        this._isReady = false;
        const { promise, resolve } = Promise.withResolvers();
        this._ready = promise;
        this._resolveReady = resolve;
    }

    async _loadPlugins(uri) {
        try {
            let response = await fetch(uri);
            let data = await response.json();
            return data.filter(plugin => !plugin.startsWith('.') && plugin.endsWith('.mjs')).map(plugin => uri + plugin);
        } catch(error) {
            //console.warn(error);
            return [];
        }
    }

    /**
     * Register the system connectors (bookmarks, folder, clipboard).
     * Cheap and required by the engine itself; the website connectors follow with `load()`.
     */
    async initialize() {
        const systemPlugins = [
            '../connectors/system/BookmarkConnector.mjs',
            '../connectors/system/FolderConnector.mjs',
            '../connectors/system/ClipboardConnector.mjs'
        ];
        await this.register(systemPlugins);
    }

    /**
     * Register the user plugins and all website connectors. Meant to run in the background
     * after the UI is shown: `registered` fires after every batch, `ready` when everything is loaded.
     */
    async load() {
        let [userPlugins, internalPlugins] = await Promise.all([
            this._loadPlugins('hakuneko://plugins/'),
            this._loadPlugins('hakuneko://cache/mjs/connectors/')
        ]);
        // user plugins first, so they win over internal connectors with the same ID
        await this.register(userPlugins);
        await this.register(internalPlugins);
        this._isReady = true;
        this._resolveReady(this._list);
        this.dispatchEvent(new CustomEvent(events.ready, { detail: this._list }));
    }

    get list() {
        return this._list;
    }

    /**
     * Fulfilled with the connector list as soon as `load()` has registered everything.
     */
    get ready() {
        return this._ready;
    }

    get isReady() {
        return this._isReady;
    }

    async register(files) {
        try {
            for(let offset = 0; offset < files.length; offset += BATCH_SIZE) {
                let batch = files.slice(offset, offset + BATCH_SIZE);
                let loaded = await Promise.all(batch.map(file => {
                    return import(file).then(module => ({ file, module }), error => ({ file, error }));
                }));
                // instantiate in the original order, so the first connector with a given ID always wins
                for(let { file, module, error } of loaded) {
                    try {
                        if(error) {
                            throw error;
                        }
                        let connector = new module.default();
                        if(this._list.find(c => c.id === connector.id)) {
                            console.warn(`The connector "${connector.label}" with ID "${connector.id}" is already registered`);
                        } else {
                            this._list.push(connector);
                        }
                    } catch(error) {
                        console.warn(`Failed to load connector "${file}"`, error);
                    }
                }
                this._list.sort( ( a, b ) => {
                    return a.label.toLowerCase() < b.label.toLowerCase() ? -1 : 1;
                } );
                this.dispatchEvent(new CustomEvent(events.registered, { detail: this._list }));
            }
        } catch(error) {
            console.warn(`Failed to load connector`, error);
        }
    }

    async _onConnectorProtocolHandler(request) {
        try {
            let uri = new URL(request.url);
            let find = () => this._list.find(connector => connector.id === uri.hostname);
            // requests may arrive before the (background) registration reached their connector
            let connector = find() || (this._isReady ? undefined : (await this._ready, find()));
            return connector.handleConnectorURI(uri);
        } catch(error) {
            console.error(error);
            return undefined;
        }
    }
}
/**
 * System
 * A special connector that allows to use manga links from the clipboard.
 * This connector does not implement the connector base class, because it operates different.
 */
export default class ClipboardConnector {

    /**
     *
     */
    constructor() {
        this.id = 'clipboard';
        this.label = ' 【Clipboard】';
        this.icon = '/img/connectors/' + this.id;
        this.tags = [];
        this.url = undefined;

        this.clipboard = window.hakuneko.clipboard;
        this.mangaCache = [];
        this.updateCallbacks = [];
    }

    /**
     *
     */
    updateMangas(callback) {
        // an update that is asked for while another one runs is answered when that one is over
        this.updateCallbacks.push(callback);
        if(!this.isUpdating) {
            this.isUpdating = true;
            this._getMangaList((error, mangas) => {
                // the list of an update that failed does not replace the one that is there
                if(!error) {
                    this.mangaCache = mangas;
                }
                this.isUpdating = false;
                this.updateCallbacks.splice(0).forEach(waiting => error ? waiting(error, this.mangaCache) : this.getMangas(waiting));
            });
        }
    }

    /**
     *
     */
    getMangas(callback) {
        callback(null, this.mangaCache);
    }

    /**
     *
     */
    async _getMangaList(callback) {
        let text = undefined;
        try {
            text = await this.clipboard.readText();
        } catch(error) {
            callback(error, []);
            return;
        }
        let promises = !text ? [] : text.split(/\r?\n/).map(async line => {
            try {
                let uri = new URL(line);
                let connectors = Engine.Connectors.filter(connector => connector.canHandleURI && connector.canHandleURI(uri));
                if(!connectors.length) {
                    // the host of the link is the host of the connector, or one is a subdomain of the other (www.example.com)
                    connectors = Engine.Connectors.filter(connector => {
                        let host = connector.url && new URL(connector.url).hostname;
                        return host && (host === uri.hostname || host.endsWith('.' + uri.hostname) || uri.hostname.endsWith('.' + host));
                    });
                }
                if(connectors.length > 1) {
                    connectors = connectors.filter(connector => uri.pathname.startsWith(new URL(connector.url).pathname));
                }
                if(!connectors.length) {
                    throw new Error('No matching connector found for URL ' + uri.href);
                }
                if(connectors.length > 1) {
                    throw new Error('To many matching connectors found for URL ' + uri.href);
                }
                return await connectors[0].getMangaFromURI(uri);
            } catch(error) {
                console.warn('CLIPBOARD:', line, error);
                return null;
            }
        });
        Promise.all(promises)
            .then(mangas => callback(null, mangas.filter(Boolean)))
            .catch(error => callback(error, []));
    }
}
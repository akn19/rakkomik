import { DETECTION_SCRIPT, installChallengeBypass } from './AntiScraping.mjs';
import { createNovelPage, createNovelScript } from './Novel.mjs';

export default class Request {
    // TODO: use dependency injection instead of globals for Engine.Settings, Engine.Blacklist, Enums
    constructor(ipc, settings) {
        // Fetch windows run in the main process (FetchWindowManager).
        // The application's user agent (set once in ElectronBootstrap) is used for the fetch
        // windows as well: cookies granted by an interstitial are bound to the user agent that
        // earned them, so fetch() and the hidden windows must present the same one.
        this.userAgent = navigator.userAgent;
        // Interstitial handling (see AntiScraping.mjs): how long a hidden window waits for the
        // page to complete a check by itself before it is shown to the user, how long the user
        // then gets, and how long one fetch() is allowed to wait for all of it.
        this.interactiveAfter = 15000;
        this.interactiveTimeout = 180000;
        this.challengeTimeout = 60000;
        this._restoreFetch = installChallengeBypass(window, this);

        ipc.listen('login', this._loginRequestHandler.bind(this));
        // NOTE: header surgery runs synchronously in the main process
        // (see src/app/HeaderSurgery.js) — never subscribe async webRequest
        // round-trips here, they hang on modern Electron.

        this._settings = settings;
        this._settings.addEventListener('loaded', this._onSettingsChanged.bind(this));
        this._settings.addEventListener('saved', this._onSettingsChanged.bind(this));
    }

    async _initializeHCaptchaUUID(settings) {
        let hcCookies = await window.hakuneko.session.getCookies({ name: 'hc_accessibility' });
        let isCookieAvailable = hcCookies.some(
            (cookie) => cookie.expirationDate > Date.now() / 1000 + 1800,
        );
        if (settings.hCaptchaAccessibilityUUID.value && !isCookieAvailable) {
            let script = `
                new Promise((resolve, reject) => {
                    setTimeout(() => {
                        try {
                            document.querySelector('button[data-cy*="setAccessibilityCookie"]').click();
                        } catch(error) {
                            reject(error);
                        }
                    }, 1000);
                    setInterval(() => {
                        if(document.cookie.includes('hc_accessibility=')) {
                            resolve(document.cookie);
                        }
                    }, 750);
                    setTimeout(() => {
                        reject(new Error('The hCaptcha accessibility cookie was not applied within the given timeout!'));
                    }, 7500);
                });
            `;
            let uri = new URL(
                'https://accounts.hcaptcha.com/verify_email/' +
                    settings.hCaptchaAccessibilityUUID.value,
            );
            let request = new window.Request(uri);
            try {
                let data = await this.fetchUI(request, script, 30000);
                console.log('Initialization of hCaptcha accessibility signup succeeded.', data);
            } catch (error) {
                // Maybe quota of cookie requests exceeded
                // Maybe account suspension because of suspicious behavior/abuse
                console.warn('Initialization of hCaptcha accessibility signup failed!', error);
            }
        }
    }

    _initializeProxy(settings) {
        // See: https://electronjs.org/docs/api/session#sessetproxyconfig-callback
        let proxy = {};
        if (settings.proxyRules.value) {
            proxy['proxyRules'] = settings.proxyRules.value;
        }
        window.hakuneko.session.setProxy(proxy);
    }

    _onSettingsChanged(event) {
        this._initializeProxy(event.detail);
        this._initializeHCaptchaUUID(event.detail);
    }

    /**
     * Answer the main process 'login' request.
     * @returns {Promise<Array<string>|null>} [username, password] or null
     */
    async _loginRequestHandler(authInfo) {
        let proxyAuth = this._settings.proxyAuth.value;
        if (authInfo.isProxy && proxyAuth && proxyAuth.includes(':')) {
            // the user name ends at the first colon, the password may have more of them
            let separator = proxyAuth.indexOf(':');
            let username = proxyAuth.slice(0, separator);
            let password = proxyAuth.slice(separator + 1);
            return [username, password];
        }
        return null;
    }

    /**
     *
     */
    get _domPreparationScript() {
        return `
            {
                let images = [...document.querySelectorAll( 'img[onerror]' )];
                for( let image of images ) {
                    image.removeAttribute( 'onerror' );
                    image.onerror = undefined;
                }
            }
        `;
    }

    get _scrapingCheckScript() {
        return DETECTION_SCRIPT;
    }

    /**
     * The browser window of electron does not support request objects,
     * so it is required to convert the request to supported options.
     */
    _extractRequestOptions(request) {
        let referer = request.headers.get('x-referer');
        let cookie = request.headers.get('x-cookie');
        let headers = [];
        if (cookie) {
            headers.push('x-cookie: ' + cookie);
        }
        headers = headers.join('\n');
        return {
            // set user agent to prevent `window.navigator.userAgent` being set to elecetron ...
            userAgent: request.headers.get('x-user-agent') || this.userAgent,
            httpReferrer: referer ? referer : undefined,
            extraHeaders: headers ? headers : undefined,

            //postData: undefined,
        };
    }

    /**
     * Run the request in a hidden main-process window (FetchWindowManager).
     * The preferences must be serializable (no callbacks can cross the IPC
     * boundary).
     */
    async fetchBrowser(request, preloadScript, runtimeScript, preferences, timeout) {
        return window.hakuneko.fetch({
            url: request.url,
            loadOptions: this._extractRequestOptions(request),
            preloadScript: preloadScript,
            runtimeScript: runtimeScript,
            domPreparationScript: this._domPreparationScript,
            scrapingCheckScript: this._scrapingCheckScript,
            blacklist: Engine.Blacklist.patterns,
            preferences: preferences || {},
            timeout: timeout || 60000,
            interactiveAfter: this.interactiveAfter,
            interactiveTimeout: this.interactiveTimeout,
        });
    }

    /**
     * If timeout [ms] is given, the window will be kept open until timout, otherwise
     * it will be closed after injecting the script (or after 60 seconds in case an error occured)
     */
    async fetchUI(request, injectionScript, timeout, images) {
        return window.hakuneko.fetch({
            url: request.url,
            loadOptions: this._extractRequestOptions(request),
            runtimeScript: injectionScript,
            domPreparationScript: this._domPreparationScript,
            scrapingCheckScript: this._scrapingCheckScript,
            blacklist: Engine.Blacklist.patterns,
            preferences: {
                nodeIntegration: false,
                webSecurity: false,
                images: images || false,
            },
            timeout: timeout || 60000,
            interactiveAfter: this.interactiveAfter,
            interactiveTimeout: this.interactiveTimeout,
        });
    }

    /**
     * Load the page of a chapter of a novel in a hidden window and take the text of the chapter from it (see Novel.mjs).
     * The images of the page are not loaded: the text is all there is to take, illustrations are downloaded when the chapter is stored.
     * @param {Request} request the page of the chapter
     * @param {string} contentQuery selector of the element that holds the text of the chapter
     * @param {object} [options]
     * @param {string} [options.obstacles] selector of the elements inside of the content that are not part of the text
     * @param {string[]} [options.ignoredTexts] paragraphs that consist of one of these texts are not part of the text
     * @param {number} [options.timeout] how long [ms] to wait for the text to show up (10 seconds unless told otherwise)
     * @returns {Promise<string>} the novel page, to be put into the page list of the chapter
     */
    async fetchNovel(request, contentQuery, options) {
        let xhtml = await this.fetchUI(request, createNovelScript(contentQuery, options), 30000);
        if (typeof xhtml !== 'string' || !xhtml) {
            throw new Error(`No text was found in the chapter "${request.url}"!`);
        }
        return createNovelPage(xhtml);
    }
}

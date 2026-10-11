// The request of the engine: what it hands to the hidden fetch windows of the main process (`window.hakuneko.fetch`)
// and how it follows the settings: the proxy, the accessibility cookie of hCaptcha and the login for the proxy.
const vm = require('node:vm');
const { exactly } = require('./support/coreFakes.js');

let EngineRequest = null;
let AntiScraping = null;
let Novel = null;

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const BLACKLIST = ['*://*.ads.test/*', '*://tracker.test/*'];

beforeAll(async () => {
    EngineRequest = (await import('../mjs/engine/Request.mjs')).default;
    AntiScraping = await import('../mjs/engine/AntiScraping.mjs');
    Novel = await import('../mjs/engine/Novel.mjs');
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// The page of the application: the preload bridge, the fetch that the engine wraps, the globals the class reads
function setup({ proxyRules = '', proxyAuth = '', uuid = '' } = {}) {
    const bridge = {
        fetch: vi.fn(async () => 'page content'),
        session: {
            getCookies: vi.fn(async () => []),
            setProxy: vi.fn(async () => undefined)
        }
    };
    const originalFetch = vi.fn(async () => new Response('content'));
    const page = { fetch: originalFetch, URL, Request, hakuneko: bridge };
    vi.stubGlobal('window', page);
    vi.stubGlobal('navigator', { userAgent: USER_AGENT });
    vi.stubGlobal('Engine', { Blacklist: { patterns: BLACKLIST } });
    const ipc = { listen: vi.fn() };
    const settings = Object.assign(new EventTarget(), {
        proxyRules: { value: proxyRules },
        proxyAuth: { value: proxyAuth },
        hCaptchaAccessibilityUUID: { value: uuid }
    });
    const request = new EngineRequest(ipc, settings);
    return { request, bridge, page, originalFetch, ipc, settings };
}

function job(bridge, call = 0) {
    return bridge.fetch.mock.calls[call][0];
}

describe('construction', () => {
    it('should present the user agent of the application to the fetch windows', async () => {
        const { request, bridge } = setup();
        expect(request.userAgent).toBe(USER_AGENT);
        await request.fetchUI(new Request('https://site.test/'));
        expect(job(bridge).loadOptions.userAgent).toBe(USER_AGENT);
    });

    it('should give the checks of interstitials the time that the main process gives them by default', () => {
        const { request } = setup();
        expect(request).toMatchObject({ interactiveAfter: 15000, interactiveTimeout: 180000, challengeTimeout: 60000 });
    });

    it('should do nothing with the proxy or the cookies before the settings are loaded', () => {
        const { bridge } = setup({ proxyRules: 'http=127.0.0.1:8080', uuid: '68e89cc3' });
        expect(bridge.session.setProxy).not.toHaveBeenCalled();
        expect(bridge.session.getCookies).not.toHaveBeenCalled();
    });

    it('should answer the login request of the main process with the current settings', async () => {
        const { ipc, settings } = setup({ proxyAuth: 'user:first' });
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        expect(ipc.listen).toHaveBeenCalledTimes(1);
        const [channel, handler] = ipc.listen.mock.calls[0];
        expect(channel).toBe('login');
        await expect(handler({ isProxy: true })).resolves.toEqual(['user', 'first']);
        settings.proxyAuth.value = 'other:second';
        await expect(handler({ isProxy: true })).resolves.toEqual(['other', 'second']);
    });

    it('should wrap fetch() so that interstitials are completed in a hidden window, and be able to undo it', async () => {
        const { request, page, originalFetch, bridge } = setup();
        const wrapped = page.fetch;
        expect(wrapped).not.toBe(originalFetch);

        request.challengeTimeout = 4242;
        originalFetch
            .mockResolvedValueOnce(new Response('wait', { status: 403, headers: { 'cf-mitigated': 'challenge' } }))
            .mockResolvedValueOnce(new Response('content'));
        const response = await wrapped('https://site.test/manga/1');
        await expect(response.text()).resolves.toBe('content');
        expect(originalFetch).toHaveBeenCalledTimes(2);
        // the page itself is loaded in the window, for as long as this request is told to wait
        expect(job(bridge)).toMatchObject({ url: 'https://site.test/manga/1', runtimeScript: 'true', timeout: 4242 });

        request._restoreFetch();
        expect(page.fetch).toBe(originalFetch);
    });
});

// The window of the main process cannot take a request: it takes the user agent, the referrer and extra headers
describe('the load options of a fetch window', () => {
    it.each([
        [ 'use the user agent of the application when the request has no special header', {}, {} ],
        [ 'take the referrer from the x-referer header', { 'x-referer': 'https://site.test/manga/1' }, { httpReferrer: 'https://site.test/manga/1' } ],
        [ 'send the cookie in an x-cookie header', { 'x-cookie': 'session=abc; theme=dark' }, { extraHeaders: 'x-cookie: session=abc; theme=dark' } ],
        [ 'take the user agent from the x-user-agent header', { 'x-user-agent': 'Custom/1.0' }, { userAgent: 'Custom/1.0' } ],
        [ 'take all of them at once', { 'x-referer': 'https://site.test/', 'x-cookie': 'a=1', 'x-user-agent': 'Custom/1.0' }, { httpReferrer: 'https://site.test/', extraHeaders: 'x-cookie: a=1', userAgent: 'Custom/1.0' } ],
        [ 'leave out the headers that a window cannot take', { authorization: 'Bearer x', accept: 'text/html', origin: 'https://site.test' }, {} ],
        [ 'leave out special headers that are empty', { 'x-referer': '', 'x-cookie': '', 'x-user-agent': '' }, {} ]
    ])('should %s', (name, headers, expected) => {
        const { request } = setup();
        const options = request._extractRequestOptions(new Request('https://site.test/', { headers }));
        expect(options).toEqual({ userAgent: USER_AGENT, httpReferrer: undefined, extraHeaders: undefined, ...expected });
    });
});

describe('fetchUI', () => {
    it('should hand the page and everything that goes with it to the main process', async () => {
        const { request, bridge } = setup();
        const result = await request.fetchUI(new Request('https://site.test/page', { headers: { 'x-referer': 'https://site.test/', 'x-cookie': 'a=1' } }), 'document.title', 30000, true);
        expect(result).toBe('page content');
        expect(bridge.fetch).toHaveBeenCalledTimes(1);
        expect(job(bridge)).toEqual({
            url: 'https://site.test/page',
            loadOptions: { userAgent: USER_AGENT, httpReferrer: 'https://site.test/', extraHeaders: 'x-cookie: a=1' },
            runtimeScript: 'document.title',
            domPreparationScript: request._domPreparationScript,
            scrapingCheckScript: AntiScraping.DETECTION_SCRIPT,
            blacklist: BLACKLIST,
            preferences: { nodeIntegration: false, webSecurity: false, images: true },
            timeout: 30000,
            interactiveAfter: 15000,
            interactiveTimeout: 180000
        });
    });

    it('should wait a minute and load no images unless told otherwise', async () => {
        const { request, bridge } = setup();
        await request.fetchUI(new Request('https://site.test/page'));
        expect(job(bridge)).toMatchObject({ timeout: 60000, preferences: { nodeIntegration: false, webSecurity: false, images: false } });
        expect(job(bridge).runtimeScript).toBeUndefined();
    });

    it('should never give the page access to node', async () => {
        const { request, bridge } = setup();
        await request.fetchUI(new Request('https://site.test/page'), '', 1000, true);
        expect(job(bridge).preferences.nodeIntegration).toBe(false);
    });

    it('should use the time that is set for the checks of the pages and the list of blocked addresses of the moment', async () => {
        const { request, bridge } = setup();
        request.interactiveAfter = 1;
        request.interactiveTimeout = 2;
        Engine.Blacklist.patterns = ['*://changed.test/*'];
        await request.fetchUI(new Request('https://site.test/page'));
        expect(job(bridge)).toMatchObject({ interactiveAfter: 1, interactiveTimeout: 2, blacklist: ['*://changed.test/*'] });
    });

    it('should only send what can cross the process boundary', async () => {
        const { request, bridge } = setup();
        await request.fetchUI(new Request('https://site.test/page', { headers: { 'x-cookie': 'a=1' } }), 'true', 5000, true);
        expect(structuredClone(job(bridge))).toEqual(job(bridge));
    });

    it('should resolve with the result of the script the page ran', async () => {
        const { request, bridge } = setup();
        bridge.fetch.mockResolvedValueOnce({ title: 'Chapter 1', pages: ['a', 'b'] });
        await expect(request.fetchUI(new Request('https://site.test/page'), 'script')).resolves.toEqual({ title: 'Chapter 1', pages: ['a', 'b'] });
    });

    it('should reject with the error of the main process, e.g. when the page could not be loaded', async () => {
        const { request, bridge } = setup();
        bridge.fetch.mockRejectedValueOnce(new Error('ERR_NAME_NOT_RESOLVED https://site.test/page'));
        await expect(request.fetchUI(new Request('https://site.test/page'))).rejects.toThrow('ERR_NAME_NOT_RESOLVED https://site.test/page');
    });

    it('should keep concurrent requests apart', async () => {
        const { request, bridge } = setup();
        const answers = [];
        bridge.fetch.mockImplementation(() => new Promise(resolve => answers.push(resolve)));
        const first = request.fetchUI(new Request('https://site.test/first'));
        const second = request.fetchUI(new Request('https://site.test/second'));
        expect(bridge.fetch.mock.calls.map(([sent]) => sent.url)).toEqual(['https://site.test/first', 'https://site.test/second']);
        answers[1]('answer to the second');
        answers[0]('answer to the first');
        await expect(first).resolves.toBe('answer to the first');
        await expect(second).resolves.toBe('answer to the second');
    });
});

describe('fetchBrowser', () => {
    it('should hand the scripts and the preferences of the caller to the main process as they are', async () => {
        const { request, bridge } = setup();
        const preferences = { nodeIntegration: true, images: true };
        const result = await request.fetchBrowser(new Request('https://site.test/page', { headers: { 'x-cookie': 'a=1' } }), 'window.flag = 1', 'window.flag', preferences, 12000);
        expect(result).toBe('page content');
        expect(job(bridge)).toEqual({
            url: 'https://site.test/page',
            loadOptions: { userAgent: USER_AGENT, httpReferrer: undefined, extraHeaders: 'x-cookie: a=1' },
            preloadScript: 'window.flag = 1',
            runtimeScript: 'window.flag',
            domPreparationScript: request._domPreparationScript,
            scrapingCheckScript: AntiScraping.DETECTION_SCRIPT,
            blacklist: BLACKLIST,
            preferences,
            timeout: 12000,
            interactiveAfter: 15000,
            interactiveTimeout: 180000
        });
    });

    it('should use no preferences and a minute by default', async () => {
        const { request, bridge } = setup();
        await request.fetchBrowser(new Request('https://site.test/page'));
        expect(job(bridge)).toMatchObject({ preferences: {}, timeout: 60000 });
    });
});

describe('fetchNovel', () => {
    it('should load the chapter in a window that runs the script for the novel and make a novel page of its text', async () => {
        const { request, bridge } = setup();
        const options = { obstacles: '.ads', ignoredTexts: ['Advertisement'], timeout: 5000 };
        bridge.fetch.mockResolvedValueOnce('<p>Once upon a time &amp; so on</p>');
        const page = await request.fetchNovel(new Request('https://novels.test/book/1/chapter/2'), 'div.entry-content', options);
        expect(job(bridge)).toMatchObject({
            url: 'https://novels.test/book/1/chapter/2',
            runtimeScript: Novel.createNovelScript('div.entry-content', options),
            timeout: 30000,
            preferences: { images: false }
        });
        expect(Novel.isNovelPage(page)).toBe(true);
        expect(Novel.readNovelPage(page)).toBe('<p>Once upon a time &amp; so on</p>');
    });

    it.each([
        [ 'an empty string', '' ],
        [ 'nothing', undefined ],
        [ 'null', null ],
        [ 'a number', 42 ],
        [ 'an object', { text: 'x' } ]
    ])('should reject a chapter of which the window answers with %s', async (name, answer) => {
        const { request, bridge } = setup();
        bridge.fetch.mockResolvedValueOnce(answer);
        await expect(request.fetchNovel(new Request('https://novels.test/book/1/chapter/2'), 'div.entry-content')).rejects.toThrow(exactly('No text was found in the chapter "https://novels.test/book/1/chapter/2"!'));
    });

    it('should reject when the chapter cannot be loaded', async () => {
        const { request, bridge } = setup();
        bridge.fetch.mockRejectedValueOnce(new Error('The novel content "div.x" was not found!'));
        await expect(request.fetchNovel(new Request('https://novels.test/c'), 'div.x')).rejects.toThrow('The novel content "div.x" was not found!');
    });
});

describe('the scripts that run in the page', () => {
    it('should check the page for interstitials with the detection of the anti-scraping module', () => {
        const { request } = setup();
        expect(request._scrapingCheckScript).toBe(AntiScraping.DETECTION_SCRIPT);
    });

    it('should take the error handlers off the images before the page can replace them', () => {
        const { request } = setup();
        const images = [0, 1].map(() => ({ removeAttribute: vi.fn(), onerror: () => undefined }));
        const document = { querySelectorAll: vi.fn(() => images) };
        vm.runInNewContext(request._domPreparationScript, { document });
        expect(document.querySelectorAll).toHaveBeenCalledWith('img[onerror]');
        for (const image of images) {
            expect(image.removeAttribute).toHaveBeenCalledWith('onerror');
            expect(image.onerror).toBeUndefined();
        }
    });

    it('should leave a page without such images alone', () => {
        const { request } = setup();
        const document = { querySelectorAll: vi.fn(() => []) };
        expect(() => vm.runInNewContext(request._domPreparationScript, { document })).not.toThrow();
    });
});

describe('the proxy', () => {
    it.each(['loaded', 'saved'])('should be set when the settings are %s', type => {
        const { settings, bridge } = setup({ proxyRules: 'http=127.0.0.1:8080;https=127.0.0.1:8080' });
        settings.dispatchEvent(new CustomEvent(type, { detail: settings }));
        expect(bridge.session.setProxy).toHaveBeenCalledTimes(1);
        expect(bridge.session.setProxy).toHaveBeenCalledWith({ proxyRules: 'http=127.0.0.1:8080;https=127.0.0.1:8080' });
    });

    it('should be switched off when the rules are blank', () => {
        const { settings, bridge } = setup({ proxyRules: '' });
        settings.dispatchEvent(new CustomEvent('saved', { detail: settings }));
        expect(bridge.session.setProxy).toHaveBeenCalledWith({});
    });

    it('should follow the settings that come with the event', () => {
        const { settings, bridge } = setup({ proxyRules: 'http=old:1' });
        const changed = { proxyRules: { value: 'socks=127.0.0.1:9050' }, hCaptchaAccessibilityUUID: { value: '' } };
        settings.dispatchEvent(new CustomEvent('saved', { detail: changed }));
        expect(bridge.session.setProxy).toHaveBeenCalledWith({ proxyRules: 'socks=127.0.0.1:9050' });
    });
});

describe('the login for the proxy', () => {
    it.each([
        [ 'the credentials of the proxy', true, 'user:secret', ['user', 'secret'] ],
        [ 'an empty password', true, 'user:', ['user', ''] ],
        [ 'an empty user name', true, ':secret', ['', 'secret'] ],
        [ 'nothing for a website that asks for credentials', false, 'user:secret', null ],
        [ 'nothing when no credentials are set', true, '', null ],
        [ 'nothing when the credentials have no separator', true, 'usersecret', null ]
    ])('should answer with %s', async (name, isProxy, proxyAuth, expected) => {
        const { request } = setup({ proxyAuth });
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        await expect(request._loginRequestHandler({ isProxy })).resolves.toEqual(expected);
    });

    it('should keep a colon that is part of the password', async () => {
        const { request } = setup({ proxyAuth: 'user:pa:ss' });
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        await expect(request._loginRequestHandler({ isProxy: true })).resolves.toEqual(['user', 'pa:ss']);
    });

    it('should not write the password to the console', async () => {
        const { request } = setup({ proxyAuth: 'user:s3cr3t-pass' });
        const written = ['log', 'info', 'debug', 'warn', 'error'].map(method => vi.spyOn(console, method).mockImplementation(() => undefined));
        await request._loginRequestHandler({ isProxy: true });
        expect(JSON.stringify(written.map(spy => spy.mock.calls))).not.toContain('s3cr3t-pass');
    });
});

describe('the accessibility cookie of hCaptcha', () => {
    const UUID = '68e89cc3-4c2d-4539-b80b-49ba4bec76c4';
    const NOW = Date.UTC(2030, 0, 1);

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });

    function cookie(secondsLeft) {
        return { name: 'hc_accessibility', expirationDate: NOW / 1000 + secondsLeft };
    }

    it('should sign up with the UUID of the user when there is no cookie', async () => {
        const { request, bridge } = setup({ uuid: UUID });
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        bridge.fetch.mockResolvedValueOnce('hc_accessibility=abc');
        await request._initializeHCaptchaUUID({ hCaptchaAccessibilityUUID: { value: UUID } });
        expect(bridge.session.getCookies).toHaveBeenCalledWith({ name: 'hc_accessibility' });
        expect(bridge.fetch).toHaveBeenCalledTimes(1);
        expect(job(bridge)).toMatchObject({ url: 'https://accounts.hcaptcha.com/verify_email/' + UUID, timeout: 30000 });
        expect(job(bridge).runtimeScript).toContain('hc_accessibility=');
        expect(console.log).toHaveBeenCalledWith('Initialization of hCaptcha accessibility signup succeeded.', 'hc_accessibility=abc');
    });

    it('should not sign up without a UUID', async () => {
        const { request, bridge } = setup();
        await request._initializeHCaptchaUUID({ hCaptchaAccessibilityUUID: { value: '' } });
        expect(bridge.fetch).not.toHaveBeenCalled();
    });

    it.each([
        [ 'leave a cookie that is valid for hours alone', [cookie(7200)], false ],
        [ 'leave a cookie that is valid for just over half an hour alone', [cookie(1801)], false ],
        [ 'sign up again when the cookie is valid for half an hour', [cookie(1800)], true ],
        [ 'sign up again when the cookie is about to expire', [cookie(60)], true ],
        [ 'sign up again when the cookie has expired', [cookie(-10)], true ],
        [ 'sign up when there is no cookie', [], true ],
        [ 'leave the cookies alone when one of them is valid', [cookie(-10), cookie(7200)], false ]
    ])('should %s', async (name, cookies, requested) => {
        const { request, bridge } = setup({ uuid: UUID });
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        bridge.session.getCookies.mockResolvedValueOnce(cookies);
        await request._initializeHCaptchaUUID({ hCaptchaAccessibilityUUID: { value: UUID } });
        expect(bridge.fetch).toHaveBeenCalledTimes(requested ? 1 : 0);
    });

    it('should only warn when the signup does not work, and not fail', async () => {
        const { request, bridge } = setup({ uuid: UUID });
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const failure = new Error('The hCaptcha accessibility cookie was not applied within the given timeout!');
        bridge.fetch.mockRejectedValueOnce(failure);
        await expect(request._initializeHCaptchaUUID({ hCaptchaAccessibilityUUID: { value: UUID } })).resolves.toBeUndefined();
        expect(console.warn).toHaveBeenCalledWith('Initialization of hCaptcha accessibility signup failed!', failure);
    });

    it('should look at the cookie whenever the settings are saved', async () => {
        const { settings, bridge } = setup({ uuid: UUID });
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        settings.dispatchEvent(new CustomEvent('saved', { detail: settings }));
        await vi.advanceTimersByTimeAsync(0);
        expect(bridge.session.getCookies).toHaveBeenCalledWith({ name: 'hc_accessibility' });
        expect(bridge.fetch).toHaveBeenCalledTimes(1);
    });

    describe('the script of the signup', () => {
        async function signupScript() {
            const { request, bridge } = setup({ uuid: UUID });
            vi.spyOn(console, 'log').mockImplementation(() => undefined);
            await request._initializeHCaptchaUUID({ hCaptchaAccessibilityUUID: { value: UUID } });
            return job(bridge).runtimeScript;
        }

        function run(script, document) {
            return vm.runInNewContext(script, { document, setTimeout, setInterval });
        }

        it('should click the button of the page after a second and resolve with the cookies once the cookie is set', async () => {
            const script = await signupScript();
            const click = vi.fn();
            const document = { cookie: 'session=1', querySelector: vi.fn(() => ({ click })) };
            let resolved = false;
            run(script, document).then(() => {
                resolved = true;
            });

            await vi.advanceTimersByTimeAsync(999);
            expect(click).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(click).toHaveBeenCalledTimes(1);
            expect(document.querySelector).toHaveBeenCalledWith('button[data-cy*="setAccessibilityCookie"]');

            // the page looks for the cookie every 750 milliseconds
            document.cookie = 'session=1; hc_accessibility=granted';
            await vi.advanceTimersByTimeAsync(499);
            expect(resolved).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            expect(resolved).toBe(true);
        });

        it('should resolve with the cookies of the page', async () => {
            const script = await signupScript();
            const document = { cookie: 'session=1; hc_accessibility=granted', querySelector: vi.fn(() => ({ click: vi.fn() })) };
            const outcome = run(script, document);
            await vi.advanceTimersByTimeAsync(750);
            await expect(outcome).resolves.toBe('session=1; hc_accessibility=granted');
        });

        it('should give up when the cookie is not set within 7.5 seconds', async () => {
            const script = await signupScript();
            const document = { cookie: 'session=1', querySelector: vi.fn(() => ({ click: vi.fn() })) };
            let rejected = false;
            const outcome = run(script, document);
            const assertion = expect(outcome).rejects.toThrow(exactly('The hCaptcha accessibility cookie was not applied within the given timeout!'));
            outcome.catch(() => {
                rejected = true;
            });
            await vi.advanceTimersByTimeAsync(7499);
            expect(rejected).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            await assertion;
            expect(rejected).toBe(true);
        });

        it('should fail at once with the error when the button is not on the page', async () => {
            const script = await signupScript();
            const document = { cookie: '', querySelector: vi.fn(() => null) };
            const outcome = run(script, document);
            // the script runs in its own realm: its errors are not instances of the TypeError of this file
            const assertion = expect(outcome).rejects.toMatchObject({ name: 'TypeError' });
            await vi.advanceTimersByTimeAsync(1000);
            await assertion;
        });
    });
});

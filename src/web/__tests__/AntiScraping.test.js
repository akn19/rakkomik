// Interstitial handling contract: recognize challenged responses and pages,
// complete them once per origin in a hidden window, retry once, give up loudly.
let AntiScraping = null;

beforeAll(async () => {
    AntiScraping = await import('../mjs/engine/AntiScraping.mjs');
});

afterEach(() => {
    delete globalThis.document;
    delete globalThis.CloudTest;
    vi.restoreAllMocks();
});

function html(status, headers, body = '<html></html>') {
    return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
}

/**
 * A document stub for the page detector: `elements` maps selectors (as written
 * in the detector, or any of their comma separated parts) to text content.
 */
function fakeDocument({ title = '', elements = {}, hostname = 'example.org' } = {}) {
    return {
        title,
        location: { hostname },
        querySelector: selector => {
            const wanted = selector.split(',').map(part => part.trim());
            const key = Object.keys(elements).find(known => wanted.includes(known));
            return key === undefined ? null : { textContent: elements[key] };
        }
    };
}

describe('isChallengeResponse', () => {
    const { isChallengeResponse } = () => AntiScraping;

    it('should trust the cf-mitigated header whatever else the response says', () => {
        expect(AntiScraping.isChallengeResponse(new Response('{}', { status: 403, headers: { 'cf-mitigated': 'challenge', 'content-type': 'application/json' } }))).toBe(true);
    });

    it('should recognize challenge-like HTML answers of known services and confirm them with the body', () => {
        expect(AntiScraping.isChallengeResponse(html(503, { server: 'cloudflare' }))).toBe(true);
        expect(AntiScraping.isChallengeResponse(html(503, { server: 'cloudflare' }), '<div id="challenge-running"></div>')).toBe(true);
        expect(AntiScraping.isChallengeResponse(html(503, { server: 'cloudflare' }), '<h1>Maintenance</h1>')).toBe(false);
        expect(AntiScraping.isChallengeResponse(html(403, { server: 'ddos-guard' }))).toBe(true);
    });

    it('should leave ordinary responses alone', () => {
        expect(AntiScraping.isChallengeResponse(html(200, { server: 'cloudflare' }))).toBe(false);
        expect(AntiScraping.isChallengeResponse(new Response('{}', { status: 403, headers: { server: 'cloudflare', 'content-type': 'application/json' } }))).toBe(false);
        expect(AntiScraping.isChallengeResponse(html(503, { server: 'nginx' }))).toBe(false);
        expect(AntiScraping.isChallengeResponse(html(404, { server: 'cloudflare' }))).toBe(false);
    });
});

describe('detectChallengeInPage', () => {
    const detect = options => AntiScraping.detectChallengeInPage(fakeDocument(options));

    it.each([
        [ 'a Cloudflare interstitial by title', { title: 'Just a moment...' }, 'automatic', 'cloudflare-challenge' ],
        [ 'a Cloudflare interstitial by markup', { title: 'Site', elements: { '#challenge-running': '' } }, 'automatic', 'cloudflare-challenge' ],
        [ 'a DDoS-Guard check', { title: 'DDOS-GUARD' }, 'automatic', 'ddos-guard' ],
        [ 'a DDoS-Guard captcha', { title: 'DDOS-GUARD', elements: { '#h-captcha': '' } }, 'interactive', 'ddos-guard-captcha' ],
        [ 'the ReadComicOnline captcha', { elements: { 'form#formVerify[action*="/Special/AreYouHuman"]': '' } }, 'interactive', 'readcomiconline-captcha' ],
        [ 'a CrunchyScan captcha', { hostname: 'crunchyscan.fr', elements: { '.g-recaptcha': '' } }, 'interactive', 'crunchyscan-captcha' ],
        [ 'a verification page with a captcha widget', { title: 'Verify you are human', elements: { 'iframe[src*="recaptcha"]': '' } }, 'interactive', 'captcha-gate' ],
        [ 'a meta refresh', { title: 'Redirecting', elements: { 'meta[http-equiv="refresh"][content*="="]': '' } }, 'automatic', 'meta-refresh' ]
    ])('should classify %s', (name, options, redirection, detector) => {
        expect(detect(options)).toEqual({ redirection, detector });
    });

    it('should report Cloudflare error and block pages as errors', () => {
        expect(detect({ elements: { '.cf-error-code': ' 1020 ' } })).toEqual({ redirection: 'error', detector: 'cloudflare-error', message: 'Cloudflare error 1020' });
        expect(detect({ title: 'Attention Required! | Cloudflare', elements: { '#cf-error-details': '' } })).toMatchObject({ redirection: 'error', detector: 'cloudflare-blocked' });
    });

    it('should treat a page with the CloudTest captcha as interactive', () => {
        globalThis.CloudTest = () => undefined;
        expect(detect({ title: 'Site' })).toEqual({ redirection: 'interactive', detector: 'cloudtest-captcha' });
    });

    it('should not mistake ordinary pages with a comment captcha for a gate', () => {
        expect(detect({ title: 'One Piece - Chapter 1', elements: { '.g-recaptcha': '' } })).toEqual({ redirection: 'none' });
        expect(detect({ title: 'Manga list' })).toEqual({ redirection: 'none' });
    });

    it('should ship the same logic as a self-contained script', () => {
        globalThis.document = fakeDocument({ title: 'Just a moment...' });
        expect(eval(AntiScraping.DETECTION_SCRIPT)).toEqual({ redirection: 'automatic', detector: 'cloudflare-challenge' });
        expect(AntiScraping.DETECTION_SCRIPT).not.toMatch(/_0x[0-9a-f]{3,}/);
    });
});

describe('installChallengeBypass', () => {
    const CHALLENGE = () => html(403, { 'cf-mitigated': 'challenge' }, 'wait');
    const CONTENT = () => html(200, {}, 'content');

    function scope(...responses) {
        const fetch = vi.fn(async () => responses.shift() || CONTENT());
        return { fetch, Request, URL, originalFetch: fetch };
    }

    function windows(behaviour) {
        return { challengeTimeout: 1234, fetchUI: vi.fn(behaviour || (async () => true)) };
    }

    it('should pass requests that are not http(s) straight through', async () => {
        const target = scope();
        const uninstall = AntiScraping.installChallengeBypass(target, windows());
        await target.fetch('hakuneko://cache/index.html');
        expect(target.originalFetch).toHaveBeenCalledWith('hakuneko://cache/index.html', undefined);
        uninstall();
    });

    it('should complete the interstitial in a window, then send the request once more', async () => {
        const target = scope(CHALLENGE(), CONTENT());
        const fetchWindows = windows();
        AntiScraping.installChallengeBypass(target, fetchWindows);
        const request = new Request('https://site.test/manga/1', { headers: { 'x-cookie': 'session=1' } });
        const response = await target.fetch(request);
        expect(await response.text()).toBe('content');
        expect(target.originalFetch).toHaveBeenCalledTimes(2);
        expect(fetchWindows.fetchUI).toHaveBeenCalledTimes(1);
        const [ windowRequest, script, timeout ] = fetchWindows.fetchUI.mock.calls[0];
        expect(windowRequest.url).toBe('https://site.test/manga/1');
        expect(windowRequest.headers.get('x-cookie')).toBe('session=1');
        expect(script).toBe('true');
        expect(timeout).toBe(1234);
    });

    it('should load the origin instead of the resource for requests that are not GETs', async () => {
        const target = scope(CHALLENGE(), CONTENT());
        const fetchWindows = windows();
        AntiScraping.installChallengeBypass(target, fetchWindows);
        await target.fetch('https://site.test/api/graphql', { method: 'POST', body: '{}' });
        expect(fetchWindows.fetchUI.mock.calls[0][0].url).toBe('https://site.test/');
    });

    it('should open one window per origin for concurrent requests', async () => {
        const target = scope(CHALLENGE(), CHALLENGE(), CHALLENGE(), CHALLENGE(), CONTENT(), CONTENT(), CONTENT(), CONTENT());
        const releases = [];
        const fetchWindows = windows(() => new Promise(resolve => releases.push(resolve)));
        AntiScraping.installChallengeBypass(target, fetchWindows);
        const pending = Promise.all([
            target.fetch('https://site.test/a'),
            target.fetch('https://site.test/b'),
            target.fetch('https://site.test/c'),
            target.fetch('https://other.test/d')
        ]);
        await vi.waitFor(() => expect(fetchWindows.fetchUI).toHaveBeenCalledTimes(2));
        expect(fetchWindows.fetchUI.mock.calls.map(call => call[0].url).sort()).toEqual([ 'https://other.test/d', 'https://site.test/a' ]);
        releases.forEach(release => release(true));
        const responses = await pending;
        expect(responses.map(response => response.status)).toEqual([ 200, 200, 200, 200 ]);
    });

    it('should confirm ambiguous answers with the body before opening a window', async () => {
        const target = scope(html(503, { server: 'cloudflare' }, '<h1>Down for maintenance</h1>'));
        const fetchWindows = windows();
        AntiScraping.installChallengeBypass(target, fetchWindows);
        const response = await target.fetch('https://site.test/');
        expect(response.status).toBe(503);
        expect(await response.text()).toContain('maintenance');
        expect(fetchWindows.fetchUI).not.toHaveBeenCalled();
    });

    it('should hand back the challenged response when the window could not complete it', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const target = scope(CHALLENGE(), CONTENT());
        AntiScraping.installChallengeBypass(target, windows(async () => { throw new Error('closed'); }));
        const response = await target.fetch('https://site.test/');
        expect(response.status).toBe(403);
        expect(target.originalFetch).toHaveBeenCalledTimes(1);
        expect(console.warn).toHaveBeenCalledTimes(1);
    });

    it('should not retry endlessly when the second answer is still an interstitial', async () => {
        const target = scope(CHALLENGE(), CHALLENGE(), CONTENT());
        const fetchWindows = windows();
        AntiScraping.installChallengeBypass(target, fetchWindows);
        const response = await target.fetch('https://site.test/');
        expect(response.status).toBe(403);
        expect(target.originalFetch).toHaveBeenCalledTimes(2);
        expect(fetchWindows.fetchUI).toHaveBeenCalledTimes(1);
    });

    it('should restore the original fetch', async () => {
        const target = scope();
        const original = target.fetch;
        const uninstall = AntiScraping.installChallengeBypass(target, windows());
        expect(target.fetch).not.toBe(original);
        uninstall();
        expect(target.fetch).toBe(original);
    });
});

/**
 * Anti-scraping interstitials (Cloudflare, DDoS-Guard, captcha gates).
 *
 * The engine does not try to outsmart them: a hidden browser window loads the
 * page like a regular browser would, the site's own challenge script runs to
 * completion there, and when a human is required the window is shown to the
 * user. This module only answers two questions, in plain readable code:
 * - is a fetch() response an interstitial instead of the content (`isChallengeResponse`)?
 * - what is the page in a fetch window currently showing (`detectChallengeInPage`)?
 * It also makes the renderer's global `fetch()` transparent to interstitials
 * (`installChallengeBypass`): one hidden window per origin, then a single retry.
 */

export const Redirection = {
    None: 'none', // the real content
    Automatic: 'automatic', // the page completes the check on its own, keep waiting
    Interactive: 'interactive', // a human has to act, show the window
    Error: 'error' // the site refuses, waiting will not help
};

/**
 * Classify the page a fetch window is showing. Runs INSIDE the page (see
 * `DETECTION_SCRIPT`), so it must stay self-contained: no module scope, no imports.
 * @param {Document} doc
 * @returns {{ redirection: string, detector?: string, message?: string }}
 */
export function detectChallengeInPage(doc = globalThis.document) {
    const title = (doc.title || '').trim();
    const has = selector => !!doc.querySelector(selector);
    const hostname = doc.location ? doc.location.hostname : '';
    const captchaWidget = '.g-recaptcha, .h-captcha, #h-captcha, iframe[src*="recaptcha"], iframe[src*="hcaptcha.com"]';

    // Cloudflare error pages (1006, 1020, 52x, "Sorry, you have been blocked"): nothing to wait for
    const cloudflareError = doc.querySelector('.cf-error-code, #cf-error-details .cf-error-type');
    if (cloudflareError) {
        return { redirection: 'error', detector: 'cloudflare-error', message: 'Cloudflare error ' + cloudflareError.textContent.trim() };
    }
    if (has('#cf-error-details') || /^attention required/i.test(title)) {
        return { redirection: 'error', detector: 'cloudflare-blocked', message: 'Blocked by Cloudflare (' + title + ')' };
    }
    // Cloudflare challenge interstitial: the page's script completes it; the fetch window
    // falls back to showing the window when it does not finish in time
    if (/^just a moment/i.test(title) || has('#challenge-running, #challenge-stage, #challenge-error-text, form#challenge-form, script[src*="/cdn-cgi/challenge-platform/"]')) {
        return { redirection: 'automatic', detector: 'cloudflare-challenge' };
    }
    // DDoS-Guard
    if (title === 'DDOS-GUARD' || has('script[src*="ddos-guard"]')) {
        return has(captchaWidget) ? { redirection: 'interactive', detector: 'ddos-guard-captcha' } : { redirection: 'automatic', detector: 'ddos-guard' };
    }
    // captcha gates of specific websites
    if (has('form#formVerify[action*="/Special/AreYouHuman"]')) {
        return { redirection: 'interactive', detector: 'readcomiconline-captcha' };
    }
    if (typeof globalThis.CloudTest === 'function') {
        return { redirection: 'interactive', detector: 'cloudtest-captcha' };
    }
    if (/crunchyscan/i.test(hostname) && has(captchaWidget)) {
        return { redirection: 'interactive', detector: 'crunchyscan-captcha' };
    }
    // generic gate: a verification page carrying a captcha widget
    if (/verify|captcha|human|security check|access denied|checking your browser/i.test(title) && has(captchaWidget)) {
        return { redirection: 'interactive', detector: 'captcha-gate' };
    }
    if (has('meta[http-equiv="refresh"][content*="="]')) {
        return { redirection: 'automatic', detector: 'meta-refresh' };
    }
    return { redirection: 'none' };
}

/**
 * The detection as a script for `webContents.executeJavaScript` (evaluates to the result object).
 */
export const DETECTION_SCRIPT = `(${detectChallengeInPage.toString()})()`;

const CHALLENGE_STATUS = new Set([ 403, 429, 503 ]);
const CHALLENGE_SERVERS = [ 'cloudflare', 'ddos-guard' ];
const CHALLENGE_MARKERS = /cdn-cgi\/challenge-platform|_cf_chl_opt|challenge-form|challenge-running|DDOS-GUARD/i;

/**
 * Whether a fetch() response is an interstitial instead of the requested content.
 * Cloudflare announces its challenges with the `cf-mitigated: challenge` header;
 * other services are recognized by the combination of server, status and HTML body.
 * @param {Response} response
 * @param {string} [text] the response body, when the caller has read it already
 * @returns {boolean}
 */
export function isChallengeResponse(response, text) {
    const header = name => (response.headers.get(name) || '').toLowerCase();
    if (header('cf-mitigated') === 'challenge') {
        return true;
    }
    const server = header('server');
    if (!CHALLENGE_SERVERS.some(name => server.includes(name)) || !CHALLENGE_STATUS.has(response.status) || !header('content-type').includes('text/html')) {
        return false;
    }
    return typeof text === 'string' ? CHALLENGE_MARKERS.test(text) : true;
}

/**
 * Make `scope.fetch` transparent to interstitials: a challenged response triggers
 * one hidden window for the origin (concurrent requests share it), then the
 * request is sent once more. Anything that is still challenged after that is
 * returned as it is, so callers can report it.
 * @param {Window} scope the global object whose `fetch` is wrapped
 * @param {{ fetchUI: Function, challengeTimeout?: number }} fetchWindows the engine's Request instance
 * @returns {Function} restores the original fetch
 */
export function installChallengeBypass(scope, fetchWindows) {
    const originalFetch = scope.fetch;
    const pending = new Map();

    const needsChallenge = async response => {
        if (!response.headers.has('cf-mitigated') && !isChallengeResponse(response)) {
            return false;
        }
        // the server/status/type combination alone is ambiguous: confirm with the (small) body
        return isChallengeResponse(response, response.headers.get('cf-mitigated') ? undefined : await response.clone().text());
    };

    const solve = request => {
        const uri = new scope.URL(request.url);
        if (!pending.has(uri.origin)) {
            // the cookie granted by the interstitial is valid for the whole origin: load the
            // requested page itself, or the origin for requests that are not simple GETs
            const target = request.method === 'GET' ? uri.href : uri.origin + '/';
            const attempt = fetchWindows.fetchUI(new scope.Request(target, { headers: request.headers }), 'true', fetchWindows.challengeTimeout)
                .finally(() => pending.delete(uri.origin));
            pending.set(uri.origin, attempt);
        }
        return pending.get(uri.origin);
    };

    scope.fetch = async function fetchThroughChallenges(input, init) {
        const request = new scope.Request(input, init);
        if (!/^https?:$/.test(new scope.URL(request.url).protocol)) {
            return originalFetch.call(scope, input, init);
        }
        const response = await originalFetch.call(scope, request.clone());
        if (!(await needsChallenge(response))) {
            return response;
        }
        try {
            await solve(request);
        } catch (error) {
            console.warn(`The interstitial of "${new scope.URL(request.url).origin}" could not be completed:`, error);
            return response;
        }
        return originalFetch.call(scope, request);
    };

    return () => {
        scope.fetch = originalFetch;
    };
}

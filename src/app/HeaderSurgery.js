/**
 * Synchronous header surgery for session webRequest hooks (Fase 1 fix).
 *
 * The renderer round-trip (`_ipcSend` + async listener) MUST NOT be used
 * here: on modern Electron an async webRequest listener hangs every request
 * before the hook even fires (verified live on Electron 44: sync-callback
 * loads fine, any async form stalls forever). Hence this module replicates
 * `Request.onBeforeSendHeadersHandler/onHeadersReceivedHandler` 1:1 in the
 * main process — single source of truth for hook behavior, keep both in
 * sync when the rules change.
 */
class CookieJar {
    constructor(cookies) {
        this.list = {};
        (cookies || '').split(';')
            .filter(cookie => cookie.trim())
            .forEach(cookie => {
                let pair = cookie.split('=');
                this.set(pair.shift(), pair.join('='));
            });
    }

    toString() {
        return Object.keys(this.list)
            .filter(key => this.list[key] !== 'EXPIRED')
            .map(key => key + '=' + this.list[key])
            .join('; ');
    }

    set(key, value) {
        this.list[key.toString().trim()] = value.toString().trim();
    }

    merge(cookie) {
        let result = new CookieJar();
        Object.keys(this.list).forEach(key => result.set(key, this.list[key]));
        if (cookie instanceof CookieJar) {
            Object.keys(cookie.list).forEach(key => result.set(key, cookie.list[key]));
        }
        return result;
    }

    static applyCrossSiteCookies(headers) {
        // NOTE: hardened vs the old renderer port — string values are
        // written back (the old code only mutated a throwaway copy).
        const key = headers['set-cookie'] ? 'set-cookie' : 'Set-Cookie';
        let cookies = headers[key];
        if (!cookies) {
            return;
        }
        const single = !Array.isArray(cookies);
        if (single) {
            cookies = [cookies];
        }
        for (let index in cookies) {
            cookies[index] = [...cookies[index].split(';').map(part => part.trim()).filter(part => !/^SameSite=/i.test(part)), 'SameSite=None'].join('; ');
        }
        if (single) {
            headers[key] = cookies[0];
        }
    }
}

function randomChromeUA() {
    const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const version = `${rnd(131, 132)}.${rnd(0, 99)}.${rnd(0, 9999)}.${rnd(0, 999)}`;
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
}

module.exports = class HeaderSurgery {

    constructor() {
        //Like the renderer Request.userAgent: one plausible Chrome UA per launch.
        this.userAgent = randomChromeUA();
    }

    applyBeforeSendHeaders(url, requestHeaders) {
        let uri = new URL(url);

        // Remove accidently added headers from opened developer console
        for (let header in requestHeaders) {
            if (header.startsWith('X-DevTools')) {
                delete requestHeaders[header];
            }
        }

        // Overwrite the Host header with the one provided by the connector
        if (requestHeaders['x-host']) {
            requestHeaders['Host'] = requestHeaders['x-host'];
        }
        delete requestHeaders['x-host'];

        // Always overwrite the electron user agent
        if (requestHeaders['User-Agent'] && requestHeaders['User-Agent'].toLowerCase().includes('electron')) {
            requestHeaders['User-Agent'] = this.userAgent;
        }
        // If a custom user agent is set use this instead
        if (requestHeaders['x-user-agent']) {
            requestHeaders['User-Agent'] = requestHeaders['x-user-agent'];
            delete requestHeaders['x-user-agent'];
        }

        // Prevent loading anything from cache (espacially CloudFlare protection)
        requestHeaders['Cache-Control'] = requestHeaders['no-cache'];
        requestHeaders['Pragma'] = requestHeaders['no-cache'];

        /*
         * Overwrite the Referer header, but
         * NEVER overwrite the referer for CloudFlare's DDoS protection to prevent infinite redirects!
         */
        if (!/(ch[kl]_jschl|challenge-platform)/i.test(uri.href)) {
            if (uri.hostname.includes('.mcloud.to')) {
                requestHeaders['Referer'] = uri.href;
            } else if (requestHeaders['x-referer']) {
                requestHeaders['Referer'] = requestHeaders['x-referer'];
            }
        }
        delete requestHeaders['x-referer'];

        // Overwrite the Origin header
        if (requestHeaders['x-origin']) {
            requestHeaders['Origin'] = requestHeaders['x-origin'];
        }
        delete requestHeaders['x-origin'];

        // Append Cookie header
        if (requestHeaders['x-cookie']) {
            let cookiesORG = new CookieJar(requestHeaders['Cookie']);
            let cookiesNEW = new CookieJar(requestHeaders['x-cookie']);
            requestHeaders['Cookie'] = cookiesORG.merge(cookiesNEW).toString();
        }
        delete requestHeaders['x-cookie'];

        //
        if (requestHeaders['x-sec-fetch-dest']) {
            requestHeaders['Sec-Fetch-Dest'] = requestHeaders['x-sec-fetch-dest'];
        }
        delete requestHeaders['x-sec-fetch-dest'];

        //
        if (requestHeaders['x-sec-fetch-mode']) {
            requestHeaders['Sec-Fetch-Mode'] = requestHeaders['x-sec-fetch-mode'];
        }
        delete requestHeaders['x-sec-fetch-mode'];

        //
        if (requestHeaders['x-sec-fetch-site']) {
            requestHeaders['Sec-Fetch-Site'] = requestHeaders['x-sec-fetch-site'];
        }
        delete requestHeaders['x-sec-fetch-site'];

        //
        if (requestHeaders['x-sec-ch-ua']) {
            requestHeaders['sec-ch-ua'] = requestHeaders['x-sec-ch-ua'];
        }
        delete requestHeaders['x-sec-ch-ua'];

        // HACK: Imgur does not support request with accept types containing other mimes then images
        //       => overwrite accept header to prevent redirection to HTML notice
        if (/i\.imgur\.com/i.test(uri.hostname) || /\.(jpg|jpeg|png|gif|webp)/i.test(uri.pathname)) {
            requestHeaders['Accept'] = 'image/webp,image/apng,image/*,*/*';
            delete requestHeaders['accept'];
        }

        // Avoid detection of HakuNeko through lowercase accept header
        if (requestHeaders['accept']) {
            requestHeaders['Accept'] = requestHeaders['accept'];
            delete requestHeaders['accept'];
        }

        return requestHeaders;
    }

    applyHeadersReceived(url, responseHeaders) {
        let uri = new URL(url);

        /*
         * Some video sreaming sites (Streamango, OpenVideo) using 'X-Redirect' header instead of 'Location' header,
         * but fetch API only follows 'Location' header redirects => assign redirect to location
         */
        let redirect = responseHeaders['X-Redirect'] || responseHeaders['x-redirect'];
        if (redirect) {
            responseHeaders['Location'] = redirect;
        }
        if (uri.hostname.includes('mp4upload')) {
            responseHeaders['Access-Control-Expose-Headers'] = ['Content-Length'];
        }
        if (uri.hostname.includes('webtoons') && uri.searchParams.get('title_no')) {
            responseHeaders['Set-Cookie'] = `agn2=${uri.searchParams.get('title_no')}; Domain=${uri.hostname}; Path=/`;
        }
        if (uri.hostname.includes('comikey') && uri.pathname.includes('/read/')) {
            delete responseHeaders['content-security-policy'];
        }

        if (responseHeaders['set-cookie'] || responseHeaders['Set-Cookie']) {
            CookieJar.applyCrossSiteCookies(responseHeaders);
        }

        return responseHeaders;
    }
};

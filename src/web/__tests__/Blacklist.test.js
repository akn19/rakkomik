// The hosts that the fetch windows must not load (advertising, trackers): Request hands `Engine.Blacklist.patterns` to the
// main process, which gives them to Electron as the URL filter of the session (FetchWindowManager).
let Blacklist = null;

beforeAll(async () => {
    Blacklist = (await import('../mjs/engine/Blacklist.mjs')).default;
});

// https://developer.chrome.com/extensions/match_patterns : <scheme>://<host>/<path>, the host at least a domain and a
// top-level domain (or `*.` and those), so a typo can never block a whole top-level domain
const MATCH_PATTERN = /^(?:\*|https?):\/\/(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*$/;

describe('the default patterns', () => {
    it('should be a list of strings', () => {
        const { patterns } = new Blacklist();
        expect(Array.isArray(patterns)).toBe(true);
        expect(patterns.length).toBeGreaterThan(50);
        expect(patterns.every(pattern => typeof pattern === 'string')).toBe(true);
    });

    it('should all be match patterns that Electron accepts as a URL filter', () => {
        const invalid = new Blacklist().patterns.filter(pattern => !MATCH_PATTERN.test(pattern));
        expect(invalid).toEqual([]);
    });

    it('should list every pattern once, as addPattern keeps it', () => {
        const { patterns } = new Blacklist();
        const duplicates = patterns.filter((pattern, index) => patterns.indexOf(pattern) !== index);
        expect(duplicates).toEqual([]);
    });

    it.each([
        ['accounts.google.com', 'sites that need a Google login'],
        ['cloudfront.net', 'the CDN that hosts the images of many sites'],
        ['discordapp.com', 'the CDN of the scanlation groups that publish on Discord'],
        ['facebook.com', 'sites that sign in with Facebook'],
        ['facebook.net', 'sites that sign in with Facebook'],
        ['fbcdn.net', 'images that sites keep on the Facebook CDN'],
        ['gstatic.com', 'scripts and fonts of the pages of Google']
    ])('should not block all of %s (%s)', (host) => {
        const blocked = new Blacklist().patterns.filter(pattern => pattern === `*://*.${host}/*` || pattern === `*://${host}/*`);
        expect(blocked).toEqual([]);
    });

    it.each([
        '*://*.doubleclick.net/*',
        '*://*.google-analytics.com/*',
        '*://*.googlesyndication.com/*',
        '*://*.googletagmanager.com/*',
        '*://*.adnxs.com/*',
        '*://*.taboola.com/*',
        '*://*.outbrain.com/*'
    ])('should block the advertising and tracking host %s', (pattern) => {
        expect(new Blacklist().patterns).toContain(pattern);
    });
});

describe('addPattern', () => {
    it('should append a new pattern', () => {
        const blacklist = new Blacklist();
        const count = blacklist.patterns.length;
        blacklist.addPattern('*://*.ads.example/*');
        expect(blacklist.patterns).toHaveLength(count + 1);
        expect(blacklist.patterns[count]).toBe('*://*.ads.example/*');
    });

    it('should ignore a pattern that is already in the list', () => {
        const blacklist = new Blacklist();
        const count = blacklist.patterns.length;
        blacklist.addPattern('*://*.doubleclick.net/*');
        blacklist.addPattern('*://*.ads.example/*');
        blacklist.addPattern('*://*.ads.example/*');
        expect(blacklist.patterns).toHaveLength(count + 1);
        expect(blacklist.patterns.filter(pattern => pattern === '*://*.ads.example/*')).toHaveLength(1);
    });

    it('should extend the list in place, so the consumers that hold it see the new pattern', () => {
        const blacklist = new Blacklist();
        const held = blacklist.patterns;
        blacklist.addPattern('*://*.ads.example/*');
        expect(blacklist.patterns).toBe(held);
        expect(held).toContain('*://*.ads.example/*');
    });

    it('should keep the lists of two blacklists apart', () => {
        const first = new Blacklist();
        const second = new Blacklist();
        first.addPattern('*://*.ads.example/*');
        expect(second.patterns).not.toContain('*://*.ads.example/*');
        expect(second.patterns).not.toBe(first.patterns);
    });
});

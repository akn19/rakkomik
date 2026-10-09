const HeaderSurgery = require('../HeaderSurgery.js');

describe('HeaderSurgery', () => {
    let surgery = null;

    beforeEach(() => {
        surgery = new HeaderSurgery();
    });

    it('should replace the electron user agent', () => {
        const out = surgery.applyBeforeSendHeaders('https://example.com/', {
            'User-Agent': 'Mozilla/5.0 Electron/44.0.0'
        });
        expect(out['User-Agent']).not.toContain('Electron');
        expect(out['User-Agent']).toContain('Chrome/');
    });

    it('should keep a plain browser user agent untouched', () => {
        const out = surgery.applyBeforeSendHeaders('https://example.com/', {
            'User-Agent': 'Mozilla/5.0 Chrome/120'
        });
        expect(out['User-Agent']).toBe('Mozilla/5.0 Chrome/120');
    });

    it('should map connector x-headers and drop the originals', () => {
        const out = surgery.applyBeforeSendHeaders('https://example.com/page', {
            'User-Agent': 'x',
            'x-host': 'cdn.example.com',
            'x-user-agent': 'Custom/1.0',
            'x-referer': 'https://example.com/',
            'x-origin': 'https://example.com',
            'x-cookie': 'b=2',
            'Cookie': 'a=1',
            'x-sec-fetch-dest': 'document'
        });
        expect(out['Host']).toBe('cdn.example.com');
        expect(out['User-Agent']).toBe('Custom/1.0');
        expect(out['Referer']).toBe('https://example.com/');
        expect(out['Origin']).toBe('https://example.com');
        expect(out['Cookie']).toBe('a=1; b=2');
        expect(out['Sec-Fetch-Dest']).toBe('document');
        for (const key of Object.keys(out)) {
            expect(key.startsWith('x-')).toBe(false);
        }
    });

    it('should never overwrite the referer on cloudflare challenge pages', () => {
        const out = surgery.applyBeforeSendHeaders('https://site.test/__chl_jschl_tk__', {
            'User-Agent': 'x',
            'x-referer': 'https://evil.test/'
        });
        expect(out['Referer']).toBeUndefined();
    });

    it('should force image accept headers for pictures', () => {
        const out = surgery.applyBeforeSendHeaders('https://i.imgur.com/a.jpg', {
            'User-Agent': 'x',
            'accept': 'text/html'
        });
        expect(out['Accept']).toContain('image/*');
        expect(out['accept']).toBeUndefined();
    });

    it('should map X-Redirect to Location and patch known hosts', () => {
        const redirected = surgery.applyHeadersReceived('https://stream.test/x', {
            'X-Redirect': 'https://stream.test/y'
        });
        expect(redirected['Location']).toBe('https://stream.test/y');
        const webtoons = surgery.applyHeadersReceived('https://webtoons.test/c?title_no=7', {});
        expect(webtoons['Set-Cookie']).toContain('agn2=7');
        const comikey = surgery.applyHeadersReceived('https://comikey.test/read/1', {
            'content-security-policy': 'x'
        });
        expect(comikey['content-security-policy']).toBeUndefined();
    });

    it('should normalize samesite on cookies', () => {
        const headers = { 'Set-Cookie': 'a=1; SameSite=Lax' };
        surgery.applyHeadersReceived('https://example.com/', headers);
        expect(headers['Set-Cookie']).toContain('SameSite=None');
        expect(headers['Set-Cookie']).not.toMatch(/SameSite=Lax/);
    });
});

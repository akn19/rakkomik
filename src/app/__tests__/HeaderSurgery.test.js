const HeaderSurgery = require('../HeaderSurgery.js');

describe('HeaderSurgery', () => {
    let surgery = null;

    beforeEach(() => {
        surgery = new HeaderSurgery();
    });

    it('should replace the electron user agent', () => {
        const out = surgery.applyBeforeSendHeaders('https://example.com/', {
            'User-Agent': 'Mozilla/5.0 Electron/44.0.0',
        });
        expect(out['User-Agent']).not.toContain('Electron');
        expect(out['User-Agent']).toContain('Chrome/');
    });

    it('should keep a plain browser user agent untouched', () => {
        const out = surgery.applyBeforeSendHeaders('https://example.com/', {
            'User-Agent': 'Mozilla/5.0 Chrome/120',
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
            Cookie: 'a=1',
            'x-sec-fetch-dest': 'document',
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
            'x-referer': 'https://evil.test/',
        });
        expect(out['Referer']).toBeUndefined();
    });

    it('should force image accept headers for pictures', () => {
        const out = surgery.applyBeforeSendHeaders('https://i.imgur.com/a.jpg', {
            'User-Agent': 'x',
            accept: 'text/html',
        });
        expect(out['Accept']).toContain('image/*');
        expect(out['accept']).toBeUndefined();
    });

    it('should map X-Redirect to Location and patch known hosts', () => {
        const redirected = surgery.applyHeadersReceived('https://stream.test/x', {
            'X-Redirect': 'https://stream.test/y',
        });
        expect(redirected['Location']).toBe('https://stream.test/y');
        const webtoons = surgery.applyHeadersReceived('https://webtoons.test/c?title_no=7', {});
        expect(webtoons['Set-Cookie']).toContain('agn2=7');
        const comikey = surgery.applyHeadersReceived('https://comikey.test/read/1', {
            'content-security-policy': 'x',
        });
        expect(comikey['content-security-policy']).toBeUndefined();
    });

    it('should normalize samesite on cookies', () => {
        const headers = { 'Set-Cookie': 'a=1; SameSite=Lax' };
        surgery.applyHeadersReceived('https://example.com/', headers);
        expect(headers['Set-Cookie']).toContain('SameSite=None');
        expect(headers['Set-Cookie']).not.toMatch(/SameSite=Lax/);
    });
    describe('the user agent of the surgery', () => {
        it('should be the one it is given, and replace a stray Electron one', () => {
            const custom = new HeaderSurgery('Mozilla/5.0 Chrome/152.0.0.0 Safari/537.36');
            const out = custom.applyBeforeSendHeaders('https://example.com/', {
                'User-Agent': 'Mozilla/5.0 rakkomik/1.0.0 Electron/44.7.0',
            });
            expect(out['User-Agent']).toBe('Mozilla/5.0 Chrome/152.0.0.0 Safari/537.36');
        });

        it('should be a Chrome user agent of its own when it is given none', () => {
            expect(new HeaderSurgery().userAgent).toMatch(
                /^Mozilla\/5\.0 .* Chrome\/\d[\d.]* Safari\/537\.36$/,
            );
            expect(new HeaderSurgery().userAgent).not.toMatch(/electron/i);
            expect(new HeaderSurgery('').userAgent).toBe(new HeaderSurgery().userAgent);
        });

        it.each([
            'Mozilla/5.0 Electron/44.7.0',
            'Mozilla/5.0 electron/44.7.0',
            'Mozilla/5.0 (X11) RakKomik/1.0 ELECTRON/44',
            'electron',
        ])('should replace the user agent %s', (userAgent) => {
            const out = surgery.applyBeforeSendHeaders('https://example.com/', {
                'User-Agent': userAgent,
            });
            expect(out['User-Agent']).toBe(surgery.userAgent);
        });

        it('should leave a request without a user agent without one', () => {
            expect(
                surgery.applyBeforeSendHeaders('https://example.com/', {})['User-Agent'],
            ).toBeUndefined();
        });

        it('should let the connector choose the user agent, even over the one of Electron, and not pass the helper header on', () => {
            const out = surgery.applyBeforeSendHeaders('https://example.com/', {
                'User-Agent': 'Electron/44',
                'x-user-agent': 'Custom/1.0',
            });
            expect(out['User-Agent']).toBe('Custom/1.0');
            expect(out['x-user-agent']).toBeUndefined();
            expect(
                surgery.applyBeforeSendHeaders('https://example.com/', {
                    'x-user-agent': 'Custom/2.0',
                })['User-Agent'],
            ).toBe('Custom/2.0');
        });
    });

    describe('applyBeforeSendHeaders()', () => {
        const apply = (headers, url = 'https://example.com/page') =>
            surgery.applyBeforeSendHeaders(url, headers);

        it('should change the headers it is given and hand them back', () => {
            const headers = { Accept: 'text/html' };
            expect(apply(headers)).toBe(headers);
        });

        it('should leave the headers alone that are no business of it', () => {
            const out = apply({
                'Accept-Language': 'id,en;q=0.8',
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                Range: 'bytes=0-9',
            });
            expect(out).toMatchObject({
                'Accept-Language': 'id,en;q=0.8',
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                Range: 'bytes=0-9',
            });
        });

        it('should fail for a URL it cannot read, so that the caller can let the request go as it is', () => {
            expect(() => apply({}, 'not a URL')).toThrow(TypeError);
        });

        it('should remove the headers that the developer tools add', () => {
            const out = apply({
                'X-DevTools-Emulate-Network-Conditions-Client-Id': 'ABC',
                'X-DevTools-Request-Id': '1',
                'x-devtools': 'no',
                'X-Other': 'kept',
            });
            expect(Object.keys(out).filter((name) => name.startsWith('X-DevTools'))).toEqual([]);
            expect(out['X-Other']).toBe('kept');
        });

        it('should always make the server revalidate', () => {
            expect(apply({})).toMatchObject({ 'Cache-Control': 'no-cache', Pragma: 'no-cache' });
            expect(apply({ 'Cache-Control': 'max-age=3600', Pragma: 'cache' })).toMatchObject({
                'Cache-Control': 'no-cache',
                Pragma: 'no-cache',
            });
        });

        it.each([
            ['Host', 'x-host', 'cdn.example.com'],
            ['Origin', 'x-origin', 'https://example.com'],
            ['Sec-Fetch-Dest', 'x-sec-fetch-dest', 'image'],
            ['Sec-Fetch-Mode', 'x-sec-fetch-mode', 'no-cors'],
            ['Sec-Fetch-Site', 'x-sec-fetch-site', 'same-origin'],
            ['sec-ch-ua', 'x-sec-ch-ua', '"Chromium";v="152"'],
        ])(
            'should turn the helper header %2$s of the connector into %1$s and not pass it on',
            (header, helper, value) => {
                const out = apply({ [helper]: value, [header]: 'the original' });
                expect(out[header]).toBe(value);
                expect(out[helper]).toBeUndefined();
                expect(apply({ [header]: 'the original' })[header]).toBe('the original');
                expect(apply({ [helper]: '' })[helper]).toBeUndefined();
                expect(apply({ [helper]: '' })[header]).toBeUndefined();
            },
        );

        describe('Referer', () => {
            it('should be the one the connector asks for', () => {
                const out = apply({
                    Referer: 'https://electron.local/',
                    'x-referer': 'https://example.com/series/1',
                });
                expect(out.Referer).toBe('https://example.com/series/1');
                expect(out['x-referer']).toBeUndefined();
            });

            it('should stay as it is without a request of the connector', () => {
                expect(apply({ Referer: 'https://example.com/a' }).Referer).toBe(
                    'https://example.com/a',
                );
                expect(apply({}).Referer).toBeUndefined();
            });

            it('should be the URL of the request itself for the hosts of mcloud', () => {
                const out = apply(
                    { 'x-referer': 'https://example.com/' },
                    'https://video.mcloud.to/embed/abc?x=1',
                );
                expect(out.Referer).toBe('https://video.mcloud.to/embed/abc?x=1');
                expect(out['x-referer']).toBeUndefined();
            });

            it.each([
                'https://mcloud.example.com/embed/abc',
                'https://notmcloud.to.example.com/embed/abc',
                'https://example.com/path/.mcloud.to/embed',
            ])(
                'should be the one the connector asks for on a host that only looks like mcloud (%s)',
                (url) => {
                    expect(apply({ 'x-referer': 'https://example.com/series' }, url).Referer).toBe(
                        'https://example.com/series',
                    );
                },
            );

            it.each([
                'https://site.test/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1',
                'https://site.test/path?__cf_chl_jschl_tk__=abc',
                'https://site.test/?chk_jschl=1',
                'https://site.test/?CHL_JSCHL=1',
                'https://video.mcloud.to/challenge-platform/x',
            ])(
                'should never be touched on the challenge page of an anti-bot check, to prevent endless redirects (%s)',
                (url) => {
                    const out = apply(
                        { Referer: 'https://original.test/', 'x-referer': 'https://evil.test/' },
                        url,
                    );
                    expect(out.Referer).toBe('https://original.test/');
                    expect(out['x-referer']).toBeUndefined();
                },
            );
        });

        describe('Cookie', () => {
            const cookie = (existing, helper) =>
                apply({
                    ...(existing === undefined ? {} : { Cookie: existing }),
                    'x-cookie': helper,
                }).Cookie;

            it('should add the cookies of the connector to those of the browser', () => {
                expect(cookie('a=1; b=2', 'c=3')).toBe('a=1; b=2; c=3');
                expect(cookie(undefined, 'c=3; d=4')).toBe('c=3; d=4');
            });

            it('should let the cookies of the connector win over those of the browser with the same name, in their place', () => {
                expect(cookie('a=1; b=2', 'a=9; c=3')).toBe('a=9; b=2; c=3');
            });

            it('should delete a cookie of the browser that the connector marks as EXPIRED', () => {
                expect(cookie('a=1; b=2', 'a=EXPIRED')).toBe('b=2');
                expect(cookie('a=1', 'a=EXPIRED')).toBe('');
            });

            it('should keep equals signs, spaces and everything else inside the value of a cookie', () => {
                expect(cookie('token=abc==; x=1', 'y=a=b=c')).toBe('token=abc==; x=1; y=a=b=c');
                expect(cookie(' a = 1 ;  b=2 ', ' c =3')).toBe('a=1; b=2; c=3');
            });

            it('should skip empty pieces', () => {
                expect(cookie('a=1;; ;', '; ;b=2;;')).toBe('a=1; b=2');
            });

            it('should not touch the cookies of the browser when the connector has none to add', () => {
                expect(cookie('a=1', '')).toBe('a=1');
            });

            it('should not pass the helper header on', () => {
                expect(apply({ 'x-cookie': 'a=1' })['x-cookie']).toBeUndefined();
            });

            it('should take a cookie without a value as an empty value', () => {
                expect(cookie('a=1', 'flag')).toBe('a=1; flag=');
            });
        });

        describe('Accept', () => {
            const IMAGES = 'image/webp,image/apng,image/*,*/*';

            it.each([
                ['https://i.imgur.com/abc', 'the host of Imgur'],
                ['https://cdn.example.com/a/b.jpg', 'a .jpg'],
                ['https://cdn.example.com/a/b.jpeg', 'a .jpeg'],
                ['https://cdn.example.com/a/b.png?x=1', 'a .png with a query'],
                ['https://cdn.example.com/a/b.gif', 'a .gif'],
                ['https://cdn.example.com/a/b.webp', 'a .webp'],
                ['https://cdn.example.com/a/B.JPG', 'a capital .JPG'],
            ])('should ask for pictures only when the URL is %s (%s)', (url) => {
                const out = apply(
                    { Accept: 'text/html,application/xhtml+xml', accept: 'application/json' },
                    url,
                );
                expect(out.Accept).toBe(IMAGES);
                expect(out.accept).toBeUndefined();
            });

            it.each([
                'https://example.com/chapter/1',
                'https://example.com/image.svg',
                'https://example.com/image.avif',
                'https://example.com/page?file=picture.png',
                'https://example.com/page#a.jpg',
            ])('should leave the Accept header of %s alone', (url) => {
                expect(apply({ Accept: 'text/html' }, url).Accept).toBe('text/html');
            });

            it('should always write it as Accept, for the connectors send it in lower case', () => {
                const out = apply({ accept: 'application/json' });
                expect(out.Accept).toBe('application/json');
                expect(out.accept).toBeUndefined();
            });

            it('should let the lower case one of the connector win over the one of Chromium', () => {
                expect(apply({ Accept: 'text/html', accept: 'application/json' }).Accept).toBe(
                    'application/json',
                );
            });

            // NOTE: the extension is looked for anywhere in the path, not at its end: the page of a series called
            // "my.gifted.series" is asked for with the Accept header of a picture. Harmless as `*/*` is part of it.
            it('should also take an extension for a picture in the middle of the path', () => {
                expect(
                    apply(
                        { Accept: 'text/html' },
                        'https://example.com/series/my.gifted.series/chapter-1',
                    ).Accept,
                ).toBe(IMAGES);
            });
        });
    });

    describe('applyHeadersReceived()', () => {
        const receive = (headers, url = 'https://example.com/page') =>
            surgery.applyHeadersReceived(url, headers);

        it('should change the headers it is given and hand them back', () => {
            const headers = { 'content-type': ['text/html'] };
            expect(receive(headers)).toBe(headers);
            expect(headers).toEqual({ 'content-type': ['text/html'] });
        });

        it('should fail for a URL it cannot read, so that the caller can let the response through as it is', () => {
            expect(() => receive({}, 'not a URL')).toThrow(TypeError);
        });

        it.each([['X-Redirect'], ['x-redirect']])(
            'should make the %s header of a stream host a Location for the redirect to be followed',
            (name) => {
                const out = receive(
                    { [name]: ['https://stream.test/next'] },
                    'https://stream.test/video',
                );
                expect(out.Location).toEqual(['https://stream.test/next']);
                expect(out[name]).toEqual(['https://stream.test/next']);
            },
        );

        it('should not invent a Location', () => {
            expect(receive({ 'content-type': ['text/html'] }).Location).toBeUndefined();
        });

        it('should let the page read the Content-Length of the video hosts of mp4upload', () => {
            expect(
                receive({}, 'https://www.mp4upload.com/embed')['Access-Control-Expose-Headers'],
            ).toEqual(['Content-Length']);
            expect(
                receive(
                    { 'Access-Control-Expose-Headers': ['X-Other'] },
                    'https://a.mp4upload.com/x',
                )['Access-Control-Expose-Headers'],
            ).toEqual(['Content-Length']);
            expect(
                receive({}, 'https://example.com/x')['Access-Control-Expose-Headers'],
            ).toBeUndefined();
        });

        describe('the age cookie of Webtoons', () => {
            it('should be set for the title of the page, for the whole site, and be readable across sites', () => {
                const out = receive(
                    {},
                    'https://www.webtoons.com/en/romance/title/list?title_no=1234',
                );
                expect(out['Set-Cookie']).toBe(
                    'agn2=1234; Domain=www.webtoons.com; Path=/; Secure; SameSite=None',
                );
            });

            it.each([
                ['a page without a title number', 'https://www.webtoons.com/en/'],
                ['an empty title number', 'https://www.webtoons.com/en/x?title_no='],
                ['another site', 'https://example.com/x?title_no=7'],
            ])('should not be set for %s', (_, url) => {
                expect(receive({}, url)['Set-Cookie']).toBeUndefined();
            });

            it('should be readable across sites next to the cookies of the server', () => {
                const out = receive(
                    { 'set-cookie': ['session=abc; Path=/; SameSite=Lax'] },
                    'https://www.webtoons.com/en/x?title_no=7',
                );
                const cookies = [out['set-cookie'], out['Set-Cookie']].flat().filter(Boolean);
                expect(cookies.length).toBeGreaterThan(0);
                for (const header of cookies) {
                    expect(header).toMatch(/SameSite=None/);
                }
            });
        });

        it('should drop the content security policy of the reader pages of Comikey, and only those', () => {
            const policy = ['default-src none'];
            expect(
                receive(
                    { 'content-security-policy': policy },
                    'https://comikey.com/read/some-title/chapter-1/',
                )['content-security-policy'],
            ).toBeUndefined();
            expect(
                receive(
                    { 'content-security-policy': policy },
                    'https://comikey.com/comics/some-title/',
                )['content-security-policy'],
            ).toBe(policy);
            expect(
                receive(
                    { 'content-security-policy': policy },
                    'https://example.com/read/chapter-1',
                )['content-security-policy'],
            ).toBe(policy);
        });

        describe('Set-Cookie', () => {
            it.each([
                ['a cookie without attributes', 'a=1', 'a=1; Secure; SameSite=None'],
                ['a cookie that is Lax', 'a=1; SameSite=Lax', 'a=1; Secure; SameSite=None'],
                [
                    'a cookie that is Strict',
                    'a=1; SameSite=Strict; Path=/',
                    'a=1; Path=/; Secure; SameSite=None',
                ],
                [
                    'an attribute in any case',
                    'a=1; samesite=strict; Path=/',
                    'a=1; Path=/; Secure; SameSite=None',
                ],
                [
                    'a cookie that is None already',
                    'a=1; SameSite=None; Secure',
                    'a=1; Secure; SameSite=None',
                ],
                [
                    'a cookie that is Secure already, in any case',
                    'a=1; SECURE; SameSite=Lax',
                    'a=1; SECURE; SameSite=None',
                ],
                [
                    'the other attributes in their order',
                    'id=7; Path=/; Domain=.example.com; HttpOnly; Secure; Max-Age=3600; SameSite=Lax',
                    'id=7; Path=/; Domain=.example.com; HttpOnly; Secure; Max-Age=3600; SameSite=None',
                ],
                [
                    'a date with commas and spaces',
                    'a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT; SameSite=Lax',
                    'a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Secure; SameSite=None',
                ],
                [
                    'an attribute in the middle',
                    'a=1; SameSite=Lax; Path=/x',
                    'a=1; Path=/x; Secure; SameSite=None',
                ],
                [
                    'a value with equals signs',
                    'token=abc==; SameSite=Lax',
                    'token=abc==; Secure; SameSite=None',
                ],
                [
                    'a value that says Secure',
                    'a=Secure; SameSite=Lax',
                    'a=Secure; Secure; SameSite=None',
                ],
                [
                    'untidy spaces',
                    '  a=1 ;SameSite=Lax;   Path=/  ',
                    'a=1; Path=/; Secure; SameSite=None',
                ],
            ])('should make %s readable across sites', (_, cookie, expected) => {
                expect(receive({ 'set-cookie': [cookie] })['set-cookie']).toEqual([expected]);
            });

            it('should rewrite every cookie of the response', () => {
                const out = receive({
                    'set-cookie': ['a=1; SameSite=Lax', 'b=2', 'c=3; SameSite=Strict'],
                });
                expect(out['set-cookie']).toEqual([
                    'a=1; Secure; SameSite=None',
                    'b=2; Secure; SameSite=None',
                    'c=3; Secure; SameSite=None',
                ]);
            });

            it('should keep the shape of the header: a list stays a list, a single text stays a text', () => {
                expect(receive({ 'set-cookie': ['a=1'] })['set-cookie']).toEqual([
                    'a=1; Secure; SameSite=None',
                ]);
                expect(receive({ 'set-cookie': 'a=1' })['set-cookie']).toBe(
                    'a=1; Secure; SameSite=None',
                );
            });

            it('should find the header under either name', () => {
                expect(receive({ 'Set-Cookie': ['a=1'] })['Set-Cookie']).toEqual([
                    'a=1; Secure; SameSite=None',
                ]);
                expect(receive({ 'set-cookie': ['a=1'] })['set-cookie']).toEqual([
                    'a=1; Secure; SameSite=None',
                ]);
            });

            it('should find the header in any other letter case and when it is there under more than one', () => {
                expect(receive({ 'SET-COOKIE': ['a=1'] })['SET-COOKIE']).toEqual([
                    'a=1; Secure; SameSite=None',
                ]);
                const out = receive({ 'set-cookie': ['a=1'], 'Set-Cookie': 'b=2' });
                expect(out['set-cookie']).toEqual(['a=1; Secure; SameSite=None']);
                expect(out['Set-Cookie']).toBe('b=2; Secure; SameSite=None');
            });

            it.each([
                ['no header', {}],
                ['an empty text', { 'set-cookie': '' }],
                ['an empty list', { 'set-cookie': [] }],
            ])('should leave a response with %s as it is', (_, headers) => {
                expect(receive(structuredClone(headers))).toEqual(headers);
            });

            it('should not touch the other headers of the response', () => {
                const out = receive({
                    'set-cookie': ['a=1'],
                    'content-type': ['text/html'],
                    'cache-control': ['no-store'],
                });
                expect(out['content-type']).toEqual(['text/html']);
                expect(out['cache-control']).toEqual(['no-store']);
            });

            it('should make the cookies that are not Secure Secure, as Chromium refuses SameSite=None otherwise', () => {
                const out = receive({
                    'set-cookie': [
                        'plain=1; Path=/',
                        'lax=1; Path=/; SameSite=Lax',
                        'secure=1; Path=/; Secure; SameSite=Lax',
                    ],
                })['set-cookie'];
                for (const cookie of out) {
                    expect(cookie).toMatch(/(^|; )SameSite=None(;|$)/);
                    // once, also for the cookie that has it already
                    expect(cookie.match(/(^|; )Secure(;|$)/g)).toHaveLength(1);
                }
            });
        });
    });
});

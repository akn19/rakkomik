// @vitest-environment happy-dom
// The helpers of the connectors that work with the DOM of a page: making a DOM of the content that a website sent,
// fetching a page and selecting from it, the helpers that decode what websites hide and the links of elements.
const { exactly } = require('./support/coreFakes.js');

let Connector = null;

beforeAll(async () => {
    Connector = (await import('../mjs/engine/Connector.mjs')).default;
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function createSite() {
    const site = new Connector();
    site.id = 'site';
    site.label = 'Site';
    site.url = 'https://site.test';
    site.initialized = true; // no browser window for the initialization
    site.wait = vi.fn(async () => undefined); // no waiting between the attempts
    return site;
}

function element(markup) {
    const holder = document.createElement('div');
    holder.innerHTML = markup;
    return holder;
}

describe('createDOM', () => {
    it('should make an element of the content, which can be searched', () => {
        const dom = createSite().createDOM(
            '<ul class="chapters"><li class="chapter"><a href="/chapter/1">One</a></li><li class="chapter"><a href="/chapter/2">Two</a></li></ul>',
        );
        expect(dom.tagName).toBe('HTML');
        expect([...dom.querySelectorAll('li.chapter > a')].map((link) => link.textContent)).toEqual(
            ['One', 'Two'],
        );
        expect(dom.querySelector('ul.chapters')).not.toBeNull();
    });

    it('should make a DOM of a whole page', () => {
        const dom = createSite().createDOM(
            '<!DOCTYPE html><html lang="en"><head><title>Chapter 1</title></head><body><div id="reader"><p>text</p></div></body></html>',
        );
        expect(dom.querySelector('title').textContent).toBe('Chapter 1');
        expect(dom.querySelector('#reader p').textContent).toBe('text');
    });

    it('should make a DOM without text of nothing', () => {
        const dom = createSite().createDOM('');
        expect(dom.tagName).toBe('HTML');
        expect(dom.textContent).toBe('');
    });

    it('should keep the links as the website wrote them', () => {
        const dom = createSite().createDOM(
            '<a href="/manga/1?page=2#top">One</a><a href="//cdn.test/x">Two</a>',
        );
        expect([...dom.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([
            '/manga/1?page=2#top',
            '//cdn.test/x',
        ]);
    });

    it('should keep unicode and long content', () => {
        const long = 'x'.repeat(200000);
        const dom = createSite().createDOM(
            `<p id="a">漫画 🙂 &amp; "quotes"</p><p id="b">${long}</p>`,
        );
        expect(dom.querySelector('#a').textContent).toBe('漫画 🙂 & "quotes"');
        expect(dom.querySelector('#b').textContent).toHaveLength(long.length);
    });

    describe('the images', () => {
        const CONTENT =
            '<div><img src="/1.png" alt="One"><img src="/2.png"></img><use href="#icon"></use></div>';

        it('should be replaced by source elements, so that the page does not load them', () => {
            const dom = createSite().createDOM(CONTENT);
            expect(dom.querySelectorAll('img')).toHaveLength(0);
            expect(dom.querySelectorAll('use')).toHaveLength(0);
            const sources = [...dom.querySelectorAll('source')];
            expect(sources).toHaveLength(3);
            expect(sources[0].getAttribute('src')).toBe('/1.png');
            expect(sources[0].getAttribute('alt')).toBe('One');
            expect(sources[2].getAttribute('href')).toBe('#icon');
        });

        it('should be replaced when it is asked for', () => {
            const dom = createSite().createDOM(CONTENT, true);
            expect(dom.querySelectorAll('img')).toHaveLength(0);
        });

        it('should stay as they are when it is asked for', () => {
            const dom = createSite().createDOM(CONTENT, false);
            expect(dom.querySelectorAll('img')).toHaveLength(2);
            expect(dom.querySelectorAll('use')).toHaveLength(1);
            expect(dom.querySelectorAll('source')).toHaveLength(0);
        });
    });

    describe('the iframes', () => {
        const CONTENT =
            '<div><iframe src="https://ads.test/banner" id="ad" width="300"></iframe><iframe></iframe></div>';

        it('should lose their attributes, so that the page does not load them', () => {
            const dom = createSite().createDOM(CONTENT);
            const frames = [...dom.querySelectorAll('iframe')];
            expect(frames).toHaveLength(2);
            for (const frame of frames) {
                expect(frame.attributes).toHaveLength(0);
                expect(frame.textContent).toBe('');
            }
        });

        it('should lose their attributes when it is asked for', () => {
            const dom = createSite().createDOM(CONTENT, true, true);
            expect(dom.querySelector('iframe').hasAttribute('src')).toBe(false);
        });

        it('should keep their attributes when it is asked for', () => {
            const dom = createSite().createDOM(CONTENT, true, false);
            expect(dom.querySelector('iframe').getAttribute('src')).toBe('https://ads.test/banner');
            expect(dom.querySelector('iframe').getAttribute('id')).toBe('ad');
        });

        it('should be decided apart from the images', () => {
            const dom = createSite().createDOM(
                '<img src="/1.png"><iframe src="https://ads.test"></iframe>',
                false,
                true,
            );
            expect(dom.querySelectorAll('img')).toHaveLength(1);
            expect(dom.querySelector('iframe').hasAttribute('src')).toBe(false);
        });
    });
});

describe('fetchDOM', () => {
    const PAGE =
        '<ul><li class="chapter">One</li><li class="chapter">Two</li><li class="other">Three</li></ul>';

    function page(
        status,
        body = PAGE,
        { type = 'text/html; charset=utf-8', headers = {}, statusText = '' } = {},
    ) {
        return () =>
            new Response(body, {
                status,
                statusText,
                headers: { ...(type ? { 'content-type': type } : {}), ...headers },
            });
    }

    function stubFetch(...answers) {
        const fetch = vi.fn(async () => (answers.length > 1 ? answers.shift() : answers[0])());
        vi.stubGlobal('fetch', fetch);
        return fetch;
    }

    it('should hand out the elements of the page that the selector selects', async () => {
        stubFetch(page(200));
        const found = await createSite().fetchDOM('https://site.test/list', 'li.chapter');
        expect(Array.isArray(found)).toBe(true);
        expect(found.map((item) => item.textContent)).toEqual(['One', 'Two']);
    });

    it('should hand out nothing for a selector that selects nothing', async () => {
        stubFetch(page(200));
        await expect(
            createSite().fetchDOM('https://site.test/list', 'li.missing'),
        ).resolves.toEqual([]);
    });

    it('should hand out the whole DOM when there is no selector', async () => {
        stubFetch(page(200));
        const dom = await createSite().fetchDOM('https://site.test/list');
        expect(dom.tagName).toBe('HTML');
        expect(dom.querySelectorAll('li')).toHaveLength(3);
    });

    it('should make the DOM like createDOM does, without the images', async () => {
        stubFetch(page(200, '<div><img src="/1.png"></div>'));
        const dom = await createSite().fetchDOM('https://site.test/page');
        expect(dom.querySelectorAll('img')).toHaveLength(0);
        expect(dom.querySelectorAll('source')).toHaveLength(1);
    });

    it('should send a request with the options of the connector, for an address as well as for a string', async () => {
        const fetch = stubFetch(page(200));
        const connector = createSite();
        connector.requestOptions.headers.set('x-referer', 'https://site.test/');
        await connector.fetchDOM('https://site.test/list', 'li');
        await connector.fetchDOM(new URL('https://site.test/other'), 'li');
        for (const [request] of fetch.mock.calls) {
            expect(request.method).toBe('GET');
            expect(request.headers.get('x-referer')).toBe('https://site.test/');
            expect(request.headers.get('accept')).toContain('text/html');
        }
        expect(fetch.mock.calls.map(([request]) => request.url)).toEqual([
            'https://site.test/list',
            'https://site.test/other',
        ]);
    });

    it('should send a copy of the request that it is given, and leave the request as it was', async () => {
        const fetch = stubFetch(page(200));
        const request = new Request('https://site.test/search', { method: 'POST', body: 'q=one' });
        await createSite().fetchDOM(request, 'li');
        expect(fetch.mock.calls[0][0]).not.toBe(request);
        expect(fetch.mock.calls[0][0].url).toBe('https://site.test/search');
        expect(request.bodyUsed).toBe(false);
    });

    describe('the encoding', () => {
        // "café" and "Привет" as a website with an old encoding sends them
        const CAFE = new Uint8Array([
            0x3c, 0x70, 0x3e, 0x63, 0x61, 0x66, 0xe9, 0x3c, 0x2f, 0x70, 0x3e,
        ]);
        const PRIVET = new Uint8Array([
            0x3c, 0x70, 0x3e, 0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x3c, 0x2f, 0x70, 0x3e,
        ]);

        it('should be UTF-8 unless told otherwise', async () => {
            stubFetch(page(200, '<p>café 漫画</p>'));
            const [paragraph] = await createSite().fetchDOM('https://site.test/', 'p');
            expect(paragraph.textContent).toBe('café 漫画');
        });

        it.each([
            ['iso-8859-1', CAFE, 'café'],
            ['windows-1251', PRIVET, 'Привет'],
        ])('should be %s when the connector says so', async (encoding, bytes, expected) => {
            stubFetch(page(200, bytes));
            const [paragraph] = await createSite().fetchDOM('https://site.test/', 'p', 0, encoding);
            expect(paragraph.textContent).toBe(expected);
        });

        it('should fail for an encoding that is not known', async () => {
            stubFetch(page(200));
            await expect(
                createSite().fetchDOM('https://site.test/', 'p', 0, 'no-such-encoding'),
            ).rejects.toThrow();
        });

        it('should be the same when the page is asked for again after a server error', async () => {
            stubFetch(page(503, ''), page(200, CAFE));
            const [paragraph] = await createSite().fetchDOM(
                'https://site.test/',
                'p',
                1,
                'iso-8859-1',
            );
            expect(paragraph.textContent).toBe('café');
        });
    });

    describe('on a server error', () => {
        it('should wait and ask again, as often as it is told to, and hand out the page that works', async () => {
            const fetch = stubFetch(
                page(503, '', { type: 'text/plain' }),
                page(502, '', { type: 'text/plain' }),
                page(200),
            );
            const connector = createSite();
            const found = await connector.fetchDOM('https://site.test/list', 'li.chapter', 2);
            expect(found).toHaveLength(2);
            expect(fetch).toHaveBeenCalledTimes(3);
            expect(connector.wait).toHaveBeenCalledTimes(2);
            // long enough to give the server time, short enough to keep the user waiting
            expect(connector.wait.mock.calls[0][0]).toBeGreaterThanOrEqual(1000);
            expect(connector.wait.mock.calls[0][0]).toBeLessThanOrEqual(10000);
        });

        it('should ask again only after the wait is over', async () => {
            const fetch = stubFetch(page(503, '', { type: 'text/plain' }), page(200));
            const connector = createSite();
            let over = null;
            connector.wait = vi.fn(
                () =>
                    new Promise((resolve) => {
                        over = resolve;
                    }),
            );
            const pending = connector.fetchDOM('https://site.test/list', 'li.chapter', 1);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(fetch).toHaveBeenCalledTimes(1);
            over();
            await expect(pending).resolves.toHaveLength(2);
            expect(fetch).toHaveBeenCalledTimes(2);
        });

        it('should ask for the same page again, and keep the selector', async () => {
            const fetch = stubFetch(page(500, '', { type: 'text/plain' }), page(200));
            const found = await createSite().fetchDOM(
                'https://site.test/list?page=2',
                'li.other',
                1,
            );
            expect(found.map((item) => item.textContent)).toEqual(['Three']);
            expect(fetch.mock.calls.map(([request]) => request.url)).toEqual([
                'https://site.test/list?page=2',
                'https://site.test/list?page=2',
            ]);
        });

        it('should not ask again unless it is told to', async () => {
            const fetch = stubFetch(
                page(503, '', { type: 'text/plain', statusText: 'Service Unavailable' }),
            );
            await expect(createSite().fetchDOM('https://site.test/list', 'li')).rejects.toThrow(
                exactly(
                    'Failed to receive content from "https://site.test/list" (type: text/plain, status: 503) - Service Unavailable',
                ),
            );
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        it('should give up after the last attempt with the status of the last answer', async () => {
            const fetch = stubFetch(
                page(500, '', { type: 'text/plain' }),
                page(503, '', { type: 'text/plain', statusText: 'last' }),
            );
            await expect(createSite().fetchDOM('https://site.test/list', 'li', 1)).rejects.toThrow(
                'status: 503) - last',
            );
            expect(fetch).toHaveBeenCalledTimes(2);
        });

        it('should not ask again when the status is below 500', async () => {
            const fetch = stubFetch(page(404, '', { type: 'text/plain' }), page(200));
            await expect(createSite().fetchDOM('https://site.test/list', 'li', 3)).rejects.toThrow(
                'status: 404',
            );
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        // NOTE: an HTML page that comes with a server error is taken for the page that was asked for once the attempts
        // are used up, so the selector selects nothing instead of the call failing
        it('should take the error page of a server for the page when the attempts are used up', async () => {
            stubFetch(page(503, '<html><body><h1>Service Unavailable</h1></body></html>'));
            await expect(createSite().fetchDOM('https://site.test/list', 'li')).resolves.toEqual(
                [],
            );
        });
    });

    describe('what is not the page', () => {
        it.each([
            ['the check of Cloudflare', 403, { 'cf-mitigated': 'challenge' }],
            ['the check of DDoS-Guard', 403, { server: 'ddos-guard' }],
            [
                'a check of Cloudflare that comes as an error of the server',
                503,
                { server: 'cloudflare' },
            ],
        ])('should fail when the website answers with %s', async (name, status, headers) => {
            stubFetch(page(status, '<html><body>Just a moment...</body></html>', { headers }));
            await expect(
                createSite().fetchDOM('https://site.test/manga/1?x=1', 'li'),
            ).rejects.toThrow(
                exactly(
                    `The anti-bot check of "https://site.test" could not be completed (status: ${status})`,
                ),
            );
        });

        it('should not take an ordinary answer with such a status for a check', async () => {
            stubFetch(page(403, PAGE));
            await expect(
                createSite().fetchDOM('https://site.test/list', 'li.chapter'),
            ).resolves.toHaveLength(2);
        });

        it('should take a page that comes with a status that is not 200 for the page', async () => {
            stubFetch(page(404, PAGE));
            await expect(
                createSite().fetchDOM('https://site.test/list', 'li.chapter'),
            ).resolves.toHaveLength(2);
        });

        it.each([
            ['JSON', 404, 'application/json', 'Not Found'],
            ['text', 500, 'text/plain', 'Server Error'],
            ['an image', 403, 'image/png', 'Forbidden'],
        ])(
            'should fail when the answer is %s and its status is not 200',
            async (name, status, type, statusText) => {
                stubFetch(page(status, '{}', { type, statusText }));
                await expect(createSite().fetchDOM('https://site.test/x', 'li')).rejects.toThrow(
                    exactly(
                        `Failed to receive content from "https://site.test/x" (type: ${type}, status: ${status}) - ${statusText}`,
                    ),
                );
            },
        );

        it('should take any answer with the status 200 for the page', async () => {
            stubFetch(
                page(200, '<ul><li class="chapter">One</li></ul>', {
                    type: 'application/xhtml+xml',
                }),
            );
            await expect(
                createSite().fetchDOM('https://site.test/list', 'li.chapter'),
            ).resolves.toHaveLength(1);
        });

        it('should take an answer with the status 200 that has no type for the page', async () => {
            stubFetch(page(200, PAGE, { type: null }));
            await expect(
                createSite().fetchDOM('https://site.test/list', 'li.chapter'),
            ).resolves.toHaveLength(2);
        });

        it('should fail with the status when the answer has no type and its status is not 200', async () => {
            stubFetch(page(404, '', { type: null, statusText: 'Not Found' }));
            await expect(createSite().fetchDOM('https://site.test/x', 'li')).rejects.toThrow(
                exactly(
                    'Failed to receive content from "https://site.test/x" (type: null, status: 404) - Not Found',
                ),
            );
        });

        it('should fail with the error of the connection', async () => {
            vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
            await expect(createSite().fetchDOM('https://site.test/list', 'li')).rejects.toThrow(
                'fetch failed',
            );
        });
    });
});

describe('cfMailDecrypt', () => {
    // Cloudflare hides an address like this: the first byte is the key, every following byte is a byte of the
    // address xor the key, all as hex
    function hide(address, key) {
        return [key, ...new TextEncoder().encode(address).map((byte) => byte ^ key)]
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
    }

    const span = (hidden) =>
        `<span class="__cf_email__" data-cfemail="${hidden}">[email&#160;protected]</span>`;

    it.each([['a@b.co', '107150723e737f']])('should read %s from %s', (address, hidden) => {
        const holder = element(span(hidden));
        createSite().cfMailDecrypt(holder);
        expect(holder.textContent).toBe(address);
    });

    it.each([
        ['an address', 'someone@example.org', 0x54],
        ['an address with unusual characters', 'first.last+tag@sub-domain.example.org', 0x7f],
        ['an address that needs more than one byte per character', 'jürgen@example.org', 0x2a],
        ['an address of a language with its own script', '漫画@例え.jp', 0x13],
        ['an address with a key that changes nothing', 'plain@example.org', 0x00],
        ['an address with the highest key', 'high@example.org', 0xff],
        ['an address with a key that has a single digit', 'low@example.org', 0x0a],
        ['a character that needs a leading zero in hex', 'a\u0001b@example.org', 0x42],
    ])('should read %s', (name, address, key) => {
        const holder = element(`<p>Mail ${span(hide(address, key))} now</p>`);
        createSite().cfMailDecrypt(holder);
        expect(holder.textContent).toBe(`Mail ${address} now`);
        expect(holder.querySelector('span')).toBeNull();
    });

    it('should read every address of the page, wherever it is', () => {
        const holder = element(
            `<div><p>${span(hide('one@example.org', 0x21))}</p><a href="/cdn-cgi/l/email-protection#x">${span(hide('two@example.org', 0x42))}</a>${span(hide('three@example.org', 0x63))}</div>`,
        );
        createSite().cfMailDecrypt(holder);
        expect(holder.querySelectorAll('span')).toHaveLength(0);
        expect(holder.querySelector('p').textContent).toBe('one@example.org');
        expect(holder.querySelector('a').textContent).toBe('two@example.org');
        expect(holder.textContent).toBe('one@example.orgtwo@example.orgthree@example.org');
    });

    it('should leave the spans that hide nothing alone', () => {
        const holder = element(
            '<span data-cfemail="">empty</span><span>plain</span><span class="x" data-other="1">other</span>',
        );
        createSite().cfMailDecrypt(holder);
        expect(holder.innerHTML).toBe(
            '<span data-cfemail="">empty</span><span>plain</span><span class="x" data-other="1">other</span>',
        );
    });

    it('should leave an element without addresses alone', () => {
        const holder = element('<p>Nothing <b>to</b> see</p>');
        createSite().cfMailDecrypt(holder);
        expect(holder.innerHTML).toBe('<p>Nothing <b>to</b> see</p>');
    });
});

describe('adLinkDecrypt', () => {
    function link(address) {
        const anchor = document.createElement('a');
        anchor.setAttribute('href', address);
        return anchor;
    }

    it('should replace the link to a protected link of nofil.net by the link behind it', () => {
        const anchor = link(
            'https://nofil.net/safeme/abc?url=' +
                encodeURIComponent('https://target.test/manga/1?page=2&x=y'),
        );
        createSite().adLinkDecrypt(anchor);
        expect(anchor.getAttribute('href')).toBe('https://target.test/manga/1?page=2&x=y');
    });

    it.each([
        [
            'a link of nofil.net that is not protected',
            'https://nofil.net/other/abc?url=https://target.test/',
        ],
        [
            'a protected link of another website',
            'https://other.test/safeme/abc?url=https://target.test/',
        ],
        [
            'a link to a subdomain of nofil.net',
            'https://www.nofil.net/safeme/abc?url=https://target.test/',
        ],
        ['an ordinary link', 'https://site.test/manga/1'],
    ])('should leave %s alone', (name, address) => {
        const anchor = link(address);
        createSite().adLinkDecrypt(anchor);
        expect(anchor.getAttribute('href')).toBe(address);
    });

    it('should leave a protected link alone when there is no link behind it', () => {
        const anchor = link('https://nofil.net/safeme/abc');
        createSite().adLinkDecrypt(anchor);
        expect(anchor.getAttribute('href')).toBe('https://nofil.net/safeme/abc');
    });
});

describe('the links of elements', () => {
    const BASE = 'https://site.test/manga/one/';

    function elementWith(tag, attributes) {
        const item = document.createElement(tag);
        for (const [name, value] of Object.entries(attributes)) {
            item.setAttribute(name, value);
        }
        return item;
    }

    it.each([
        ['an image', 'img', 'src', '/images/1.png', 'https://site.test/images/1.png'],
        ['a source', 'source', 'src', '1.webp', 'https://site.test/manga/one/1.webp'],
        ['a script', 'script', 'src', '../app.js', 'https://site.test/manga/app.js'],
        ['an iframe', 'iframe', 'src', '//player.test/embed/1', 'https://player.test/embed/1'],
        [
            'a link',
            'a',
            'href',
            '/chapter/2?lang=en#top',
            'https://site.test/chapter/2?lang=en#top',
        ],
        ['a stylesheet', 'link', 'href', 'style.css', 'https://site.test/manga/one/style.css'],
    ])(
        'should resolve the address of %s against the base, whatever the page is called',
        (name, tag, attribute, value, expected) => {
            const item = elementWith(tag, { [attribute]: value });
            expect(createSite().getAbsolutePath(item, BASE)).toBe(expected);
            expect(createSite().getAbsolutePath(item, new URL(BASE))).toBe(expected);
        },
    );

    it('should prefer the source of an element to its link', () => {
        const item = elementWith('img', { src: '/a.png', href: '/b.png' });
        expect(createSite().getAbsolutePath(item, BASE)).toBe('https://site.test/a.png');
    });

    it('should refuse an element that has no address', () => {
        expect(() => createSite().getAbsolutePath(elementWith('div', { id: 'x' }), BASE)).toThrow(
            exactly('Failed to extract relative link (parameter "reference" is invalid)!'),
        );
    });

    it.each([
        ['a path', '/manga/1?x=1#f', '/manga/1?x=1#f'],
        ['a name', 'chapter-2', '/manga/one/chapter-2'],
        ['an address on the website', 'https://site.test/manga/2', '/manga/2'],
        [
            'an address on another website',
            'https://other.test/manga/2',
            'https://other.test/manga/2',
        ],
    ])(
        'should be the root relative link, or the address of another website, for %s',
        (name, value, expected) => {
            expect(
                createSite().getRootRelativeOrAbsoluteLink(elementWith('a', { href: value }), BASE),
            ).toBe(expected);
        },
    );

    describe('getRelativeLink', () => {
        // the links of a DOM that was made in the page are expanded with the address of the page (see createDOM); this
        // page is not served by the website, and not through its scheme
        beforeEach(() => {
            window.happyDOM.setURL('http://app.test/index.html');
        });

        function anchor(href) {
            const item = document.createElement('a');
            item.setAttribute('href', href);
            return item;
        }

        it.each([
            ['a path', '/sub/page.html?a=1#f', '/sub/page.html?a=1#f'],
            ['a name', 'page.html', '/page.html'],
            ['an address on the website', 'https://site.test/sub/page.html', '/sub/page.html'],
            [
                'an address on the website with the scheme of the page',
                'http://site.test/sub/page.html',
                '/sub/page.html',
            ],
            [
                'an address on another website',
                'https://other.test/sub/page.html',
                'https://other.test/sub/page.html',
            ],
            [
                'an address without a scheme on the website',
                '//site.test/sub/page.html',
                '/sub/page.html',
            ],
        ])('should be the link to %s as the website wrote it', (name, href, expected) => {
            expect(createSite().getRelativeLink(anchor(href))).toBe(expected);
        });

        it('should take the source of an element that has no link', () => {
            const image = document.createElement('img');
            image.setAttribute('src', '/images/1.png');
            expect(createSite().getRelativeLink(image)).toBe('/images/1.png');
        });

        it('should be nothing for an element without a link', () => {
            expect(createSite().getRelativeLink(document.createElement('div'))).toBeUndefined();
        });

        it('should not change the scheme that a link has been given on purpose', () => {
            const connector = createSite();
            connector.url = 'http://site.test';
            expect(connector.getRelativeLink(anchor('https://other.test/sub/page.html'))).toBe(
                'https://other.test/sub/page.html',
            );
            expect(connector.getRelativeLink(anchor('https://site.test/sub/page.html'))).toBe(
                '/sub/page.html',
            );
        });

        it('should give the address of another website the scheme of the website of the connector', () => {
            // an address without a scheme gets the scheme of the page, which is not the one of the website
            const external = anchor('//other.test/sub/page.html');
            expect(createSite().getRelativeLink(external)).toBe('https://other.test/sub/page.html');
        });

        it('should give the address of another website the scheme of the website when the page has its own scheme', () => {
            vi.stubGlobal('window', {
                location: { origin: 'hakuneko://cache', protocol: 'hakuneko:' },
            });
            const external = { href: 'hakuneko://other.test/sub/page.html' };
            expect(createSite().getRelativeLink(external)).toBe('https://other.test/sub/page.html');
        });
    });
});

// The helpers that connectors fetch their content with: JSON, GraphQL, regular expressions and protocol buffers (what
// they send, what they make of the answers, the retries and the errors), the initialization of a connector through a
// fetch window and the images that are served through connector:// addresses. The ones that need a DOM are covered by
// ConnectorDOM.test.js and the counting of the requests of an update by ConnectorProgress.test.js.
const protobufjs = require('protobufjs');
const { exactly } = require('./support/coreFakes.js');

let Connector = null;

beforeAll(async () => {
    Connector = (await import('../mjs/engine/Connector.mjs')).default;
});

afterEach(() => {
    delete globalThis.protobuf;
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

// The answers of the website: the body is read once, so every answer is made when it is asked for
function answer(status, body = '', { type, statusText } = {}) {
    // a response with these statuses has no body
    const empty = [204, 205, 304].includes(status);
    return () => new Response(empty ? null : body, { status, statusText, headers: type ? { 'content-type': type } : {} });
}

function json(value, status = 200) {
    return answer(status, JSON.stringify(value), { type: 'application/json' });
}

// fetch() of the page: the answers are handed out in turn, the last one stays
function stubFetch(...answers) {
    const fetch = vi.fn(async () => (answers.length > 1 ? answers.shift() : answers[0])());
    vi.stubGlobal('fetch', fetch);
    return fetch;
}

function sent(fetch, call = 0) {
    return fetch.mock.calls[call][0];
}

describe('fetchJSON', () => {
    it('should hand out the JSON of the answer', async () => {
        stubFetch(json({ mangas: [{ id: 1 }, { id: 2 }], total: 2 }));
        await expect(createSite().fetchJSON('https://site.test/api/mangas')).resolves.toEqual({ mangas: [{ id: 1 }, { id: 2 }], total: 2 });
    });

    it('should send a request with the options of the connector', async () => {
        const fetch = stubFetch(json({}));
        const connector = createSite();
        connector.requestOptions.headers.set('x-referer', 'https://site.test/');
        await connector.fetchJSON('https://site.test/api');
        const request = sent(fetch);
        expect(request).toBeInstanceOf(Request);
        expect(request).toMatchObject({ url: 'https://site.test/api', method: 'GET', mode: 'cors', credentials: 'same-origin', redirect: 'follow' });
        expect(request.headers.get('x-referer')).toBe('https://site.test/');
        expect(request.headers.get('accept')).toContain('text/html');
    });

    it('should send an address like a string', async () => {
        const fetch = stubFetch(json({}));
        await createSite().fetchJSON(new URL('https://site.test/api?page=2'));
        expect(sent(fetch)).toBeInstanceOf(Request);
        expect(sent(fetch).url).toBe('https://site.test/api?page=2');
        expect(sent(fetch).headers.get('accept')).toContain('text/html');
    });

    // a copy of the request is sent, because a request with a body can be sent once and may have to be sent again
    it('should send the request that it is given: its method, address, headers and body', async () => {
        const fetch = stubFetch(json({}));
        const request = new Request('https://site.test/api', { method: 'POST', headers: { authorization: 'Bearer x' }, body: '{"a":1}' });
        await createSite().fetchJSON(request);
        const request_ = sent(fetch);
        expect(request_.method).toBe('POST');
        expect(request_.url).toBe('https://site.test/api');
        expect(request_.headers.get('authorization')).toBe('Bearer x');
        expect(await request_.text()).toBe('{"a":1}');
        // the one that was given is left alone
        expect(request.bodyUsed).toBe(false);
    });

    it.each([ 201, 204, 301, 400, 401, 403, 404, 429, 500, 503 ])('should fail for the status %i, which is not 200', async status => {
        stubFetch(answer(status, '{}', { type: 'application/json', statusText: 'Because' }));
        await expect(createSite().fetchJSON('https://site.test/api')).rejects.toThrow(exactly(`Failed to receive content from "https://site.test/api" (status: ${status}) - Because`));
    });

    it('should fail when the answer is not JSON', async () => {
        stubFetch(answer(200, '<html>Maintenance</html>', { type: 'text/html' }));
        await expect(createSite().fetchJSON('https://site.test/api')).rejects.toBeInstanceOf(SyntaxError);
    });

    it('should fail with the error of the connection', async () => {
        const failure = new TypeError('fetch failed');
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));
        await expect(createSite().fetchJSON('https://site.test/api')).rejects.toBe(failure);
    });

    describe('on a server error', () => {
        it('should not try again unless it is told to', async () => {
            const fetch = stubFetch(answer(503));
            await expect(createSite().fetchJSON('https://site.test/api')).rejects.toThrow('(status: 503)');
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        it('should wait and try again, as often as it is told to, and hand out the answer that works', async () => {
            const fetch = stubFetch(answer(503), answer(500), json({ ok: true }));
            const connector = createSite();
            await expect(connector.fetchJSON('https://site.test/api', 2)).resolves.toEqual({ ok: true });
            expect(fetch).toHaveBeenCalledTimes(3);
            expect(connector.wait).toHaveBeenCalledTimes(2);
            // long enough to give the server time, short enough to keep the user waiting
            expect(connector.wait.mock.calls[0][0]).toBeGreaterThanOrEqual(1000);
            expect(connector.wait.mock.calls[0][0]).toBeLessThanOrEqual(10000);
        });

        it('should give up after the last attempt with the status of the last answer', async () => {
            const fetch = stubFetch(answer(500, '', { statusText: 'first' }), answer(502, '', { statusText: 'second' }), answer(503, '', { statusText: 'third' }));
            await expect(createSite().fetchJSON('https://site.test/api', 2)).rejects.toThrow('(status: 503) - third');
            expect(fetch).toHaveBeenCalledTimes(3);
        });

        it.each([ 400, 403, 404, 429 ])('should not try again when the status is %i', async status => {
            const fetch = stubFetch(answer(status), json({ ok: true }));
            await expect(createSite().fetchJSON('https://site.test/api', 3)).rejects.toThrow(`(status: ${status})`);
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        it('should ask again only after the wait is over', async () => {
            const fetch = stubFetch(answer(503), json({ ok: true }));
            const connector = createSite();
            let over = null;
            connector.wait = vi.fn(() => new Promise(resolve => {
                over = resolve;
            }));
            const pending = connector.fetchJSON('https://site.test/api', 1);
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(fetch).toHaveBeenCalledTimes(1);
            over();
            await expect(pending).resolves.toEqual({ ok: true });
            expect(fetch).toHaveBeenCalledTimes(2);
        });

        it('should send the same request again', async () => {
            const fetch = stubFetch(answer(503), json({}));
            await createSite().fetchJSON('https://site.test/api?x=1', 1);
            expect(sent(fetch, 1).url).toBe('https://site.test/api?x=1');
        });

        it('should try again with a request that has a body', async () => {
            // like the real fetch(), this one uses up the body of the request
            const fetch = vi.fn(async request => {
                await request.text();
                return fetch.mock.calls.length === 1 ? answer(503)() : json({ ok: true })();
            });
            vi.stubGlobal('fetch', fetch);
            const request = new Request('https://site.test/api', { method: 'POST', body: JSON.stringify({ query: 'x' }) });
            await expect(createSite().fetchJSON(request, 1)).resolves.toEqual({ ok: true });
        });
    });
});

describe('fetchGraphQL', () => {
    const OPERATION = ['Mangas', 'query Mangas($page: Int) { mangas(page: $page) { id } }', { page: 2 }];

    it('should post the operation as JSON and hand out the data of the answer', async () => {
        const fetch = stubFetch(json({ data: { mangas: [{ id: 1 }] } }));
        const data = await createSite().fetchGraphQL('https://site.test/graphql', ...OPERATION);
        expect(data).toEqual({ mangas: [{ id: 1 }] });
        const request = sent(fetch);
        expect(request).toMatchObject({ url: 'https://site.test/graphql', method: 'POST', mode: 'cors', credentials: 'same-origin', redirect: 'follow' });
        expect(request.headers.get('content-type')).toBe('application/json');
        await expect(request.json()).resolves.toEqual({ operationName: 'Mangas', query: OPERATION[1], variables: { page: 2 } });
    });

    it('should leave out the variables that are not there', async () => {
        const fetch = stubFetch(json({ data: {} }));
        await createSite().fetchGraphQL('https://site.test/graphql', 'Ping', '{ ping }');
        await expect(sent(fetch).json()).resolves.toEqual({ operationName: 'Ping', query: '{ ping }' });
    });

    it.each([
        [ 'an address', () => new URL('https://site.test/graphql?lang=en') ],
        [ 'a string', () => 'https://site.test/graphql?lang=en' ],
        [ 'a request', () => new Request('https://site.test/graphql?lang=en') ]
    ])('should take %s for the endpoint', async (name, endpoint) => {
        const fetch = stubFetch(json({ data: {} }));
        await createSite().fetchGraphQL(endpoint(), ...OPERATION);
        expect(sent(fetch)).toMatchObject({ url: 'https://site.test/graphql?lang=en', method: 'POST' });
    });

    it('should send the headers of the connector and leave them as they are', async () => {
        const fetch = stubFetch(json({ data: {} }));
        const connector = createSite();
        connector.requestOptions.headers.set('x-referer', 'https://site.test/');
        await connector.fetchGraphQL('https://site.test/graphql', ...OPERATION);
        expect(sent(fetch).headers.get('x-referer')).toBe('https://site.test/');
        expect(sent(fetch).headers.get('accept')).toContain('text/html');
        expect(connector.requestOptions.headers.has('content-type')).toBe(false);
        expect(connector.requestOptions.method).toBe('GET');
    });

    it('should fail with the messages of the errors that the answer reports', async () => {
        stubFetch(json({ data: null, errors: [{ message: 'Not found' }, { message: 'Rate limited' }] }));
        await expect(createSite().fetchGraphQL('https://site.test/graphql', ...OPERATION)).rejects.toThrow(exactly('Site errors: Not found\nRate limited'));
    });

    it('should fail when the answer reports errors beside the data', async () => {
        stubFetch(json({ data: { mangas: [] }, errors: [{ message: 'Partial failure' }] }));
        await expect(createSite().fetchGraphQL('https://site.test/graphql', ...OPERATION)).rejects.toThrow('Partial failure');
    });

    it('should fail when the answer holds no data', async () => {
        stubFetch(json({}));
        await expect(createSite().fetchGraphQL('https://site.test/graphql', ...OPERATION)).rejects.toThrow(/^Site\W*No data available!$/);
    });

    it('should separate the name of the website from the message about the missing data', async () => {
        stubFetch(json({}));
        await expect(createSite().fetchGraphQL('https://site.test/graphql', ...OPERATION)).rejects.toThrow(/^Site\W+No data available!$/);
    });

    it('should fail with the status of the answer that is not 200', async () => {
        stubFetch(answer(502, 'Bad Gateway', { statusText: 'Bad Gateway' }));
        await expect(createSite().fetchGraphQL('https://site.test/graphql', ...OPERATION)).rejects.toThrow(exactly('Failed to receive content from "https://site.test/graphql" (status: 502) - Bad Gateway'));
    });
});

describe('fetchRegex', () => {
    const TEXT = 'chapter-1 chapter-22 other-3 chapter-333';

    it('should collect the first group of every match, in the order of the text', async () => {
        stubFetch(answer(200, TEXT, { type: 'text/plain' }));
        await expect(createSite().fetchRegex('https://site.test/list', /chapter-(\d+)/g)).resolves.toEqual(['1', '22', '333']);
    });

    it('should find nothing when nothing matches', async () => {
        stubFetch(answer(200, TEXT));
        await expect(createSite().fetchRegex('https://site.test/list', /volume-(\d+)/g)).resolves.toEqual([]);
    });

    it('should ask for the request that it is given', async () => {
        const fetch = stubFetch(answer(200, TEXT));
        const request = new Request('https://site.test/list');
        await createSite().fetchRegex(request, /chapter-(\d+)/g);
        expect(sent(fetch)).toBe(request);
    });

    it('should give the same answer when the same pattern is used again', async () => {
        stubFetch(answer(200, TEXT));
        const connector = createSite();
        const pattern = /chapter-(\d+)/g;
        const first = await connector.fetchRegex('https://site.test/list', pattern);
        const second = await connector.fetchRegex('https://site.test/list', pattern);
        expect(second).toEqual(first);
        expect(first).toHaveLength(3);
    });

    it.each([ 'g', 'gi', 'gm', 'gs', 'gu', 'ig', 'mgi' ])('should take a pattern with the flags %s', async flags => {
        stubFetch(answer(200, 'a1 A2'));
        await expect(createSite().fetchRegex('https://site.test/', new RegExp('a(\\d)', flags))).resolves.not.toHaveLength(0);
    });

    it.each([ '', 'i', 'm', 'y', 'iy' ])('should refuse, and send nothing, for a pattern without the global flag (flags: "%s")', async flags => {
        const fetch = stubFetch(answer(200, TEXT));
        await expect(createSite().fetchRegex('https://site.test/list', new RegExp('chapter-(\\d+)', flags))).rejects.toThrow(exactly('The provided RegExp must contain the global "g" modifier!'));
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each([ 'gd', 'dg', 'gv', 'vg' ])('should take a global pattern with the flags %s', async flags => {
        stubFetch(answer(200, TEXT));
        await expect(createSite().fetchRegex('https://site.test/list', new RegExp('chapter-(\\d+)', flags))).resolves.toEqual(['1', '22', '333']);
    });

    it('should end for a pattern that can match nothing', async () => {
        stubFetch(answer(200, 'a1 b2'));
        const pattern = /(\d*)/g;
        const exec = pattern.exec.bind(pattern);
        let attempts = 0;
        pattern.exec = text => {
            if (++attempts > 1000) {
                throw new Error('the loop does not end');
            }
            return exec(text);
        };
        await expect(createSite().fetchRegex('https://site.test/', pattern)).resolves.toBeDefined();
    });
});

describe('fetchPROTO', () => {
    const SCHEMA = 'syntax = "proto3"; package rk; message Manga { string id = 1; string title = 2; repeated uint32 pages = 3; }';

    function library(root) {
        globalThis.protobuf = { load: vi.fn(async () => root) };
        return globalThis.protobuf;
    }

    it('should decode the answer as the message of the root type', async () => {
        const root = protobufjs.parse(SCHEMA).root;
        const lib = library(root);
        const bytes = root.lookupType('rk.Manga').encode({ id: '/manga/1', title: '漫画 🙂', pages: [1, 2, 300] }).finish();
        const fetch = stubFetch(() => new Response(bytes));
        const result = await createSite().fetchPROTO('https://site.test/api', 'https://site.test/types.proto', 'rk.Manga');
        expect(result).toEqual({ id: '/manga/1', title: '漫画 🙂', pages: [1, 2, 300] });
        expect(lib.load).toHaveBeenCalledWith('https://site.test/types.proto');
        expect(sent(fetch)).toBe('https://site.test/api');
    });

    it('should hand the bytes of the answer to the type and the message that it makes to its conversion', async () => {
        const type = { decode: vi.fn(bytes => ({ decodedFrom: bytes })), toObject: vi.fn(message => ({ object: message })) };
        const lookupType = vi.fn(() => type);
        globalThis.protobuf = { load: vi.fn(async () => ({ lookupType })) };
        stubFetch(() => new Response(new Uint8Array([1, 2, 3])));
        const result = await createSite().fetchPROTO('https://site.test/api', 'types.proto', 'pkg.Root');
        expect(lookupType).toHaveBeenCalledWith('pkg.Root');
        expect(type.decode).toHaveBeenCalledTimes(1);
        const bytes = type.decode.mock.calls[0][0];
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(Array.from(bytes)).toEqual([1, 2, 3]);
        expect(type.toObject).toHaveBeenCalledWith({ decodedFrom: bytes });
        expect(result).toEqual({ object: { decodedFrom: bytes } });
    });

    it('should fail when the answer is not a message of the type', async () => {
        const root = protobufjs.parse(SCHEMA).root;
        library(root);
        stubFetch(answer(200, '<html>Maintenance</html>', { type: 'text/html' }));
        await expect(createSite().fetchPROTO('https://site.test/api', 'types.proto', 'rk.Manga')).rejects.toThrow();
    });

    it('should fail, and ask for nothing, when the types cannot be loaded', async () => {
        globalThis.protobuf = { load: vi.fn().mockRejectedValue(new Error('HTTP 404')) };
        const fetch = stubFetch(answer(200));
        await expect(createSite().fetchPROTO('https://site.test/api', 'types.proto', 'rk.Manga')).rejects.toThrow('HTTP 404');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('should fail, and ask for nothing, when the type is not in the types', async () => {
        const root = protobufjs.parse(SCHEMA).root;
        library(root);
        const fetch = stubFetch(answer(200));
        await expect(createSite().fetchPROTO('https://site.test/api', 'types.proto', 'rk.Unknown')).rejects.toThrow();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('should fail, and ask for nothing, when the library cannot be loaded', async () => {
        const scripts = [];
        vi.stubGlobal('document', {
            createElement: () => ({ remove: vi.fn() }),
            head: { append: script => {
                scripts.push(script);
                queueMicrotask(() => script.onerror());
            } }
        });
        const fetch = stubFetch(answer(200));
        await expect(createSite().fetchPROTO('https://site.test/api', 'types.proto', 'rk.Manga')).rejects.toThrow(exactly('Failed to load the protobuf library!'));
        expect(scripts).toHaveLength(1);
        expect(fetch).not.toHaveBeenCalled();
    });
});

describe('the initialization through a fetch window', () => {
    function windows(result = 'loaded') {
        const fetchUI = vi.fn(async () => result);
        vi.stubGlobal('Engine', { Request: { fetchUI } });
        return fetchUI;
    }

    it('should load the home page of the website in a window, with its images, for a minute', async () => {
        const fetchUI = windows('page');
        const result = await createSite()._initializeConnector();
        expect(result).toBe('page');
        expect(fetchUI).toHaveBeenCalledTimes(1);
        const [request, script, timeout, images] = fetchUI.mock.calls[0];
        expect(request).toBeInstanceOf(Request);
        expect(request.url).toBe('https://site.test/');
        expect([script, timeout, images]).toEqual(['', 60000, true]);
    });

    it('should load the page with the options of the connector', async () => {
        const fetchUI = windows();
        const connector = createSite();
        connector.url = 'https://site.test/en/';
        connector.requestOptions.headers.set('x-referer', 'https://site.test/');
        connector.requestOptions.headers.set('x-cookie', 'consent=1');
        await connector._initializeConnector();
        const request = fetchUI.mock.calls[0][0];
        expect(request.url).toBe('https://site.test/en/');
        expect(request.headers.get('x-referer')).toBe('https://site.test/');
        expect(request.headers.get('x-cookie')).toBe('consent=1');
    });

    it('should be done by initialize, once, and be over when it succeeded', async () => {
        const fetchUI = windows();
        const connector = createSite();
        connector.initialized = false;
        await connector.initialize();
        await connector.initialize();
        expect(fetchUI).toHaveBeenCalledTimes(1);
        expect(connector.initialized).toBe(true);
    });

    it('should fail with the error of the window, and be done again the next time', async () => {
        const fetchUI = windows();
        fetchUI.mockRejectedValueOnce(new Error('Failed to load "https://site.test/" within the given timeout of 60 seconds!'));
        const connector = createSite();
        connector.initialized = false;
        await expect(connector.initialize()).rejects.toThrow('within the given timeout of 60 seconds!');
        expect(connector.initialized).toBe(false);
        await connector.initialize();
        expect(fetchUI).toHaveBeenCalledTimes(2);
        expect(connector.initialized).toBe(true);
    });

    it('should fail without a window when the connector has no address', async () => {
        const fetchUI = windows();
        const connector = createSite();
        connector.url = undefined;
        connector.initialized = false;
        await expect(connector.initialize()).rejects.toBeInstanceOf(TypeError);
        expect(fetchUI).not.toHaveBeenCalled();
    });
});

describe('the images behind a connector:// address', () => {
    const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0]);

    it('should be fetched with the options of the connector and served with their type', async () => {
        const fetch = stubFetch(() => new Response(PNG, { headers: { 'content-type': 'image/png' } }));
        const connector = createSite();
        connector.requestOptions.headers.set('x-referer', 'https://site.test/manga/1');
        const image = await connector._handleConnectorURI('https://cdn.test/1.png');
        expect(sent(fetch)).toBeInstanceOf(Request);
        expect(sent(fetch).url).toBe('https://cdn.test/1.png');
        expect(sent(fetch).headers.get('x-referer')).toBe('https://site.test/manga/1');
        expect(image.mimeType).toBe('image/png');
        expect(Array.from(image.data)).toEqual(Array.from(PNG));
    });

    it('should be served with the type that the data has, when the website says another one', async () => {
        stubFetch(() => new Response(PNG, { headers: { 'content-type': 'application/octet-stream' } }));
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const image = await createSite()._handleConnectorURI('https://cdn.test/1.png');
        expect(image.mimeType).toBe('image/png');
        expect(console.warn).toHaveBeenCalledTimes(1);
    });

    it('should be served as it is when the type of the data is not known', async () => {
        stubFetch(() => new Response('plain text', { headers: { 'content-type': 'text/plain' } }));
        const image = await createSite()._handleConnectorURI('https://cdn.test/1.txt');
        expect(image.mimeType).toBe('text/plain');
        expect(new TextDecoder().decode(image.data)).toBe('plain text');
    });

    it('should fail with the error of the connection', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
        await expect(createSite()._handleConnectorURI('https://cdn.test/1.png')).rejects.toThrow('fetch failed');
    });

    it('should be reached through the address that the connector makes', async () => {
        stubFetch(() => new Response(PNG, { headers: { 'content-type': 'image/png' } }));
        const connector = createSite();
        const image = await connector.handleConnectorURI(new URL(connector.createConnectorURI('https://cdn.test/a b.png?token=x&y=1')));
        expect(image.mimeType).toBe('image/png');
        expect(fetch.mock.calls[0][0].url).toBe('https://cdn.test/a%20b.png?token=x&y=1');
    });
});

describe('the requests that are counted for an update', () => {
    it('should not fail for a request that completes after the update is over', async () => {
        let complete = null;
        vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => {
            complete = () => resolve(json({})());
        })));
        const connector = createSite();
        connector.isUpdating = true;
        const pending = connector.fetchJSON('https://site.test/api');
        connector.isUpdating = false;
        complete();
        await expect(pending).resolves.toEqual({});
        expect(connector.updateProgress).toBeUndefined();
    });

    it('should count the requests of the update that is running only, one for each of the connectors', async () => {
        stubFetch(json({}));
        const [first, second] = [createSite(), createSite()];
        first.isUpdating = true;
        second.isUpdating = true;
        await Promise.all([first.fetchJSON('https://site.test/a'), first.fetchJSON('https://site.test/b'), second.fetchJSON('https://site.test/c')]);
        expect(first.updateProgress.requests).toBe(2);
        expect(second.updateProgress.requests).toBe(1);
    });
});

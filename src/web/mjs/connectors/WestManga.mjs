import Connector from '../engine/Connector.mjs';
import Manga from '../engine/Manga.mjs';
import { base64ToBytes } from '../engine/Crypto.mjs';

// The helpers of a script that runs in a page of the website (see `_runInPage`). `api(endpoint, init)` asks the API the
// way the website does: with the visit token that the website gives its pages (header X-WM-Visit, fetched again when the
// API says that it is no longer valid) and the login, if there is one. `image(url)` reads an image as base64. A response
// that is the check of Cloudflare stops the script as `challenged`.
const PAGE_HELPERS = `
    const challenged = (response) => {
        if (response.headers.get('cf-mitigated') === 'challenge') {
            throw Object.assign(new Error('The check of the website has not been passed'), { challenged: true });
        }
    };
    let visit;
    const visitToken = async () => {
        const response = await fetch('/api/visit-token');
        challenged(response);
        const { token } = await response.json();
        return token;
    };
    const api = async (endpoint, init = {}, retries = 2) => {
        visit = visit || (await visitToken());
        const headers = { ...init.headers, 'X-WM-Visit': visit };
        if (authorization) {
            headers.Authorization = authorization;
        }
        const response = await fetch('/api/' + endpoint, { ...init, headers });
        challenged(response);
        // the website limits the requests of a visitor (the list of the comics above all), for up to an hour
        if (response.status === 429) {
            const minutes = Math.ceil(Number(response.headers.get('retry-after')) / 60);
            throw new Error('WestManga limits the requests, try again ' + (minutes > 0 ? 'in ' + minutes + ' minutes' : 'later'));
        }
        const expired = response.headers.has('X-WM-Visit-Error');
        if (retries > 0 && (expired || response.status >= 500)) {
            visit = expired ? undefined : visit;
            await new Promise((resolve) => setTimeout(resolve, 1000));
            return api(endpoint, init, retries - 1);
        }
        const data = await response.json().catch(() => undefined);
        if (!response.ok) {
            const message = data && data.message ? ' - ' + data.message : '';
            throw new Error('Failed to receive content from "' + response.url + '" (status: ' + response.status + ')' + message);
        }
        return data;
    };
    const image = async (url) => {
        const response = await fetch(url);
        challenged(response);
        if (!response.ok) {
            throw new Error('Failed to receive content from "' + url + '" (status: ' + response.status + ')');
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = '';
        for (let index = 0; index < bytes.length; index += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
        }
        return { type: response.headers.get('content-type'), base64: btoa(binary) };
    };
`;

export default class WestManga extends Connector {
    constructor() {
        super();
        super.id = 'westmanga';
        super.label = 'WestManga';
        this.tags = ['manga', 'manhua', 'manhwa', 'indonesian'];
        this.url = 'https://v1.westmanga.my';

        this.config = {
            username: {
                label: 'Email',
                description: 'Email akun WestManga kamu untuk mengakses konten mature.',
                input: 'text',
                value: '',
            },
            password: {
                label: 'Password',
                description: 'Password akun WestManga kamu.',
                input: 'password',
                value: '',
            },
        };

        this.token = undefined;
        this._credentials = undefined;

        // Memicu proses login saat HakuNeko dimuat atau saat pengaturan disimpan
        Engine.Settings.addEventListener('loaded', this._onSettingsChanged.bind(this));
        Engine.Settings.addEventListener('saved', this._onSettingsChanged.bind(this));
    }

    canHandleURI(uri) {
        return /^https?:\/\/v1\.westmanga\.(my|top|cc)$/.test(uri.origin);
    }

    async _getMangas() {
        // the API gives 25 titles a page: all pages are asked for in one window
        const comics = await this._runInPage(
            `const comics = [];
            for (let page = 1; ; page++) {
                const { data, paginator } = await api('contents?page=' + page + '&per_page=25&type=Comic');
                if (!data || !data.length) {
                    break;
                }
                comics.push(...data.map(({ slug, title }) => ({ slug, title })));
                if (!paginator || paginator.current_page >= paginator.last_page) {
                    break;
                }
            }
            return comics;`,
            15 * 60 * 1000,
        );
        return comics.map(({ slug, title }) => ({
            id: slug,
            title: title.replace(/bahasa indonesia/i, '').trim(),
        }));
    }

    async _getChapters(manga) {
        const {
            data: { chapters },
        } = await this.fetchAPI(`comic/${manga.id}`);
        return chapters.map(({ slug, number }) => {
            let title = number.toString().trim();
            if (!/^chapter\s+/i.test(title)) {
                title = `Chapter ${title}`;
            }
            return {
                id: slug,
                title: title,
            };
        });
    }

    async _getPages(chapter) {
        const {
            data: { images },
        } = await this.fetchAPI(`v/${chapter.id}`);
        // a link that is not absolute is on the host of the website, and only its pages get the image
        return images.map((image) => this.createConnectorURI(new URL(image, this.url).href));
    }

    async _handleConnectorURI(payload) {
        const { type, base64 } = await this._runInPage(`return image(${JSON.stringify(payload)});`);
        const data = { mimeType: type, data: base64ToBytes(base64) };
        this._applyRealMime(data);
        return data;
    }

    async _getMangaFromURI(uri) {
        const slug = uri.pathname.split('/').filter(Boolean).pop();
        const {
            data: { title },
        } = await this.fetchAPI(`comic/${slug}`);
        return new Manga(this, slug, title.replace(/bahasa indonesia/i, '').trim());
    }

    _onSettingsChanged() {
        let user = this.config.username.value;
        let pass = this.config.password.value;
        let credentials = user + pass;

        // Hanya proses login jika ada perubahan pada email/password
        if (this._credentials !== credentials) {
            this._credentials = credentials;
            this._login(user, pass)
                .then(() => {
                    if (this.token) console.log(this.label + ' login berhasil!');
                })
                .catch((error) => {
                    console.warn(this.label + ' login gagal!', error);
                });
        }
    }

    async _login(username, password) {
        // Reset token saat ini
        this.token = undefined;

        // Abaikan jika form kosong (Guest Mode)
        if (
            typeof username !== 'string' ||
            username === '' ||
            typeof password !== 'string' ||
            password === ''
        ) {
            return Promise.resolve();
        }

        const body = JSON.stringify({ email: username, password: password });
        const data = await this._runInPage(
            `return api('auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: ${JSON.stringify(body)},
            });`,
        );

        if (data && data.access_token) {
            this.token = data.access_token;
        } else if (data && data.data && data.data.access_token) {
            this.token = data.data.access_token;
        } else {
            throw new Error('Kredensial tidak valid atau struktur response berubah.');
        }
    }

    async fetchAPI(endpoint) {
        return this._runInPage(`return api(${JSON.stringify(endpoint)});`);
    }

    /**
     * The API and the images of the website answer its own pages only, so `body` runs in a page of the website: a light
     * one (robots.txt) in a hidden window, with the helpers of PAGE_HELPERS. Its result is returned. When the check of the
     * website (Cloudflare) has not been passed yet, it is passed on the home page first, which needs the images for it.
     */
    async _runInPage(body, timeout) {
        const script = `(async () => {
            const authorization = ${JSON.stringify(this.token ? 'Bearer ' + this.token : null)};
            ${PAGE_HELPERS}
            try {
                return { result: await (async () => { ${body} })() };
            } catch (error) {
                return { error: error.message, challenged: error.challenged === true };
            }
        })()`;
        const run = () =>
            Engine.Request.fetchUI(
                new Request(new URL('/robots.txt', this.url), this.requestOptions),
                script,
                timeout,
            );
        let answer = await run();
        if (answer.challenged) {
            await Engine.Request.fetchUI(
                new Request(new URL('/', this.url), this.requestOptions),
                'true',
                Engine.Request.challengeTimeout,
                true,
            );
            answer = await run();
        }
        if (answer.error) {
            throw new Error(answer.error);
        }
        return answer.result;
    }
}

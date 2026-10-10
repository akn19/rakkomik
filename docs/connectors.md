# Adding a website

A website is one module in `src/web/mjs/connectors/`. The engine lists that folder at runtime, imports every
`*.mjs` file and registers the default export; no list has to be edited.

```js
import Connector from '../engine/Connector.mjs';
import Manga from '../engine/Manga.mjs';

export default class Example extends Connector {

    constructor() {
        super();
        super.id = 'example';          // unique; also the name of the icon file
        super.label = 'Example';
        this.tags = [ 'manga', 'english' ];
        this.url = 'https://example.org';
    }

    async _getMangas() {
        // the manga list: [ { id, title }, ... ]
    }

    async _getChapters(manga) {
        // the chapters of `manga` (`manga.id` tells which): [ { id, title }, ... ]
    }

    async _getPages(chapter) {
        // the image links of `chapter`: [ 'https://...', ... ]
    }

    async _getMangaFromURI(uri) {
        // a manga from a link (the paste feature): return new Manga(this, id, title);
    }
}
```

`_getMangas`, `_getChapters` and `_getPages` are required, `_getMangaFromURI` makes links work. A website that
cannot list its manga (too large, or no list at all) implements only `_getMangaFromURI`; the user then pastes links.

## Helpers of the base class

| Helper | Use |
|---|---|
| `fetchDOM(request, selector)` | the elements of an HTML page that match a CSS selector |
| `fetchJSON(request)` | a JSON response |
| `fetchRegex(request, regex)` | the matches of a regular expression in the response text |
| `fetchGraphQL(request, operationName, query, variables)` | a GraphQL operation |
| `fetchPROTO(request, protoTypes, rootType)` | a Protocol Buffers response |
| `getAbsolutePath(reference, base)` | resolve a link against a base |
| `wait(ms)` | pause between requests of a site that limits the rate |

Create requests with `new Request(url, this.requestOptions)`; the options carry the credentials and the default
headers. The `x-` headers (`x-referer`, `x-origin`, `x-cookie`, `x-user-agent`, ...) are turned into real headers by
the main process, see [architecture](architecture.md#requests-and-interstitials). Interstitials are handled below
`fetch()`; a connector does not deal with them.

## Images that need more than a link

When an image needs a special request (headers, a token, decryption), return a `connector://` link instead:
`this.createConnectorURI(payload)` encodes the payload, and the engine calls `_handleConnectorURI(payload)` of the
connector to produce the image data when the link is requested. Override `_handleConnectorURI` to do the request.

## Settings of a connector

`this.config` declares settings that appear in the settings of the application, for example a login:

```js
this.config = {
    username: { label: 'Email', description: 'Email of your account', input: 'text', value: '' },
    password: { label: 'Password', description: 'Password of your account', input: 'password', value: '' }
};
```

`_onSettingsChanged()` runs when the user saved them.

## Families of websites

Many websites run the same software. `connectors/templates/` holds a base class per family (for example
`FoolSlide`, `HeanCms`, `WordPressMadara`); a connector of such a site extends the template and sets only what differs
(`id`, `label`, `url`, `tags`). Look at a connector that extends the template you need.

## Icon

The icon of a connector is the file `src/web/img/connectors/<id>`: named exactly like the ID and without an
extension (the file system of Linux is case sensitive). The user interface falls back to `img/connectors/default`.

## Your own connectors

Without touching the sources, put the module in `rakkomik.plugins` inside the user data folder (see
[data locations](../README.md#data-locations)). It is loaded before the bundled connectors.

## Testing

- `pnpm run test:e2e:sites` checks every connector listed in `src/__tests__/Connectors.e2e.mjs` against its real
  website: the manga from a link, its first or last chapter and the pages. An entry names the connector, a manga
  link, which chapter to take and what to expect (class names, IDs, titles, page count, a pattern for the links).
  It needs network access, and websites change, so expectations may need updating.
- Add an entry for the website you add. Run one site with
  `pnpm run build:web && pnpm exec playwright test --project=sites -g "Example"`.
- The browser developer tools (`F12`) show the requests of the page while you develop.

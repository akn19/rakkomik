// The colours of the themes (index.css) meet WCAG 2.2 AA: 4.5:1 for text, 3:1 for icons, focus rings and the other
// parts of controls, each against the background that it is drawn on. The pairs below are the ones the interface draws.
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.join(import.meta.dirname, '..', 'index.css'), 'utf8');

// the tokens of a theme: `--name: value;` inside its block
function tokensOf(selector) {
    const block = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(css);
    if (!block) {
        throw new Error(`no block for ${selector}`);
    }
    const tokens = {};
    for (const match of block[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) {
        tokens[match[1]] = match[2].trim();
    }
    return tokens;
}

const LIGHT = tokensOf(':root');
const DARK = { ...LIGHT, ...tokensOf('\\.dark') };

function parse(color) {
    let match = /^#([0-9a-f]{6})$/i.exec(color);
    if (match) {
        const number = parseInt(match[1], 16);
        return [number >> 16, (number >> 8) & 255, number & 255, 1];
    }
    match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
        color,
    );
    if (match) {
        return [
            Number(match[1]),
            Number(match[2]),
            Number(match[3]),
            match[4] === undefined ? 1 : Number(match[4]),
        ];
    }
    throw new Error(`cannot read the colour ${color}`);
}

// a colour with an alpha, as it looks on a backdrop
function blend(color, backdrop) {
    const [r, g, b, a] = parse(color);
    const [br, bg, bb] = parse(backdrop);
    return `rgb(${r * a + br * (1 - a)}, ${g * a + bg * (1 - a)}, ${b * a + bb * (1 - a)})`;
}

function luminance(color) {
    const channel = (value) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const [r, g, b] = parse(color);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The contrast ratio of WCAG 2 (1.4.3, 1.4.11), the background first blended on the backdrop under it, the foreground on that. */
export function contrast(foreground, background, backdrop = '#ffffff') {
    const bg = blend(background, backdrop);
    const fg = blend(foreground, bg);
    const [light, dark] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
    return (light + 0.05) / (dark + 0.05);
}

const TEXT = 4.5;
const GRAPHIC = 3;

// what, foreground token, background token, minimum, backdrop token (for a translucent background)
const PAIRS = [
    ['text on the panels', 'text-color', 'control-background-color', TEXT],
    ['text on the menu', 'text-color', 'menu-control-background-color', TEXT],
    ['text in the lists', 'text-color', 'list-background-color', TEXT],
    ['text on a selected row', 'text-color', 'list-selected', TEXT, 'list-background-color'],
    ['text on the page', 'text-color', 'page-control-background-color', TEXT],
    ['text on the credits card', 'text-color', 'menu-credits-background-color', TEXT],
    ['text in the settings', 'text-color', 'menu-settings-background-color', TEXT],
    ['the title of the menu', 'menu-control-title-color', 'menu-control-background-color', TEXT],
    [
        'the categories of the menu',
        'menu-control-category-color',
        'menu-control-background-color',
        TEXT,
    ],
    [
        'the categories of the settings',
        'menu-control-category-color',
        'menu-settings-background-color',
        TEXT,
    ],
    [
        'the categories of the connector dialog',
        'connector-dialog-category-color',
        'connector-dialog-background-color',
        TEXT,
    ],
    ['the links of the credits', 'menu-credits-link-color', 'menu-credits-background-color', TEXT],
    ['the text buttons of the menu', 'button-color', 'menu-control-background-color', TEXT],
    ['the buttons on the panels', 'button-color', 'control-background-color', GRAPHIC],
    ['the buttons in the lists', 'button-color', 'list-background-color', GRAPHIC],
    [
        'the buttons of the connector cards',
        'button-color',
        'connector-card-background-color',
        GRAPHIC,
    ],
    [
        'the buttons of the selected connector card',
        'button-color',
        'connector-card-selected',
        GRAPHIC,
    ],
    ['the icons on the panels', 'icon-color', 'control-background-color', GRAPHIC],
    ['the icons in the settings', 'icon-color', 'menu-settings-background-color', GRAPHIC],
    ['the icons in the lists', 'icon-color', 'list-background-color', GRAPHIC],
    ['the focus ring on the panels', 'focus-ring-color', 'control-background-color', GRAPHIC],
    ['the focus ring in the lists', 'focus-ring-color', 'list-background-color', GRAPHIC],
    ['the focus ring on the page', 'focus-ring-color', 'page-control-background-color', GRAPHIC],
    [
        'the focus ring in the settings',
        'focus-ring-color',
        'menu-settings-background-color',
        GRAPHIC,
    ],
    [
        'the focus ring on the connector cards',
        'focus-ring-color',
        'connector-card-background-color',
        GRAPHIC,
    ],
    [
        'the focus ring on a selected row',
        'focus-ring-color',
        'list-selected',
        GRAPHIC,
        'list-background-color',
    ],
    [
        'the mark of a selected row',
        'list-marker-color',
        'list-selected',
        GRAPHIC,
        'list-background-color',
    ],
    [
        'the mark of a selected row against the list',
        'list-marker-color',
        'list-background-color',
        GRAPHIC,
    ],
    [
        'the ring of the selected connector card',
        'list-marker-color',
        'connector-card-selected',
        GRAPHIC,
    ],
    ['the ring of a selected tag', 'list-marker-color', 'connector-tag-selected', GRAPHIC],
    [
        'the title of a bookmarked manga',
        'manga-list-bookmarked-color',
        'list-background-color',
        TEXT,
    ],
    [
        'the title of a bookmarked manga that is selected',
        'manga-list-bookmarked-color',
        'list-selected',
        TEXT,
        'list-background-color',
    ],
    ['the refresh button', 'manga-refresh-button-color', 'control-background-color', GRAPHIC],
    [
        'the refresh button in the notification',
        'manga-refresh-button-color',
        'manga-list-notification-color',
        GRAPHIC,
    ],
    [
        'the sweeping progress bar',
        'manga-refresh-button-color',
        'job-list-progress-background-color',
        GRAPHIC,
        'control-background-color',
    ],
    ['the text of the notification', 'text-color', 'manga-list-notification-color', TEXT],
    ['the bookmark star', 'bookmark-button-default-color', 'control-background-color', GRAPHIC],
    [
        'the badge that adds a bookmark',
        'bookmark-button-add-color',
        'control-background-color',
        GRAPHIC,
    ],
    [
        'the badge that removes a bookmark',
        'bookmark-button-delete-color',
        'control-background-color',
        GRAPHIC,
    ],
    [
        'the icon of an offline chapter',
        'chapter-button-offline-color',
        'list-background-color',
        GRAPHIC,
    ],
    [
        'the icon of an available chapter',
        'chapter-button-available-color',
        'list-background-color',
        GRAPHIC,
    ],
    [
        'the icon of a queued chapter',
        'chapter-button-queued-color',
        'list-background-color',
        GRAPHIC,
    ],
    [
        'the icon of a downloading chapter',
        'chapter-button-downloading-color',
        'list-background-color',
        GRAPHIC,
    ],
    [
        'the icon of a downloaded chapter',
        'chapter-button-completed-color',
        'list-background-color',
        GRAPHIC,
    ],
    [
        'the icon of a failed chapter',
        'chapter-button-failed-color',
        'list-background-color',
        GRAPHIC,
    ],
    [
        'the icon of an available chapter that is open',
        'chapter-button-available-color',
        'list-selected',
        GRAPHIC,
        'list-background-color',
    ],
    [
        'the icon of a queued chapter that is open',
        'chapter-button-queued-color',
        'list-selected',
        GRAPHIC,
        'list-background-color',
    ],
    [
        'the icon of a downloading chapter that is open',
        'chapter-button-downloading-color',
        'list-selected',
        GRAPHIC,
        'list-background-color',
    ],
    [
        'the preview button of a chapter that is open',
        'button-color',
        'list-selected',
        GRAPHIC,
        'list-background-color',
    ],
    [
        'the marker of the chapter that was read, when it is open',
        'chapter-marker-active-color',
        'list-selected',
        GRAPHIC,
        'list-background-color',
    ],
    [
        'the marker of another chapter that is open',
        'chapter-marker-inactive-color',
        'list-selected',
        GRAPHIC,
        'list-background-color',
    ],
    [
        'the icon of a downloaded chapter that is open',
        'chapter-button-completed-color',
        'list-selected',
        GRAPHIC,
        'list-background-color',
    ],
    [
        'the icon of a failed chapter that is open',
        'chapter-button-failed-color',
        'list-selected',
        GRAPHIC,
        'list-background-color',
    ],
    [
        'the icon of an offline chapter that is open',
        'chapter-button-offline-color',
        'list-selected',
        GRAPHIC,
        'list-background-color',
    ],
    [
        'the marker of the chapter that was read',
        'chapter-marker-active-color',
        'list-background-color',
        GRAPHIC,
    ],
    [
        'the marker of the other chapters',
        'chapter-marker-inactive-color',
        'list-background-color',
        GRAPHIC,
    ],
    [
        'the marker of a chapter that is gone',
        'chapter-marker-removed-color',
        'list-background-color',
        TEXT,
    ],
    [
        'the title of an unavailable chapter',
        'status-unavailable-color',
        'list-background-color',
        TEXT,
    ],
    ['the title of an available chapter', 'status-available-color', 'list-background-color', TEXT],
    ['the title of a queued chapter', 'status-queued-color', 'list-background-color', TEXT],
    [
        'the title of a downloading chapter',
        'status-downloading-color',
        'list-background-color',
        TEXT,
    ],
    ['the title of a downloaded chapter', 'status-completed-color', 'list-background-color', TEXT],
    [
        'the title of an unavailable chapter that is open',
        'status-unavailable-color',
        'list-selected',
        TEXT,
        'list-background-color',
    ],
    [
        'the title of an available chapter that is open',
        'status-available-color',
        'list-selected',
        TEXT,
        'list-background-color',
    ],
    [
        'the title of a queued chapter that is open',
        'status-queued-color',
        'list-selected',
        TEXT,
        'list-background-color',
    ],
    [
        'the title of a downloading chapter that is open',
        'status-downloading-color',
        'list-selected',
        TEXT,
        'list-background-color',
    ],
    [
        'the title of a downloaded chapter that is open',
        'status-completed-color',
        'list-selected',
        TEXT,
        'list-background-color',
    ],
    [
        'the status icon of a queued job',
        'job-list-button-queued-color',
        'job-list-background-color',
        GRAPHIC,
    ],
    [
        'the status icon of a downloading job',
        'job-list-button-downloading-color',
        'job-list-background-color',
        GRAPHIC,
    ],
    [
        'the status icon of a completed job',
        'job-list-button-completed-color',
        'job-list-background-color',
        GRAPHIC,
    ],
    [
        'the status icon of a failed job',
        'job-list-button-failed-color',
        'job-list-background-color',
        GRAPHIC,
    ],
    [
        'the progress of a job',
        'job-list-progress-color',
        'job-list-progress-background-color',
        GRAPHIC,
        'job-list-background-color',
    ],
    ['the text of the job list', 'text-color', 'job-list-background-color', TEXT],
    ['the tags of a connector', 'connector-tag-color', 'connector-tag-background-color', TEXT],
    ['a selected tag', 'connector-tag-color', 'connector-tag-selected', TEXT],
    [
        'the message of an update on a card',
        'connector-tag-color',
        'connector-card-background-color',
        TEXT,
    ],
    [
        'the button that resets the filters',
        'connector-button-clear-color',
        'connector-dialog-background-color',
        GRAPHIC,
    ],
    ['text on a connector card', 'text-color', 'connector-card-background-color', TEXT],
    ['text on the selected connector card', 'text-color', 'connector-card-selected', TEXT],
    [
        'the title of the chapter in the reader',
        'page-chapter-title-color',
        'page-viewer-title-background-color',
        TEXT,
        'page-reader-background-color',
    ],
    ['the text of a field', 'input-color', 'input-background-color', TEXT],
    [
        'the text of a field that cannot be typed in',
        'input-disabled-color',
        'input-disabled-background-color',
        TEXT,
    ],
    ['the underline of a field', 'input-accent-color', 'control-background-color', GRAPHIC],
    ['the text of the start page cards', 'text-color', 'start-card-background-color', TEXT],
].map(([what, foreground, background, minimum, backdrop]) => ({
    what,
    foreground,
    background,
    minimum,
    backdrop,
}));

describe.each([
    ['light', LIGHT],
    ['dark', DARK],
])('the colours of the %s theme', (name, tokens) => {
    it.each(PAIRS)(
        'should give $what a contrast of at least $minimum',
        ({ foreground, background, minimum, backdrop }) => {
            expect(tokens[foreground], foreground).toBeDefined();
            expect(tokens[background], background).toBeDefined();
            const ratio = contrast(
                tokens[foreground],
                tokens[background],
                backdrop ? tokens[backdrop] : '#ffffff',
            );
            expect(ratio, `${tokens[foreground]} on ${tokens[background]}`).toBeGreaterThanOrEqual(
                minimum,
            );
        },
    );
});

describe('the contrast ratio', () => {
    it('should be 21 between black and white, and 1 between a colour and itself', () => {
        expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
        expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
        expect(contrast('#808080', '#808080')).toBe(1);
    });

    it('should blend a translucent background on its backdrop first', () => {
        // half-transparent black on white is a mid grey
        expect(contrast('#ffffff', 'rgba(0, 0, 0, 0.5)', '#ffffff')).toBeCloseTo(
            contrast('#ffffff', 'rgb(127.5, 127.5, 127.5)'),
            5,
        );
    });

    it('should refuse a colour that it cannot read', () => {
        expect(() => contrast('red', '#ffffff')).toThrow('cannot read the colour red');
    });
});

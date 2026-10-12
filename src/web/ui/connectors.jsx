import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { openExternalLink, findConnectorsByManga } from './engine.js';
import { useConnectors } from './connectorsState.js';
import { updateMangaList } from './queries.js';
import { useUpdateProgress, updateMessage, countTitles } from './updateProgress.js';
import { useToast } from './notify.jsx';
import { useDialog } from './dialog.jsx';
import Icon from './icon.jsx';

const CARD_MIN_WIDTH = 400;
const ROW_HEIGHT = 96;

// the heading of a part of the dialog; with `htmlFor` it is the label of the field under it
function Separator({ icon, label, htmlFor, id, children }) {
    return (
        <div className="rk-separator flex items-center gap-[0.25em] pt-[0.5em] pb-[0.25em] pl-[0.5em] font-bold uppercase text-(--connector-dialog-category-color)">
            {children}
            {icon && <Icon name={icon} size={14} />}
            {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <h2 id={id}>{label}</h2>}
        </div>
    );
}

function CardButton({ icon, title, label, enabled, busy, onClick }) {
    return (
        <button
            type="button"
            title={title}
            aria-label={label}
            disabled={!enabled}
            onClick={(event) => {
                event.stopPropagation();
                onClick();
            }}
            className="rk-button disabled:cursor-not-allowed disabled:opacity-25"
        >
            <Icon name={icon} size={16} spin={busy} />
        </button>
    );
}

/**
 * A website. The whole card takes a click; the keyboard selects with the button that carries the name, the other
 * buttons of the card open its pages and update its list.
 */
function Card({ connector, selected, updating, onSelect, onUpdate }) {
    const links = connector.links || {};
    const progress = useUpdateProgress(connector);
    // the engine knows about updates that were started from the main window as well
    const running = updating || !!progress;
    const select = (event) => {
        event.stopPropagation();
        onSelect();
    };
    return (
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- the keyboard selects with the button of the name
        <div
            role="listitem"
            title={`Click to show mangas from this website\n\nLabel: ${connector.label}\nID: ${connector.id}\nURL: ${connector.url}`}
            onClick={select}
            className={
                'flex h-full cursor-pointer gap-[0.5em] overflow-hidden p-[0.5em] [border:var(--connector-card-border)] ' +
                (selected
                    ? 'bg-(--connector-card-selected) [box-shadow:inset_0_0_0_2px_var(--list-marker-color),var(--connector-card-shadow)]'
                    : 'bg-(--connector-card-background-color) hover:bg-(--connector-card-highlighted) [box-shadow:var(--connector-card-shadow)]')
            }
        >
            <img
                src={`/img/connectors/${connector.id}`}
                alt=""
                loading="lazy"
                onError={(event) => {
                    event.target.src = '/img/connectors/default';
                }}
                className="h-[3.25em] w-[3.25em] shrink-0"
            />
            <div className="flex min-w-0 flex-1 flex-col">
                <div className="mb-[0.25em] flex items-center gap-[0.5em] [border-bottom:var(--connector-title-border)]">
                    <button
                        type="button"
                        aria-current={selected ? 'true' : undefined}
                        title="Show the mangas of this website"
                        onClick={select}
                        className="min-w-0 flex-1 cursor-pointer truncate text-left text-[1.25em] font-bold"
                    >
                        {connector.label}
                    </button>
                    <div className="flex shrink-0 items-center gap-[0.25em]">
                        <CardButton
                            icon="login"
                            title="Click to open the login page"
                            label={`Login page of ${connector.label}`}
                            enabled={!!links.login}
                            onClick={() => openExternalLink(links.login)}
                        />
                        <CardButton
                            icon="coffee"
                            title="Click to open the donation page"
                            label={`Donation page of ${connector.label}`}
                            enabled={!!links.donation}
                            onClick={() => openExternalLink(links.donation)}
                        />
                        <CardButton
                            icon="external"
                            title={
                                'Click to open the website in a new window\nThis can be useful to check the status, bypass Cloudflare or unlock captchas'
                            }
                            label={`Open ${connector.label} in a new window`}
                            enabled={!!connector.url}
                            onClick={() => openExternalLink(connector.url)}
                        />
                        <CardButton
                            icon="refresh"
                            title={`Synchronize local manga list with online list from <${connector.label}>`}
                            label={`Update the manga list of ${connector.label}`}
                            enabled={!running}
                            busy={running}
                            onClick={onUpdate}
                        />
                    </div>
                </div>
                {running ? (
                    <div role="status" className="truncate text-(--connector-tag-color)">
                        {updateMessage(progress)}
                    </div>
                ) : (
                    <div className="flex flex-wrap gap-[0.25em] overflow-hidden">
                        {(connector.tags || []).map((tag) => (
                            <span
                                key={tag}
                                className="rounded-[0.5em] bg-(--connector-tag-background-color) px-[0.3em] whitespace-nowrap text-(--connector-tag-color)"
                            >
                                {tag}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * Classic connectors.html parity: the website picker as a dialog with a name
 * filter, a manga filter (local lists, Enter), tag filters and connector
 * cards (virtualized grid). Clicking a card selects it; the refresh button
 * on a card synchronizes that connector's manga list without selecting it.
 *
 * As a dialog it takes the focus (the name field) when it opens, keeps it inside, closes with Escape and gives the
 * focus back to the button that opened it.
 */
export default function ConnectorDialog({ open, selectedId, onSelect, onClose }) {
    const { notify } = useToast();
    const queryClient = useQueryClient();
    const { connectors, ready } = useConnectors();
    const [pattern, setPattern] = React.useState('');
    const [mangaPattern, setMangaPattern] = React.useState('');
    const [mangaMatches, setMangaMatches] = React.useState(null);
    const [searching, setSearching] = React.useState(false);
    const [selectedTags, setSelectedTags] = React.useState([]);
    const [updating, setUpdating] = React.useState({});
    const [width, setWidth] = React.useState(0);
    const patternRef = React.useRef(null);
    const listRef = React.useRef(null);
    const id = React.useId();
    const dialogRef = useDialog({ open, onClose, initialFocus: patternRef });

    const allTags = React.useMemo(() => {
        const tags = new Set();
        connectors.forEach((connector) => (connector.tags || []).forEach((tag) => tags.add(tag)));
        return [...tags].sort();
    }, [connectors]);

    const visible = React.useMemo(() => {
        const needle = pattern.toLowerCase();
        return connectors.filter((connector) => {
            // not every connector has a url (bookmarks, clipboard, folder): it must not be matched as the word "undefined"
            const patternMatch =
                !needle ||
                (connector.id + connector.label + (connector.url || ''))
                    .toLowerCase()
                    .includes(needle);
            const tagsMatch = selectedTags.every((tag) => (connector.tags || []).includes(tag));
            const mangaMatch = !mangaMatches || mangaMatches.includes(connector.id);
            return patternMatch && tagsMatch && mangaMatch;
        });
    }, [connectors, pattern, selectedTags, mangaMatches]);

    const columns = Math.max(1, Math.floor(width / CARD_MIN_WIDTH));
    const rows = Math.ceil(visible.length / columns);
    const virtualizer = useVirtualizer({
        count: rows,
        getScrollElement: () => listRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 4,
    });

    // The dialog stays mounted while it is closed, so the name field keeps what was typed: when it opens again the
    // text is selected, so that typing replaces it. (The parent renders again often, so this must only follow `open`.)
    React.useEffect(() => {
        if (open && patternRef.current) {
            patternRef.current.select();
            patternRef.current.focus();
        }
    }, [open]);

    React.useLayoutEffect(() => {
        const element = listRef.current;
        if (!open || !element || typeof ResizeObserver !== 'function') {
            return undefined;
        }
        const observer = new ResizeObserver(() => setWidth(element.clientWidth));
        observer.observe(element);
        setWidth(element.clientWidth);
        return () => observer.disconnect();
    }, [open]);

    const toggleTag = (tag) => {
        setSelectedTags((current) =>
            current.includes(tag) ? current.filter((entry) => entry !== tag) : [...current, tag],
        );
    };

    // a search that still runs when the filters are reset must not apply its result afterwards
    const searchRef = React.useRef(0);

    const clearFilters = () => {
        searchRef.current++;
        setSearching(false);
        setPattern('');
        setMangaPattern('');
        setMangaMatches(null);
        setSelectedTags([]);
    };

    const searchByManga = async () => {
        const search = ++searchRef.current;
        if (!mangaPattern.trim()) {
            setMangaMatches(null);
            return;
        }
        setSearching(true);
        try {
            const matches = await findConnectorsByManga(mangaPattern);
            if (search === searchRef.current) {
                setMangaMatches(matches);
            }
        } catch (error) {
            if (search === searchRef.current) {
                notify(`Manga search failed: ${error.message}`, 'error');
            }
        } finally {
            if (search === searchRef.current) {
                setSearching(false);
            }
        }
    };

    const update = async (connector) => {
        if (updating[connector.id]) {
            return;
        }
        setUpdating((current) => ({ ...current, [connector.id]: true }));
        try {
            const mangas = await updateMangaList(connector);
            queryClient.setQueryData(['mangas', connector.id], mangas);
            notify(`Updated ${connector.label} (${countTitles(mangas.length)}).`, 'success');
        } catch (error) {
            notify(`Failed to update manga list for ${connector.label}\n${error.message}`, 'error');
        } finally {
            setUpdating((current) => ({ ...current, [connector.id]: false }));
        }
    };

    if (!open) {
        return null;
    }

    return (
        <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Select a website"
            tabIndex={-1}
            className="fixed inset-[1em] z-40 flex flex-col bg-(--connector-dialog-background-color) [border:var(--connector-dialog-border)] [box-shadow:var(--connector-dialog-shadow)]"
        >
            <div className="p-[0.5em] text-right">
                <button
                    type="button"
                    title="Click to cancel the website selection"
                    aria-label="Close the website selection"
                    onClick={onClose}
                    className="rk-button"
                >
                    <Icon name="closeCircle" size={28} />
                </button>
            </div>
            <div className="flex min-h-0 flex-1 overflow-y-hidden">
                <div className="m-[0.5em] flex max-h-full w-[18em] shrink-0 flex-col">
                    <Separator icon="plug" label="Website" htmlFor={`${id}-name`} />
                    <input
                        ref={patternRef}
                        id={`${id}-name`}
                        type="text"
                        value={pattern}
                        onChange={(event) => setPattern(event.target.value)}
                        title="Show only websites with a name that matches the entered pattern (case-insensitive)"
                        className="rk-field w-[calc(100%-0.5em)]"
                    />
                    <Separator icon="book" label="Manga" htmlFor={`${id}-manga`} />
                    <input
                        id={`${id}-manga`}
                        type="text"
                        value={mangaPattern}
                        disabled={searching}
                        onChange={(event) => setMangaPattern(event.target.value)}
                        onKeyUp={(event) => {
                            if (event.key === 'Enter') {
                                searchByManga();
                            }
                        }}
                        title="Show only websites with a manga that matches the entered pattern (case-insensitive). Searches the local manga lists. Press Enter to apply."
                        className="rk-field w-[calc(100%-0.5em)]"
                    />
                    <Separator icon="tags" label="Tags" id={`${id}-tags`} />
                    <div
                        role="group"
                        aria-labelledby={`${id}-tags`}
                        className="flex min-h-0 flex-1 flex-wrap content-start gap-[0.25em] overflow-y-scroll bg-(--connector-tag-list-background-color) p-[0.5em]"
                    >
                        {allTags.map((tag) => (
                            <button
                                key={tag}
                                type="button"
                                aria-pressed={selectedTags.includes(tag)}
                                onClick={() => toggleTag(tag)}
                                className={
                                    'cursor-pointer rounded-[0.5em] px-[0.3em] whitespace-nowrap text-(--connector-tag-color) ' +
                                    (selectedTags.includes(tag)
                                        ? 'rk-selected-ring bg-(--connector-tag-selected)'
                                        : 'bg-(--connector-tag-background-color)')
                                }
                            >
                                {tag}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="m-[0.5em] flex max-h-full min-w-0 flex-1 flex-col">
                    <Separator label="Connectors" id={`${id}-connectors`}>
                        <button
                            type="button"
                            title="Reset all filters"
                            aria-label="Reset all filters"
                            onClick={clearFilters}
                            className="cursor-pointer text-(--connector-button-clear-color)"
                        >
                            <Icon name="close" size={14} />
                        </button>
                    </Separator>
                    <div role="status" className="py-[0.25em]">
                        {visible.length} / {connectors.length} websites
                        {ready ? '' : ' (still loading …)'}
                    </div>
                    <div
                        ref={listRef}
                        role="list"
                        aria-label="Connectors"
                        className="min-h-0 flex-1 overflow-y-scroll"
                    >
                        <div
                            className="relative w-full"
                            style={{ height: virtualizer.getTotalSize() }}
                        >
                            {virtualizer.getVirtualItems().map((virtual) => (
                                <div
                                    key={virtual.key}
                                    className="absolute top-0 left-0 grid w-full gap-[0.5em] p-[0.25em]"
                                    style={{
                                        height: virtual.size,
                                        transform: `translateY(${virtual.start}px)`,
                                        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                                    }}
                                >
                                    {visible
                                        .slice(
                                            virtual.index * columns,
                                            (virtual.index + 1) * columns,
                                        )
                                        .map((connector) => (
                                            <Card
                                                key={connector.id}
                                                connector={connector}
                                                selected={connector.id === selectedId}
                                                updating={!!updating[connector.id]}
                                                onSelect={() => onSelect(connector.id)}
                                                onUpdate={() => update(connector)}
                                            />
                                        ))}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

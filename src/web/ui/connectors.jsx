import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { getEngine, openExternalLink, findConnectorsByManga } from './engine.js';
import { updateMangaList } from './queries.js';
import { useToast } from './notify.jsx';
import Icon from './icon.jsx';

const CARD_MIN_WIDTH = 400;
const ROW_HEIGHT = 96;

function Separator({ icon, label, children }) {
    return (
        <div className="rk-separator flex items-center gap-[0.25em] pt-[0.5em] pb-[0.25em] pl-[0.5em] font-bold uppercase text-(--connector-dialog-category-color)">
            {children}
            {icon && <Icon name={icon} size={14} />}
            <label>{label}</label>
        </div>
    );
}

function CardButton({ icon, title, enabled, busy, onClick }) {
    return (
        <button
            type="button"
            title={title}
            disabled={!enabled}
            onClick={event => {
                event.stopPropagation();
                onClick();
            }}
            className="rk-button disabled:cursor-not-allowed disabled:opacity-25"
        >
            <Icon name={icon} size={16} spin={busy} />
        </button>
    );
}

function Card({ connector, selected, updating, onSelect, onUpdate }) {
    const links = connector.links || {};
    return (
        <div
            role="option"
            aria-selected={selected}
            tabIndex={0}
            title={`Click to show mangas from this website\n\nLabel: ${connector.label}\nID: ${connector.id}\nURL: ${connector.url}`}
            onClick={onSelect}
            onKeyDown={event => {
                if (event.key === 'Enter') {
                    onSelect();
                }
            }}
            className={
                'flex h-full cursor-pointer gap-[0.5em] overflow-hidden p-[0.5em] [border:var(--connector-card-border)] [box-shadow:var(--connector-card-shadow)] ' +
                (selected
                    ? 'bg-(--connector-card-selected)'
                    : 'bg-(--connector-card-background-color) hover:bg-(--connector-card-highlighted)')
            }
        >
            <img
                src={`/img/connectors/${connector.id}`}
                alt=""
                loading="lazy"
                onError={event => {
                    event.target.src = '/img/connectors/default';
                }}
                className="h-[3.25em] w-[3.25em] shrink-0"
            />
            <div className="flex min-w-0 flex-1 flex-col">
                <div className="mb-[0.25em] flex items-center gap-[0.5em] [border-bottom:var(--connector-title-border)]">
                    <div className="min-w-0 flex-1 truncate text-[1.25em] font-bold">{connector.label}</div>
                    <div className="flex shrink-0 items-center gap-[0.25em]">
                        <CardButton icon="login" title="Click to open the login page" enabled={!!links.login} onClick={() => openExternalLink(links.login)} />
                        <CardButton icon="coffee" title="Click to open the donation page" enabled={!!links.donation} onClick={() => openExternalLink(links.donation)} />
                        <CardButton
                            icon="external"
                            title={'Click to open the website in a new window\nThis can be useful to check the status, bypass Cloudflare or unlock captchas'}
                            enabled={!!connector.url}
                            onClick={() => openExternalLink(connector.url)}
                        />
                        <CardButton
                            icon="refresh"
                            title={`Synchronize local manga list with online list from <${connector.label}>`}
                            enabled={!updating}
                            busy={updating}
                            onClick={onUpdate}
                        />
                    </div>
                </div>
                <div className="flex flex-wrap gap-[0.25em] overflow-hidden">
                    {(connector.tags || []).map(tag => (
                        <span key={tag} className="rounded-[0.5em] bg-(--connector-tag-background-color) px-[0.3em] whitespace-nowrap text-(--connector-tag-color)">
                            {tag}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
}

/**
 * Classic connectors.html parity: the website picker as a dialog with a name
 * filter, a manga filter (local lists, Enter), tag filters and connector
 * cards (virtualized grid). Clicking a card selects it; the refresh button
 * on a card synchronizes that connector's manga list without selecting it.
 */
export default function ConnectorDialog({ open, selectedId, onSelect, onClose }) {
    const { notify } = useToast();
    const queryClient = useQueryClient();
    const connectors = getEngine().Connectors;
    const [pattern, setPattern] = React.useState('');
    const [mangaPattern, setMangaPattern] = React.useState('');
    const [mangaMatches, setMangaMatches] = React.useState(null);
    const [searching, setSearching] = React.useState(false);
    const [selectedTags, setSelectedTags] = React.useState([]);
    const [updating, setUpdating] = React.useState({});
    const [width, setWidth] = React.useState(0);
    const patternRef = React.useRef(null);
    const listRef = React.useRef(null);

    const allTags = React.useMemo(() => {
        const tags = new Set();
        connectors.forEach(connector => (connector.tags || []).forEach(tag => tags.add(tag)));
        return [...tags].sort();
    }, [connectors]);

    const visible = React.useMemo(() => {
        const needle = pattern.toLowerCase();
        return connectors.filter(connector => {
            const patternMatch = !needle || (connector.id + connector.label + connector.url).toLowerCase().includes(needle);
            const tagsMatch = selectedTags.every(tag => (connector.tags || []).includes(tag));
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
        overscan: 4
    });

    React.useEffect(() => {
        if (!open) {
            return undefined;
        }
        if (patternRef.current) {
            patternRef.current.select();
            patternRef.current.focus();
        }
        const onKeyDown = event => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, onClose]);

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

    const toggleTag = tag => {
        setSelectedTags(current => current.includes(tag) ? current.filter(entry => entry !== tag) : [...current, tag]);
    };

    const clearFilters = () => {
        setPattern('');
        setMangaPattern('');
        setMangaMatches(null);
        setSelectedTags([]);
    };

    const searchByManga = async () => {
        if (!mangaPattern.trim()) {
            setMangaMatches(null);
            return;
        }
        setSearching(true);
        try {
            setMangaMatches(await findConnectorsByManga(mangaPattern));
        } catch (error) {
            notify(`Manga search failed: ${error.message}`, 'error');
        } finally {
            setSearching(false);
        }
    };

    const update = async connector => {
        if (updating[connector.id]) {
            return;
        }
        setUpdating(current => ({ ...current, [connector.id]: true }));
        try {
            const mangas = await updateMangaList(connector);
            queryClient.setQueryData(['mangas', connector.id], mangas);
            notify(`Updated ${connector.label} (${mangas.length} titles).`, 'success');
        } catch (error) {
            notify(`Failed to update manga list for ${connector.label}\n${error.message}`, 'error');
        } finally {
            setUpdating(current => ({ ...current, [connector.id]: false }));
        }
    };

    if (!open) {
        return null;
    }

    return (
        <div className="fixed inset-[1em] z-40 flex flex-col bg-(--connector-dialog-background-color) [border:var(--connector-dialog-border)] [box-shadow:var(--connector-dialog-shadow)]">
            <div className="p-[0.5em] text-right">
                <button type="button" title="Click to cancel the website selection" onClick={onClose} className="rk-button">
                    <Icon name="closeCircle" size={28} />
                </button>
            </div>
            <div className="flex min-h-0 flex-1 overflow-y-hidden">
                <div className="m-[0.5em] flex max-h-full w-[18em] shrink-0 flex-col">
                    <Separator icon="plug" label="Website" />
                    <input
                        ref={patternRef}
                        type="text"
                        value={pattern}
                        onChange={event => setPattern(event.target.value)}
                        title="Show only websites with a name that matches the entered pattern (case-insensitive)"
                        className="rk-field w-[calc(100%-0.5em)]"
                    />
                    <Separator icon="book" label="Manga" />
                    <input
                        type="text"
                        value={mangaPattern}
                        disabled={searching}
                        onChange={event => setMangaPattern(event.target.value)}
                        onKeyUp={event => {
                            if (event.key === 'Enter') {
                                searchByManga();
                            }
                        }}
                        title="Show only websites with a manga that matches the entered pattern (case-insensitive). Searches the local manga lists. Press Enter to apply."
                        className="rk-field w-[calc(100%-0.5em)]"
                    />
                    <Separator icon="tags" label="Tags" />
                    <div className="min-h-0 flex-1 overflow-y-scroll bg-(--connector-tag-list-background-color) p-[0.5em] leading-[1.5em]">
                        {allTags.map(tag => (
                            <button
                                key={tag}
                                type="button"
                                onClick={() => toggleTag(tag)}
                                className={
                                    'mr-[0.25em] cursor-pointer rounded-[0.5em] px-[0.3em] whitespace-nowrap text-(--connector-tag-color) ' +
                                    (selectedTags.includes(tag) ? 'bg-(--connector-tag-selected)' : 'bg-(--connector-tag-background-color)')
                                }
                            >
                                {tag}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="m-[0.5em] flex max-h-full min-w-0 flex-1 flex-col">
                    <Separator label="Connectors">
                        <button type="button" title="Reset all filters" onClick={clearFilters} className="cursor-pointer text-(--connector-button-clear-color)">
                            <Icon name="close" size={14} />
                        </button>
                    </Separator>
                    <div className="py-[0.25em]">{visible.length} / {connectors.length} websites</div>
                    <div ref={listRef} role="listbox" aria-label="Connectors" className="min-h-0 flex-1 overflow-y-scroll">
                        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                            {virtualizer.getVirtualItems().map(virtual => (
                                <div
                                    key={virtual.key}
                                    className="absolute top-0 left-0 grid w-full gap-[0.5em] p-[0.25em]"
                                    style={{
                                        height: virtual.size,
                                        transform: `translateY(${virtual.start}px)`,
                                        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`
                                    }}
                                >
                                    {visible.slice(virtual.index * columns, (virtual.index + 1) * columns).map(connector => (
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

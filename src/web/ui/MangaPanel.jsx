import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { getEngine, toggleBookmark, isMangaBookmarked } from './engine.js';
import { fetchMangaList, updateMangaList } from './queries.js';
import { useToast } from './notify.jsx';
import { useSelection } from './selection.jsx';
import Icon from './icon.jsx';

/**
 * Manga list panel (classic mangas.html parity): connector picker, refresh,
 * title filter, bookmark star for the selected manga, virtual list, footer.
 */
export default function MangaPanel() {
    const { notify } = useToast();
    const { connectorId, selectConnector, manga: selectedManga, selectManga } = useSelection();
    const queryClient = useQueryClient();
    const connectors = getEngine().Connectors;
    const [pattern, setPattern] = React.useState('');
    const [updating, setUpdating] = React.useState(false);
    const [, setBookmarkTick] = React.useState(0);
    const scrollRef = React.useRef(null);

    const effectiveId = connectorId || (connectors[0] && connectors[0].id) || '';
    const connector = connectors.find(entry => entry.id === effectiveId);

    const mangaQuery = useQuery({
        queryKey: ['mangas', effectiveId],
        queryFn: () => fetchMangaList(connector),
        enabled: !!connector
    });

    const mangas = React.useMemo(() => {
        const list = mangaQuery.data || [];
        if (pattern.trim().length < 3) {
            return list;
        }
        const needle = pattern.trim().toLowerCase();
        return list.filter(manga => manga.title.toLowerCase().includes(needle));
    }, [mangaQuery.data, pattern]);

    const virtualizer = useVirtualizer({
        count: mangas.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 28,
        overscan: 20
    });

    const onUpdate = async () => {
        if (!connector || updating) {
            return;
        }
        setUpdating(true);
        try {
            const updated = await updateMangaList(connector);
            queryClient.setQueryData(['mangas', effectiveId], updated);
            notify(`Manga list updated (${updated.length} titles).`, 'success');
        } catch (error) {
            notify(`Update failed: ${error.message}`, 'error');
        } finally {
            setUpdating(false);
        }
    };

    const onToggleBookmark = () => {
        if (!selectedManga) {
            return;
        }
        try {
            toggleBookmark(selectedManga);
            setBookmarkTick(tick => tick + 1);
        } catch (error) {
            notify(`Bookmark failed: ${error.message}`, 'error');
        }
    };

    return (
        <section className="flex w-64 shrink-0 flex-col border-r border-zinc-400 bg-[#d6d6d6] dark:border-zinc-700 dark:bg-zinc-950">
            <header className="flex items-center justify-between px-2 py-1 text-sm font-bold">
                <span>Manga List</span>
                <span className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400">
                    <Icon name="book" size={12} />
                </span>
            </header>
            <div className="space-y-1 px-2 pb-1">
                <select
                    className="w-full rounded border border-zinc-400 bg-white px-1 py-0.5 text-[13px] dark:border-zinc-600 dark:bg-zinc-800"
                    value={effectiveId}
                    onChange={event => selectConnector(event.target.value)}
                    title="Select connector"
                >
                    {connectors.map(entry => (
                        <option key={entry.id} value={entry.id}>{entry.label}</option>
                    ))}
                </select>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={onUpdate}
                        disabled={!connector || updating}
                        title={connector ? `Synchronize manga list with ${connector.label}` : ''}
                        className="shrink-0 text-[#00a000] disabled:opacity-50 dark:text-green-400"
                    >
                        <Icon name="refresh" size={14} />
                    </button>
                    <input
                        type="search"
                        placeholder="Filter titles (min 3 chars) …"
                        value={pattern}
                        onChange={event => setPattern(event.target.value)}
                        className="min-w-0 flex-1 rounded border border-zinc-400 bg-white px-1 py-0.5 text-[13px] dark:border-zinc-600 dark:bg-zinc-800"
                    />
                    <button
                        type="button"
                        onClick={onToggleBookmark}
                        disabled={!selectedManga}
                        title={selectedManga ? 'Toggle bookmark for the selected manga' : 'Select a manga first'}
                        className="shrink-0 text-[#e0c000] disabled:opacity-30 dark:text-amber-400"
                    >
                        <Icon name="star" size={14} filled={selectedManga ? isMangaBookmarked(selectedManga) : false} />
                    </button>
                </div>
            </div>
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto border-y border-zinc-400 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                {mangaQuery.isPending && <p className="p-2 text-[13px]">Loading …</p>}
                {mangaQuery.isError && <p className="p-2 text-[13px] text-red-600">Empty — press Update.</p>}
                <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                    {virtualizer.getVirtualItems().map(virtual => {
                        const manga = mangas[virtual.index];
                        if (!manga) {
                            return null;
                        }
                        const selected = selectedManga && selectedManga.id === manga.id;
                        return (
                            <div
                                key={manga.id}
                                className="absolute top-0 left-0 w-full"
                                style={{ height: virtual.size, transform: `translateY(${virtual.start}px)` }}
                            >
                                <button
                                    type="button"
                                    title={`${manga.title}\n${manga.connector.label}`}
                                    onClick={() => selectManga(manga)}
                                    className={
                                        'block h-full w-full truncate px-2 text-left text-[13px] ' +
                                        (selected ? 'bg-[rgba(0,128,255,0.3)]' : 'hover:bg-[rgba(0,128,255,0.15)]')
                                    }
                                >
                                    {manga.title}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>
            <footer className="px-2 py-1 text-xs">
                Mangas: {mangas.length} / {mangaQuery.data ? mangaQuery.data.length : 0}
            </footer>
        </section>
    );
}

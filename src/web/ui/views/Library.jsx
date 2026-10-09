import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useNavigate } from '@tanstack/react-router';
import { getEngine, toggleBookmark, isMangaBookmarked } from '../engine.js';
import { fetchMangaList, updateMangaList } from '../queries.js';
import { useToast } from '../notify.jsx';

function useContainerWidth(ref, minCardWidth) {
    const [width, setWidth] = React.useState(0);
    React.useEffect(() => {
        if (!ref.current) {
            return undefined;
        }
        const observer = new ResizeObserver(entries => {
            setWidth(entries[0].contentRect.width);
        });
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, [ref]);
    return Math.max(1, Math.floor(width / minCardWidth));
}

function MangaCard({ manga, bookmarked, onOpen, onToggleBookmark }) {
    return (
        <div
            className={
                'flex h-28 flex-col justify-between rounded-lg border p-2 text-left ' +
                (manga.status === 'completed'
                    ? 'border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950'
                    : 'border-zinc-200 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900')
            }
        >
            <button type="button" onClick={onOpen} title={`${manga.title}\n${manga.connector.label}`} className="min-h-0 flex-1">
                <span className="line-clamp-3 block text-xs font-medium leading-snug">{manga.title}</span>
            </button>
            <div className="flex items-center justify-between pt-1">
                <span className="truncate text-[10px] text-zinc-500 dark:text-zinc-400">{manga.connector.label}</span>
                <button
                    type="button"
                    title={bookmarked ? 'Remove bookmark' : 'Add bookmark'}
                    onClick={onToggleBookmark}
                    className={'shrink-0 px-1 text-sm ' + (bookmarked ? 'text-amber-500' : 'text-zinc-300 hover:text-amber-400 dark:text-zinc-600')}
                >
                    &#9733;
                </button>
            </div>
        </div>
    );
}

export default function LibraryView() {
    const { notify } = useToast();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const connectors = getEngine().Connectors;
    const [connectorId, setConnectorId] = React.useState(() => connectors[0] && connectors[0].id);
    const [pattern, setPattern] = React.useState('');
    const [updating, setUpdating] = React.useState(false);
    const [, setBookmarkTick] = React.useState(0);
    const scrollRef = React.useRef(null);
    const lanes = useContainerWidth(scrollRef, 180);

    const connector = connectors.find(entry => entry.id === connectorId);
    const mangaQuery = useQuery({
        queryKey: ['mangas', connectorId],
        queryFn: () => fetchMangaList(connector),
        enabled: !!connector
    });

    const mangas = React.useMemo(() => {
        const list = mangaQuery.data || [];
        // Classic parity: the title filter applies from 3 characters.
        if (pattern.trim().length < 3) {
            return list;
        }
        const needle = pattern.trim().toLowerCase();
        return list.filter(manga => manga.title.toLowerCase().includes(needle));
    }, [mangaQuery.data, pattern]);

    const virtualizer = useVirtualizer({
        count: mangas.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 128,
        lanes,
        overscan: 2
    });

    const onUpdate = async () => {
        if (!connector || updating) {
            return;
        }
        setUpdating(true);
        try {
            const updated = await updateMangaList(connector);
            queryClient.setQueryData(['mangas', connectorId], updated);
            notify(`Manga list updated (${updated.length} titles).`, 'success');
        } catch (error) {
            notify(`Update failed: ${error.message}`, 'error');
        } finally {
            setUpdating(false);
        }
    };

    const openManga = manga => {
        navigate({
            to: '/chapters',
            search: { connector: connector.id, manga: manga.id }
        });
    };

    const toggleBookmarkState = manga => {
        try {
            toggleBookmark(manga);
            setBookmarkTick(tick => tick + 1);
        } catch (error) {
            notify(`Bookmark failed: ${error.message}`, 'error');
        }
    };

    return (
        <div className="flex h-full flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <select
                    className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                    value={connectorId || ''}
                    onChange={event => setConnectorId(event.target.value)}
                    title="Select connector"
                >
                    {connectors.map(entry => (
                        <option key={entry.id} value={entry.id}>{entry.label}</option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={onUpdate}
                    disabled={!connector || updating}
                    title={connector ? `Synchronize manga list with ${connector.label}` : ''}
                    className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-800"
                >
                    {updating ? 'Updating …' : 'Update'}
                </button>
                <input
                    type="search"
                    placeholder="Filter titles (min 3 chars) …"
                    value={pattern}
                    onChange={event => setPattern(event.target.value)}
                    className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                />
            </div>
            {mangaQuery.isPending && <p className="text-sm text-zinc-500">Loading manga list …</p>}
            {mangaQuery.isError && (
                <p className="text-sm text-red-600">Failed to load manga list. Try Update to fetch it from the site.</p>
            )}
            {mangaQuery.isSuccess && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {mangas.length} / {mangaQuery.data.length} titles
                </p>
            )}
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
                <div
                    className="relative w-full"
                    style={{ height: virtualizer.getTotalSize() }}
                >
                    {virtualizer.getVirtualItems().map(virtual => {
                        const manga = mangas[virtual.index];
                        if (!manga) {
                            return null;
                        }
                        return (
                            <div
                                key={manga.id}
                                className="absolute top-0 left-0 p-1"
                                style={{
                                    width: `${100 / lanes}%`,
                                    height: virtual.size,
                                    transform: `translateX(${virtual.lane * 100}%) translateY(${virtual.start}px)`
                                }}
                            >
                                <MangaCard
                                    manga={manga}
                                    bookmarked={isMangaBookmarked(manga)}
                                    onOpen={() => openManga(manga)}
                                    onToggleBookmark={() => toggleBookmarkState(manga)}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

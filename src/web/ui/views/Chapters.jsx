import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { getChaptermark, subscribeChaptermarks, toggleChaptermark, isChapterMarked } from '../engine.js';
import { fetchChapterList, resolveManga, addChapterDownloads } from '../queries.js';
import { useToast } from '../notify.jsx';
import { ConfirmDialog } from '../dialog.jsx';

const chaptersRoute = getRouteApi('/chapters');

const STATUS_STYLE = {
    unavailable: 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500',
    offline: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
    available: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
    queued: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    downloading: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    completed: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
    failed: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
};

const STATUS_TOOLTIP = {
    unavailable: 'Chapter is not available',
    offline: 'OFFLINE — only accessible from the manga directory',
    available: 'AVAILABLE — click to download chapter',
    queued: 'QUEUED',
    downloading: 'DOWNLOADING',
    completed: 'DOWNLOADED — click to delete and re-download chapter',
    failed: 'DOWNLOAD FAILED — click to delete and re-download the chapter'
};

function statusBadge(status) {
    return (
        <span
            title={STATUS_TOOLTIP[status] || status}
            className={'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ' + (STATUS_STYLE[status] || STATUS_STYLE.unavailable)}
        >
            {status || '?'}
        </span>
    );
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export default function ChaptersView() {
    const { notify } = useToast();
    const navigate = useNavigate();
    const { connector: connectorId, manga: mangaId } = chaptersRoute.useSearch();
    const [pattern, setPattern] = React.useState('');
    const [language, setLanguage] = React.useState('');
    const [sort, setSort] = React.useState('none');
    const [selected, setSelected] = React.useState(() => new Set());
    const [confirm, setConfirm] = React.useState(null);
    const [, setVersion] = React.useState(0);
    const scrollRef = React.useRef(null);

    const mangaQuery = useQuery({
        queryKey: ['manga', connectorId, mangaId],
        queryFn: () => resolveManga(connectorId, mangaId)
    });
    const manga = mangaQuery.data;

    const chaptersQuery = useQuery({
        queryKey: ['chapters', connectorId, mangaId],
        queryFn: () => fetchChapterList(manga),
        enabled: !!manga
    });
    const chapters = chaptersQuery.data || [];

    const markedChapter = React.useSyncExternalStore(
        subscribeChaptermarks,
        () => (manga ? getChaptermark(manga) : null)
    );

    const languages = React.useMemo(
        () => Array.from(new Set(chapters.map(chapter => chapter.language).filter(Boolean))).sort(),
        [chapters]
    );

    const visible = React.useMemo(() => {
        let list = chapters;
        const needle = pattern.trim().toLowerCase();
        if (needle) {
            list = list.filter(chapter => chapter.title.toLowerCase().includes(needle));
        }
        if (language) {
            list = list.filter(chapter => (chapter.language || '').toLowerCase() === language.toLowerCase());
        }
        if (sort === 'asc') {
            list = list.slice().sort((a, b) => collator.compare(a.title, b.title));
        } else if (sort === 'desc') {
            list = list.slice().sort((a, b) => -collator.compare(a.title, b.title));
        }
        return list;
    }, [chapters, pattern, language, sort]);

    const virtualizer = useVirtualizer({
        count: visible.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 44,
        overscan: 10
    });

    const bump = () => setVersion(value => value + 1);

    const toggleSelect = id => {
        setSelected(current => {
            const next = new Set(current);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const toggleSelectShown = () => {
        const ids = visible.map(chapter => chapter.id);
        const allSelected = ids.length > 0 && ids.every(id => selected.has(id));
        setSelected(current => {
            const next = new Set(current);
            if (allSelected) {
                ids.forEach(id => next.delete(id));
            } else {
                ids.forEach(id => next.add(id));
            }
            return next;
        });
    };

    const downloadChapters = list => {
        const downloadable = list.filter(chapter => chapter.status === 'available' || chapter.status === 'failed');
        if (!downloadable.length) {
            notify('Nothing downloadable in the current selection.', 'info');
            return;
        }
        addChapterDownloads(downloadable);
        notify(`Queued ${downloadable.length} chapter(s) for download.`, 'success');
        bump();
    };

    const processChapter = chapter => {
        switch (chapter.status) {
            case 'available':
            case 'failed':
                downloadChapters([chapter]);
                break;
            case 'completed':
                setConfirm(chapter);
                break;
            default:
                notify('No action available for this chapter.', 'info');
                break;
        }
    };

    const cycleSort = () => {
        setSort(current => (current === 'none' ? 'asc' : current === 'asc' ? 'desc' : 'none'));
    };

    if (mangaQuery.isPending) {
        return <p className="text-sm text-zinc-500">Resolving manga …</p>;
    }
    if (mangaQuery.isError) {
        return <p className="text-sm text-red-600">Manga not found. Go back to the library and pick it again.</p>;
    }

    return (
        <div className="flex h-full flex-col gap-3">
            <div>
                <h1 className="truncate text-lg font-semibold">{manga.title}</h1>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{manga.connector.label}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <input
                    type="search"
                    placeholder="Filter chapters …"
                    value={pattern}
                    onChange={event => setPattern(event.target.value)}
                    className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                />
                <select
                    value={language}
                    onChange={event => setLanguage(event.target.value)}
                    title="Filter by language"
                    className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                >
                    <option value="">All languages</option>
                    {languages.map(entry => (
                        <option key={entry} value={entry}>{entry}</option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={cycleSort}
                    title="Cycle sort order (none → asc → desc)"
                    className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
                >
                    Sort: {sort}
                </button>
                <label className="flex items-center gap-1 text-sm" title="Select all shown chapters">
                    <input
                        type="checkbox"
                        checked={visible.length > 0 && visible.every(chapter => selected.has(chapter.id))}
                        onChange={toggleSelectShown}
                        className="h-4 w-4 accent-zinc-700 dark:accent-zinc-300"
                    />
                    All
                </label>
                <button
                    type="button"
                    onClick={() => downloadChapters(visible.filter(chapter => selected.has(chapter.id)))}
                    disabled={selected.size === 0}
                    title="Download selected chapters"
                    className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-800"
                >
                    Download selected ({selected.size})
                </button>
                <button
                    type="button"
                    onClick={() => downloadChapters(visible)}
                    title="Download all shown chapters with status available"
                    className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
                >
                    Download shown
                </button>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {visible.length} / {chapters.length} chapters
                {markedChapter && !visible.some(chapter => isChapterMarked(chapter, markedChapter)) && ' — the marked chapter is not in this list'}
            </p>
            {chaptersQuery.isPending && <p className="text-sm text-zinc-500">Loading chapters …</p>}
            {chaptersQuery.isError && <p className="text-sm text-red-600">Failed to load chapters.</p>}
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                    {virtualizer.getVirtualItems().map(virtual => {
                        const chapter = visible[virtual.index];
                        if (!chapter) {
                            return null;
                        }
                        return (
                            <div
                                key={chapter.id}
                                className="absolute top-0 left-0 flex w-full items-center gap-2 border-b border-zinc-100 px-2 dark:border-zinc-800"
                                style={{ height: virtual.size, transform: `translateY(${virtual.start}px)` }}
                            >
                                <input
                                    type="checkbox"
                                    checked={selected.has(chapter.id)}
                                    onChange={() => toggleSelect(chapter.id)}
                                    title={`Select ${chapter.title}`}
                                    className="h-4 w-4 shrink-0 accent-zinc-700 dark:accent-zinc-300"
                                />
                                <button
                                    type="button"
                                    title={chapter.title}
                                    onClick={() => navigate({ to: '/reader', search: { connector: connectorId, manga: mangaId, chapter: chapter.id } })}
                                    className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
                                >
                                    {chapter.title}
                                </button>
                                <button
                                    type="button"
                                    title="Toggle recently-read marker"
                                    onClick={() => {
                                        toggleChaptermark(chapter, markedChapter);
                                        bump();
                                    }}
                                    className={'shrink-0 text-sm ' + (isChapterMarked(chapter, markedChapter) ? 'text-amber-500' : 'text-zinc-300 hover:text-amber-400 dark:text-zinc-600')}
                                >
                                    &#9733;
                                </button>
                                {statusBadge(chapter.status)}
                                <button
                                    type="button"
                                    title={STATUS_TOOLTIP[chapter.status] || 'Download chapter'}
                                    onClick={() => processChapter(chapter)}
                                    className="shrink-0 rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
                                >
                                    &#8681;
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>
            <ConfirmDialog
                open={confirm !== null}
                title="Re-download existing chapter?"
                message={confirm ? `"${confirm.title}" is already downloaded.` : ''}
                confirmLabel="Re-download"
                onConfirm={() => {
                    if (confirm) {
                        downloadChapters([confirm]);
                    }
                    setConfirm(null);
                }}
                onCancel={() => setConfirm(null)}
            />
        </div>
    );
}

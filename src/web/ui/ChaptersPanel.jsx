import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useNavigate } from '@tanstack/react-router';
import { getChaptermark, subscribeChaptermarks, toggleChaptermark, isChapterMarked } from './engine.js';
import { fetchChapterList, addChapterDownloads } from './queries.js';
import { useSelection } from './selection.jsx';
import { useToast } from './notify.jsx';
import { ConfirmDialog } from './dialog.jsx';
import Icon from './icon.jsx';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Chapter list panel (classic chapters.html parity): language filter,
 * title filter, sort cycle, virtual list with download buttons and the
 * recently-read marker, footer. Selecting a title opens the reader.
 */
export default function ChaptersPanel() {
    const navigate = useNavigate();
    const { connectorId, manga } = useSelection();
    const [pattern, setPattern] = React.useState('');
    const [language, setLanguage] = React.useState('');
    const [sort, setSort] = React.useState('none');
    const [confirm, setConfirm] = React.useState(null);
    const [, setVersion] = React.useState(0);
    const scrollRef = React.useRef(null);
    const { notify } = useToast();

    const chaptersQuery = useQuery({
        queryKey: ['chapters', connectorId, manga && manga.id],
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
        estimateSize: () => 28,
        overscan: 20
    });

    const openReader = chapter => {
        navigate({
            to: '/reader',
            search: { connector: connectorId, manga: manga.id, chapter: chapter.id }
        });
    };

    const cycleSort = () => {
        setSort(current => (current === 'none' ? 'asc' : current === 'asc' ? 'desc' : 'none'));
    };

    const downloadChapters = list => {
        const downloadable = list.filter(chapter => chapter.status === 'available' || chapter.status === 'failed');
        if (!downloadable.length) {
            notify('Nothing downloadable.', 'info');
            return;
        }
        addChapterDownloads(downloadable);
        notify(`Queued ${downloadable.length} chapter(s).`, 'success');
        setVersion(value => value + 1);
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

    return (
        <section className="flex w-64 shrink-0 flex-col border-r border-zinc-400 bg-[#d6d6d6] dark:border-zinc-700 dark:bg-zinc-950">
            <header className="flex items-center justify-between px-2 py-1 text-sm font-bold">
                <span>Chapter List</span>
                <span className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => downloadChapters(visible)}
                        title="Download all shown chapters with status available"
                        className="text-zinc-600 hover:text-black dark:text-zinc-400"
                    >
                        <Icon name="download" size={12} />
                    </button>
                    <button
                        type="button"
                        onClick={cycleSort}
                        title="Cycle sort order"
                        className="text-zinc-600 hover:text-black dark:text-zinc-400"
                    >
                        <Icon name="sort" size={12} />
                    </button>
                </span>
            </header>
            <div className="space-y-1 px-2 pb-1">
                <select
                    value={language}
                    onChange={event => setLanguage(event.target.value)}
                    title="Filter by language"
                    className="w-full rounded border border-zinc-400 bg-white px-1 py-0.5 text-[13px] dark:border-zinc-600 dark:bg-zinc-800"
                >
                    <option value="">* (all languages)</option>
                    {languages.map(entry => (
                        <option key={entry} value={entry}>{entry}</option>
                    ))}
                </select>
                <input
                    type="search"
                    placeholder="Filter chapters …"
                    value={pattern}
                    onChange={event => setPattern(event.target.value)}
                    className="w-full rounded border border-zinc-400 bg-white px-1 py-0.5 text-[13px] dark:border-zinc-600 dark:bg-zinc-800"
                />
            </div>
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto border-y border-zinc-400 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                {!manga && <p className="p-2 text-[13px] text-zinc-500">Select a manga first.</p>}
                {manga && chaptersQuery.isPending && <p className="p-2 text-[13px]">Loading …</p>}
                {manga && chaptersQuery.isError && <p className="p-2 text-[13px] text-red-600">Failed to load chapters.</p>}
                <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                    {virtualizer.getVirtualItems().map(virtual => {
                        const chapter = visible[virtual.index];
                        if (!chapter) {
                            return null;
                        }
                        const marked = isChapterMarked(chapter, markedChapter);
                        return (
                            <div
                                key={chapter.id}
                                className="absolute top-0 left-0 flex w-full items-center gap-1 px-1 hover:bg-[rgba(0,128,255,0.15)]"
                                style={{ height: virtual.size, transform: `translateY(${virtual.start}px)` }}
                            >
                                <button
                                    type="button"
                                    title="Toggle recently-read marker"
                                    onClick={() => toggleChaptermark(chapter, markedChapter)}
                                    className={'shrink-0 ' + (marked ? 'text-zinc-800 dark:text-zinc-100' : 'text-[#2080e0]')}
                                >
                                    <Icon name="bookmark" size={12} filled={marked} />
                                </button>
                                <button
                                    type="button"
                                    title={chapter.title}
                                    onClick={() => openReader(chapter)}
                                    className="min-w-0 flex-1 truncate text-left text-[13px]"
                                >
                                    {chapter.title}
                                </button>
                                <button
                                    type="button"
                                    title="Download chapter"
                                    onClick={() => processChapter(chapter)}
                                    className="shrink-0 text-[#2080e0]"
                                >
                                    <Icon name="download" size={12} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>
            <footer className="px-2 py-1 text-xs">
                Chapters: {visible.length} / {chapters.length}
            </footer>
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
        </section>
    );
}

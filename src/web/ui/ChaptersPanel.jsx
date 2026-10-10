import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useNavigate, useSearch } from '@tanstack/react-router';
import {
    getChaptermark,
    subscribeChaptermarks,
    toggleChaptermark,
    deleteChaptermark,
    isChapterMarked,
    showChapterFolder
} from './engine.js';
import { fetchChapterList, addChapterDownloads } from './queries.js';
import { useSelection } from './selection.jsx';
import { useToast } from './notify.jsx';
import { ConfirmDialog } from './dialog.jsx';
import StatusLine from './status.jsx';
import Icon from './icon.jsx';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Classic chapters.html getChapterDownloadClass/-Tooltip parity.
const STATUS = {
    unavailable: {
        icon: 'warning',
        color: '',
        text: 'text-(--status-unavailable-color)',
        tooltip: 'Chapter is not available'
    },
    offline: {
        icon: 'folderClosed',
        color: 'text-(--chapter-button-offline-color)',
        text: '',
        tooltip: 'OFFLINE\nThe chapter is only accessable from the manga directory'
    },
    available: {
        icon: 'cloud',
        color: 'text-(--chapter-button-available-color)',
        text: 'text-(--status-available-color)',
        tooltip: 'AVAILABLE\nClick to download chapter'
    },
    queued: {
        icon: 'cloudDownload',
        color: 'text-(--chapter-button-queued-color)',
        text: 'text-(--status-queued-color)',
        tooltip: 'QUEUED\nClick to remove chapter from download manager'
    },
    downloading: {
        icon: 'cloudDownload',
        color: 'text-(--chapter-button-downloading-color)',
        text: 'text-(--status-downloading-color)',
        tooltip: 'DOWNLOADING'
    },
    completed: {
        icon: 'folder',
        color: 'text-(--chapter-button-completed-color)',
        text: 'text-(--status-completed-color)',
        tooltip: 'DOWNLOADED\nClick to delete and re-download chapter'
    },
    failed: {
        icon: 'warning',
        color: 'text-(--chapter-button-failed-color)',
        text: '',
        tooltip: 'DOWNLOAD FAILED\nCheck the exclamation mark in the joblist for details\nClick to delete and re-download the chapter'
    }
};

const SORT_ICON = { none: 'sort', asc: 'sortAlphaDown', desc: 'sortAlphaUp' };

/** Classic filterChapters: `/regex/flags` patterns, otherwise a plain substring. */
function matchTitle(title, pattern) {
    if (!pattern) {
        return true;
    }
    const parts = pattern.split('/');
    if (parts.length === 3 && parts[0].length === 0 && parts[1].length > 0) {
        try {
            return new RegExp(parts[1], parts[2]).test(title);
        } catch {
            return false;
        }
    }
    return title.toLowerCase().includes(pattern.toLowerCase());
}

/**
 * Chapter list panel (classic chapters.html parity): language and title
 * filters, sort cycle, download-all, virtual list with status button,
 * preview, recently-read marker and folder opener, footer.
 */
export default function ChaptersPanel({ readerEnabled }) {
    const navigate = useNavigate();
    const { chapter: openChapterId } = useSearch({ strict: false });
    const { connectorId, manga, setChapterOrder } = useSelection();
    const [pattern, setPattern] = React.useState('');
    const [language, setLanguage] = React.useState('');
    const [sort, setSort] = React.useState('none');
    const [confirm, setConfirm] = React.useState(null);
    const [confirmAll, setConfirmAll] = React.useState(null);
    const scrollRef = React.useRef(null);
    const { notify } = useToast();

    const chaptersQuery = useQuery({
        queryKey: ['chapters', connectorId, manga && manga.id],
        queryFn: () => fetchChapterList(manga),
        enabled: !!manga
    });
    const chapters = React.useMemo(() => chaptersQuery.data || [], [chaptersQuery.data]);

    const markedChapter = React.useSyncExternalStore(
        subscribeChaptermarks,
        () => (manga ? getChaptermark(manga) : null)
    );

    const languages = React.useMemo(
        () => Array.from(new Set(chapters.map(chapter => chapter.language).filter(Boolean))).sort(),
        [chapters]
    );

    // A new manga resets the language filter (classic onSelectedMangaChanged).
    React.useEffect(() => setLanguage(''), [manga]);

    const visible = React.useMemo(() => {
        let list = chapters.filter(chapter => {
            const chapterLanguage = chapter.language ? chapter.language.toLowerCase() : chapter.language;
            return matchTitle(chapter.title, pattern) && (!language || language.toLowerCase() === chapterLanguage);
        });
        if (sort === 'asc') {
            list = list.slice().sort((a, b) => collator.compare(a.title, b.title));
        } else if (sort === 'desc') {
            list = list.slice().sort((a, b) => -collator.compare(a.title, b.title));
        }
        return list;
    }, [chapters, pattern, language, sort]);

    // The reader steps through the list exactly as shown here (classic chapterUp/-Down).
    React.useEffect(() => {
        setChapterOrder(visible);
        return () => setChapterOrder([]);
    }, [visible, setChapterOrder]);

    // The marked chapter vanished from the list: classic shows a removable stub row.
    const markedRemoved = !!markedChapter && chapters.length > 0 && !chapters.some(chapter => isChapterMarked(chapter, markedChapter));

    const virtualizer = useVirtualizer({
        count: visible.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 22,
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

    const queue = list => {
        addChapterDownloads(list);
        notify(`Queued ${list.length} chapter(s).`, 'success');
    };

    const onDownloadAll = () => {
        const available = visible.filter(chapter => chapter.status === 'available');
        if (available.length > 0) {
            setConfirmAll(available);
        }
    };

    const processChapter = chapter => {
        switch (chapter.status) {
            case 'available':
            case 'failed':
                queue([chapter]);
                break;
            case 'completed':
                setConfirm(chapter);
                break;
            default:
                notify('No action available!', 'info');
                break;
        }
    };

    return (
        <section
            className={
                'box-border flex min-h-0 flex-col bg-(--control-background-color) p-[0.5em] ' +
                (readerEnabled ? 'w-[20em] shrink-0' : 'max-w-1/2 flex-1')
            }
        >
            <div className="rk-separator flex items-center gap-[0.25em] p-[0.25em] text-[1.25em] font-bold">
                <span className="flex-1">Chapter List</span>
                <button type="button" onClick={cycleSort} title="Click to toggle chapter sorting" className="rk-button">
                    <Icon name={SORT_ICON[sort]} size={16} />
                </button>
                <button
                    type="button"
                    onClick={onDownloadAll}
                    title="Click to download all chapters currently shown in the filtered and sorted list"
                    className="rk-button"
                >
                    <Icon name="download" size={16} />
                </button>
            </div>
            <div className="rk-separator grid grid-cols-[auto_1fr] items-center gap-x-[0.25em]">
                <Icon name="language" size={14} className="rk-icon" />
                <select
                    value={language}
                    onChange={event => setLanguage(event.target.value)}
                    title="Select a language to filter the chapter list"
                    className="rk-field rk-field-select w-[calc(100%-0.5em)]"
                >
                    <option value="">*</option>
                    {languages.map(entry => (
                        <option key={entry} value={entry}>{entry}</option>
                    ))}
                </select>
                <Icon name="search" size={14} className="rk-icon" />
                <input
                    type="text"
                    value={pattern}
                    onChange={event => setPattern(event.target.value)}
                    title="Enter a pattern (regex support e.g. '/ch 001/i') to filter the chapter list by their titles"
                    className="rk-field w-[calc(100%-0.5em)]"
                />
            </div>
            <div
                ref={scrollRef}
                role="list"
                className="rk-list my-[0.5em] min-h-0 flex-1 overflow-x-hidden overflow-y-scroll bg-(--list-background-color) p-[0.25em] whitespace-nowrap"
            >
                {markedRemoved && (
                    <div className="flex items-center gap-[0.25em] overflow-hidden text-ellipsis">
                        <span className="w-[1.25em] shrink-0" />
                        <span className="w-[1.25em] shrink-0" />
                        <button
                            type="button"
                            title="Click to remove the marked chapter"
                            onClick={() => deleteChaptermark(markedChapter)}
                            className="shrink-0 cursor-pointer text-(--chapter-marker-removed-color)"
                        >
                            <Icon name="bookmark" size={14} />
                        </button>
                        <span
                            className="text-(--chapter-marker-removed-color)"
                            title={`The chapter has been marked as "recently read" but is no longer available\nID: ${markedChapter.chapterID}`}
                        >
                            {markedChapter.chapterTitle}
                        </span>
                    </div>
                )}
                <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                    {virtualizer.getVirtualItems().map(virtual => {
                        const chapter = visible[virtual.index];
                        if (!chapter) {
                            return null;
                        }
                        const status = STATUS[chapter.status] || { icon: 'warning', color: '', text: '', tooltip: 'No tooltip available!' };
                        const marked = isChapterMarked(chapter, markedChapter);
                        const open = openChapterId === chapter.id;
                        return (
                            <div
                                key={chapter.id}
                                className={
                                    'absolute top-0 left-0 flex w-full items-center gap-[0.25em] ' +
                                    (open ? 'bg-(--list-selected)' : 'hover:bg-(--list-highlighted)')
                                }
                                style={{ height: virtual.size, transform: `translateY(${virtual.start}px)` }}
                            >
                                <button
                                    type="button"
                                    title={status.tooltip}
                                    onClick={() => processChapter(chapter)}
                                    className={'rk-icon w-[1.25em] shrink-0 cursor-pointer ' + status.color}
                                >
                                    <Icon name={status.icon} size={14} className="mx-auto" />
                                </button>
                                {readerEnabled && (
                                    <button
                                        type="button"
                                        title="Show preview of chapter's pages"
                                        onClick={() => openReader(chapter)}
                                        className="rk-button w-[1.25em] shrink-0"
                                    >
                                        <Icon name="image" size={14} className="mx-auto" />
                                    </button>
                                )}
                                <button
                                    type="button"
                                    title={
                                        marked
                                            ? 'Remove the "recently read" marker from this chapter'
                                            : 'Mark this chapter as "recently read"'
                                    }
                                    onClick={() => toggleChaptermark(chapter, markedChapter)}
                                    className={
                                        'w-[1.25em] shrink-0 cursor-pointer ' +
                                        (marked ? 'text-(--chapter-marker-active-color)' : 'text-(--chapter-marker-inactive-color)')
                                    }
                                >
                                    <Icon name="bookmark" size={14} filled={marked} className="mx-auto" />
                                </button>
                                <span
                                    className={'cursor-default overflow-hidden text-ellipsis select-none ' + status.text}
                                    title={`${chapter.title}\nDoubleclick to open the folder with your file manager`}
                                    onDoubleClick={() => {
                                        try {
                                            showChapterFolder(chapter);
                                        } catch (error) {
                                            notify(`Failed to open the folder: ${error.message}`, 'error');
                                        }
                                    }}
                                >
                                    {chapter.title}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>
            <StatusLine
                message={`Chapters: ${visible.length} / ${chapters.length}`}
                busy={!!manga && chaptersQuery.isPending}
                busyTitle={manga ? `Loading chapter list (${manga.title})` : ''}
            />
            <ConfirmDialog
                open={confirm !== null}
                title="Re-download existing chapter?"
                message={confirm ? `"${confirm.title}" is already downloaded.` : ''}
                confirmLabel="Re-download"
                onConfirm={() => {
                    if (confirm) {
                        queue([confirm]);
                    }
                    setConfirm(null);
                }}
                onCancel={() => setConfirm(null)}
            />
            <ConfirmDialog
                open={confirmAll !== null}
                title={confirmAll ? `Download ${confirmAll.length} new chapter(s) from the current chapter list?` : ''}
                confirmLabel="Download"
                onConfirm={() => {
                    if (confirmAll) {
                        queue(confirmAll);
                    }
                    setConfirmAll(null);
                }}
                onCancel={() => setConfirmAll(null)}
            />
        </section>
    );
}

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { markChapterRead } from '../engine.js';
import { useSelection } from '../selection.jsx';
import Icon from '../icon.jsx';
import { fetchPages, resolveChapter } from '../queries.js';
import { useToast } from '../notify.jsx';

const readerRoute = getRouteApi('/reader');

function PageImage({ src, index, width, padding }) {
    const retry = React.useRef(0);
    const onError = event => {
        // Classic imgError parity: retry 3x with a cache-busting query.
        if (retry.current < 3) {
            retry.current += 1;
            window.setTimeout(() => {
                event.target.src = src + (src.includes('?') ? '&' : '?') + Date.now();
            }, 1000);
        }
    };
    return (
        <img
            id={`rk-page-${index}`}
            className="rk-page mx-auto block"
            src={src}
            alt={`Page ${index + 1}`}
            onError={onError}
            style={{ width: `${width}%`, marginTop: `${padding}em`, marginBottom: `${padding}em` }}
        />
    );
}

function ToolbarButton({ title, onClick, children }) {
    return (
        <button
            type="button"
            title={title}
            onClick={onClick}
            className="rounded px-2 py-1 text-zinc-700 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
            {children}
        </button>
    );
}

export default function ReaderView() {
    const { notify } = useToast();
    const navigate = useNavigate();
    const { connector: connectorId, manga: mangaId, chapter: chapterId } = readerRoute.useSearch();
    const [mode, setMode] = React.useState('thumbs');
    const [startPage, setStartPage] = React.useState(0);
    const [imageWidth, setImageWidth] = React.useState(75);
    const [imagePadding, setImagePadding] = React.useState(2);
    const autoNext = React.useRef(false);
    const containerRef = React.useRef(null);

    const resolvedQuery = useQuery({
        queryKey: ['reader', connectorId, mangaId, chapterId],
        queryFn: () => resolveChapter(connectorId, mangaId, chapterId)
    });
    const resolved = resolvedQuery.data;
    const { selectManga } = useSelection();
    // Keep the panels coherent: resolving a deep link selects its manga.
    React.useEffect(() => {
        if (resolved) {
            selectManga(resolved.manga);
        }
    }, [resolved, selectManga]);
    const chapter = resolved ? resolved.chapters[resolved.index] : null;

    const pagesQuery = useQuery({
        queryKey: ['pages', connectorId, mangaId, chapterId],
        queryFn: () => fetchPages(chapter),
        enabled: !!chapter
    });
    const media = Array.isArray(pagesQuery.data) ? pagesQuery.data : [];

    const goChapters = () => {
        navigate({ to: '/chapters', search: { connector: connectorId, manga: mangaId } });
    };

    const openChapter = React.useCallback((targetIndex) => {
        const list = resolved ? resolved.chapters : [];
        if (targetIndex < 0 || targetIndex >= list.length) {
            return;
        }
        setMode('read');
        setStartPage(0);
        if (containerRef.current) {
            containerRef.current.scrollTop = 0;
        }
        navigate({
            to: '/reader',
            search: { connector: connectorId, manga: mangaId, chapter: list[targetIndex].id }
        });
    }, [resolved, connectorId, mangaId, navigate]);

    const closeReader = React.useCallback(() => {
        if (chapter) {
            markChapterRead(chapter);
        }
        goChapters();
    }, [chapter, connectorId, mangaId, navigate]);

    // Scroll to the opening page when entering read mode.
    React.useEffect(() => {
        if (mode === 'read') {
            const page = document.getElementById(`rk-page-${startPage}`);
            if (page) {
                page.scrollIntoView();
            } else if (containerRef.current) {
                containerRef.current.scrollTop = 0;
            }
            if (containerRef.current) {
                containerRef.current.focus();
            }
        }
    }, [mode, startPage, chapterId]);

    const zoom = next => {
        setImageWidth(Math.min(400, Math.max(25, next)));
    };

    const scrollMagic = React.useCallback((defaultDistance) => {
        const container = containerRef.current;
        if (!container) {
            return;
        }
        const images = [...container.querySelectorAll('.rk-page')];
        if (!images.length) {
            return;
        }
        if (images[images.length - 1].getBoundingClientRect().bottom - window.innerHeight < 1) {
            if (autoNext.current) {
                openChapter(resolved ? resolved.index + 1 : -1);
                return;
            }
            autoNext.current = true;
            notify('Press Space again for the next chapter.', 'info');
            window.setTimeout(() => {
                autoNext.current = false;
            }, 4000);
            return;
        }
        const inView = images.filter(image => {
            const rect = image.getBoundingClientRect();
            return rect.top <= window.innerHeight && rect.bottom > 1;
        });
        const target = inView[inView.length - 1] || images[0];
        if (target.getBoundingClientRect().top > 1) {
            target.scrollIntoView({ behavior: 'smooth' });
        } else if (window.innerHeight + 1 < target.getBoundingClientRect().bottom) {
            container.scrollBy({
                top: Math.min(defaultDistance, target.getBoundingClientRect().bottom - window.innerHeight),
                left: 0,
                behavior: 'smooth'
            });
        } else if (target.nextElementSibling) {
            target.nextElementSibling.scrollIntoView({ behavior: 'smooth' });
        }
    }, [notify, openChapter, resolved]);

    const onKeyDown = event => {
        const container = containerRef.current;
        const smooth = distance => {
            if (!container) {
                return;
            }
            let remaining = distance;
            const step = () => {
                if (Math.abs(remaining) < 1) {
                    return;
                }
                const delta = Math.sign(remaining) * Math.min(10, Math.abs(remaining));
                container.scrollBy({ top: delta });
                remaining -= delta;
                window.requestAnimationFrame(step);
            };
            window.requestAnimationFrame(step);
        };
        switch (true) {
            case event.code === 'ArrowUp' && !event.ctrlKey:
                smooth(-64);
                break;
            case event.code === 'ArrowDown' && !event.ctrlKey:
                smooth(64);
                break;
            case event.code === 'PageUp' && !event.ctrlKey:
                if (container) {
                    container.scrollBy({ top: -window.innerHeight * 0.95, left: 0, behavior: 'smooth' });
                }
                break;
            case event.code === 'PageDown' && !event.ctrlKey:
                if (container) {
                    container.scrollBy({ top: window.innerHeight * 0.95, left: 0, behavior: 'smooth' });
                }
                break;
            case event.code === 'ArrowRight' && !event.ctrlKey:
                openChapter(resolved ? resolved.index + 1 : -1);
                break;
            case event.code === 'ArrowLeft' && !event.ctrlKey:
                openChapter(resolved ? resolved.index - 1 : -1);
                break;
            case event.key === '*' && !event.ctrlKey:
                setImageWidth(100);
                break;
            case event.key === '/' && !event.ctrlKey:
                setImageWidth(75);
                break;
            case event.key === '+' && !event.ctrlKey:
                zoom(imageWidth + 15);
                break;
            case event.key === '-' && !event.ctrlKey:
                zoom(imageWidth - 15);
                break;
            case event.key === '+' && event.ctrlKey:
                setImagePadding(padding => Math.max(0, padding + 1));
                break;
            case event.key === '-' && event.ctrlKey:
                setImagePadding(padding => Math.max(0, padding - 1));
                break;
            case event.code === 'Escape' && !event.ctrlKey:
                closeReader();
                break;
            case event.code === 'Space' && !event.ctrlKey:
                event.preventDefault();
                scrollMagic(window.innerHeight * 0.8);
                break;
            default:
                break;
        }
    };

    if (resolvedQuery.isPending) {
        return <p className="text-sm text-zinc-500">Resolving chapter …</p>;
    }
    if (resolvedQuery.isError || !chapter) {
        return (
            <div className="space-y-3">
                <p className="text-sm text-red-600">Chapter not found.</p>
                <button
                    type="button"
                    onClick={goChapters}
                    className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
                >
                    Back to chapters
                </button>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col">
            <div className="flex flex-wrap items-center gap-2 pb-2">
                <button
                    type="button"
                    onClick={goChapters}
                    title="Back to chapter list"
                    className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
                >
                    <span className="flex items-center gap-1"><Icon name="back" size={12} /> Chapters</span>
                </button>
                <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{chapter.title}</h1>
                {mode === 'thumbs' ? (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">Pick a page to start reading</span>
                ) : (
                    <button
                        type="button"
                        onClick={() => setMode('thumbs')}
                        title="Back to thumbnails (ESC closes the reader)"
                        className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
                    >
                        Thumbnails
                    </button>
                )}
            </div>
            {pagesQuery.isPending && <p className="text-sm text-zinc-500">Loading pages …</p>}
            {pagesQuery.isError && <p className="text-sm text-red-600">Failed to load pages for this chapter.</p>}
            {mode === 'thumbs' && media.length > 0 && (
                <div ref={containerRef} tabIndex={0} onKeyDown={onKeyDown} className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] content-start gap-2 overflow-auto outline-none">
                    {media.map((page, index) => (
                        <button
                            key={`${index}-${String(page).slice(-32)}`}
                            type="button"
                            title={`Page ${index + 1}`}
                            onClick={() => {
                                setStartPage(index);
                                setMode('read');
                            }}
                            className="h-64 rounded-lg border border-zinc-200 bg-contain bg-center bg-no-repeat hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500"
                            style={{ backgroundImage: `url('${String(page).replace(/'/g, "\\'")}')` }}
                        />
                    ))}
                </div>
            )}
            {mode === 'read' && media.length > 0 && (
                <div className="relative min-h-0 flex-1">
                    <div className="absolute top-0 right-0 z-10 flex items-center gap-0.5 rounded-bl-lg bg-white/90 px-1 shadow dark:bg-zinc-900/90">
                        <ToolbarButton title="Previous chapter (ArrowLeft)" onClick={() => openChapter(resolved.index - 1)}><Icon name="chevronLeft" /></ToolbarButton>
                        <ToolbarButton title="Next chapter (ArrowRight)" onClick={() => openChapter(resolved.index + 1)}><Icon name="chevronRight" /></ToolbarButton>
                        <ToolbarButton title="Decrease spacing (CTRL -)" onClick={() => setImagePadding(padding => Math.max(0, padding - 1))}>&#8722;</ToolbarButton>
                        <ToolbarButton title="Increase spacing (CTRL +)" onClick={() => setImagePadding(padding => Math.max(0, padding + 1))}>+</ToolbarButton>
                        <ToolbarButton title="Zoom in (+)" onClick={() => zoom(imageWidth + 15)}>+</ToolbarButton>
                        <ToolbarButton title="Zoom out (-)" onClick={() => zoom(imageWidth - 15)}>&#8722;</ToolbarButton>
                        <ToolbarButton title="Default width (*)" onClick={() => setImageWidth(75)}>75%</ToolbarButton>
                        <ToolbarButton title="Fit width (/)" onClick={() => setImageWidth(100)}>100%</ToolbarButton>
                        <span className="px-1 text-xs text-zinc-500">{imageWidth}%</span>
                        <ToolbarButton title="Magic scroll (Space)" onClick={() => scrollMagic(window.innerHeight * 0.8)}><Icon name="magicScroll" /></ToolbarButton>
                        <ToolbarButton title="Close (ESC)" onClick={closeReader}><Icon name="close" /></ToolbarButton>
                    </div>
                    <div ref={containerRef} tabIndex={0} onKeyDown={onKeyDown} className="h-full overflow-auto bg-zinc-200 outline-none dark:bg-black">
                        {media.map((page, index) => (
                            <PageImage key={`${index}-${String(page).slice(-32)}`} src={page} index={index} width={imageWidth} padding={imagePadding} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

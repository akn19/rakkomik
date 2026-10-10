import React from 'react';
import { Outlet, useLocation } from '@tanstack/react-router';
import { hasActiveDownloads, subscribeAppClose, quitApp, isReaderEnabled, subscribeSettings } from './engine.js';
import { SelectionProvider } from './selection.jsx';
import { ConfirmDialog } from './dialog.jsx';
import MangaPanel from './MangaPanel.jsx';
import ChaptersPanel from './ChaptersPanel.jsx';
import MenuPopup from './menu.jsx';
import JobsBar from './jobs.jsx';
import Icon from './icon.jsx';

const THEME_KEY = 'rakkomik.theme';

// Remembered choice first, then the OS preference (classic had two frontends instead).
function initialDark() {
    try {
        const stored = window.localStorage.getItem(THEME_KEY);
        if (stored) {
            return stored === 'dark';
        }
    } catch {
        // storage can be unavailable; fall through to the OS preference
    }
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

const WINDOW_BUTTON = 'rk-icon rounded px-1.5 py-0.5 hover:bg-black/20';

function Titlebar({ dark, onToggleTheme }) {
    const hakuneko = typeof window !== 'undefined' ? window.hakuneko : undefined;
    const act = fn => () => {
        if (hakuneko) {
            fn(hakuneko).catch?.(() => undefined);
        }
    };
    return (
        <header className="rk-drag grid h-9 shrink-0 grid-cols-[1fr_auto_1fr] items-center bg-(--menu-control-background-color) px-2">
            <span className="flex items-center">
                <img src="/img/logo_s.png" alt="" className="h-6 w-6 rounded-sm" />
            </span>
            <span className="flex items-center gap-1 text-[11pt] font-medium text-(--text-color)">
                RakKomik
                <span className="rounded bg-amber-200 px-1 py-px text-[10px] font-bold uppercase text-amber-900">Beta</span>
            </span>
            <span className="rk-no-drag flex items-center justify-end gap-0.5">
                <button
                    type="button"
                    title="Toggle theme"
                    onClick={onToggleTheme}
                    className={WINDOW_BUTTON}
                >
                    <Icon name={dark ? 'sun' : 'moon'} size={14} />
                </button>
                <button
                    type="button"
                    title="Minimize window"
                    onClick={act(h => h.window.minimize())}
                    className={WINDOW_BUTTON}
                >
                    <Icon name="minimize" size={14} />
                </button>
                <button
                    type="button"
                    title="Maximize window"
                    onClick={act(async h => {
                        if (await h.window.isMaximized()) {
                            await h.window.unmaximize();
                        } else {
                            await h.window.maximize();
                        }
                    })}
                    className={WINDOW_BUTTON}
                >
                    <Icon name="maximize" size={13} />
                </button>
                <button
                    type="button"
                    title="Close window"
                    onClick={act(h => h.window.close())}
                    className="rk-icon rounded px-1.5 py-0.5 hover:bg-red-500 hover:text-white"
                >
                    <Icon name="close" size={14} />
                </button>
            </span>
        </header>
    );
}

export default function Shell() {
    const [dark, setDark] = React.useState(initialDark);
    const [menuOpen, setMenuOpen] = React.useState(false);
    const [confirmQuit, setConfirmQuit] = React.useState(false);
    const readerEnabled = React.useSyncExternalStore(subscribeSettings, isReaderEnabled);
    // The page viewer fills the whole content pane; other views keep a gutter.
    const onReader = useLocation().pathname === '/reader';
    // Classic jobs.html parity: confirm when downloads are still running.
    React.useEffect(() => subscribeAppClose(() => {
        if (hasActiveDownloads()) {
            setConfirmQuit(true);
        } else {
            quitApp();
        }
    }), []);

    const toggleTheme = () => {
        const next = !dark;
        setDark(next);
        try {
            window.localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
        } catch {
            // the choice just is not remembered
        }
    };

    return (
        <SelectionProvider>
            <div className={'flex h-full flex-col text-[10pt] text-(--text-color) ' + (dark ? 'dark' : '')}>
                <Titlebar dark={dark} onToggleTheme={toggleTheme} />
                <div className="flex min-h-0 flex-1">
                    <div
                        className={
                            'relative z-10 flex min-w-0 flex-col [border-right:var(--app-control-border)] [box-shadow:var(--app-control-shadow)] ' +
                            (readerEnabled ? 'shrink-0' : 'flex-1')
                        }
                    >
                        <div className="flex items-center bg-(--menu-control-background-color)">
                            <button
                                type="button"
                                title="Toggle menu"
                                onClick={() => setMenuOpen(open => !open)}
                                className="rk-button m-[0.25em]"
                            >
                                <Icon name="menu" size={28} />
                            </button>
                            <span className="text-[1.5em] font-bold text-(--menu-control-title-color)">RakKomik</span>
                        </div>
                        {menuOpen && <MenuPopup onClose={() => setMenuOpen(false)} />}
                        <div className="flex min-h-0 flex-1 [border-top:var(--app-control-border)] [border-bottom:var(--app-control-border)]">
                            <MangaPanel readerEnabled={readerEnabled} />
                            <ChaptersPanel readerEnabled={readerEnabled} />
                        </div>
                        <JobsBar />
                    </div>
                    {readerEnabled && (
                        <main className={'rk-content-bg min-w-0 flex-1 overflow-x-hidden overflow-y-auto ' + (onReader ? '' : 'p-4')}>
                            <React.Suspense fallback={<p className="text-(--text-color)">Loading view …</p>}>
                                <Outlet />
                            </React.Suspense>
                        </main>
                    )}
                </div>
                <ConfirmDialog
                    open={confirmQuit}
                    title="Downloads are still in progress."
                    message="Close application anyway?"
                    confirmLabel="Close"
                    onConfirm={() => {
                        setConfirmQuit(false);
                        quitApp();
                    }}
                    onCancel={() => setConfirmQuit(false)}
                />
            </div>
        </SelectionProvider>
    );
}

import React from 'react';
import { Link, Outlet } from '@tanstack/react-router';
import { getEngineStatus } from './engine.js';

const NAV_ITEMS = [
    { to: '/', name: 'Start' },
    { to: '/library', name: 'Library' },
    { to: '/downloads', name: 'Downloads' },
    { to: '/connectors', name: 'Connectors' },
    { to: '/bookmarks', name: 'Bookmarks' },
    { to: '/settings', name: 'Settings' }
];

function Titlebar({ dark, onToggleTheme }) {
    const hakuneko = typeof window !== 'undefined' ? window.hakuneko : undefined;
    const act = fn => () => {
        if (hakuneko) {
            fn(hakuneko).catch?.(() => undefined);
        }
    };
    return (
        <header className="rk-drag flex h-10 shrink-0 items-center justify-between bg-zinc-100 px-3 dark:bg-zinc-900">
            <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tracking-wide text-zinc-800 dark:text-zinc-100">RakKomik</span>
                <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-900 dark:bg-amber-900 dark:text-amber-100">Beta</span>
            </div>
            <div className="rk-no-drag flex items-center gap-1">
                <button
                    type="button"
                    title="Toggle theme"
                    onClick={onToggleTheme}
                    className="rounded px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                    {dark ? '\u25D0' : '\u25D1'}
                </button>
                <button
                    type="button"
                    title="Minimize window"
                    onClick={act(h => h.window.minimize())}
                    className="rounded px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <line x1="1" y1="6" x2="11" y2="6" />
                    </svg>
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
                    className="rounded px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="2" y="2" width="8" height="8" />
                    </svg>
                </button>
                <button
                    type="button"
                    title="Close window"
                    onClick={act(h => h.window.close())}
                    className="rounded px-2 py-1 text-sm text-zinc-600 hover:bg-red-500 hover:text-white dark:text-zinc-300"
                >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <line x1="2" y1="2" x2="10" y2="10" />
                        <line x1="10" y1="2" x2="2" y2="10" />
                    </svg>
                </button>
            </div>
        </header>
    );
}

function Sidebar({ connectorCount }) {
    const linkClass = 'block rounded px-3 py-2 text-left text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900';
    const activeClass = 'block rounded px-3 py-2 text-left text-sm bg-zinc-200 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50';
    return (
        <nav className="flex w-48 shrink-0 flex-col gap-1 bg-zinc-50 p-2 dark:bg-zinc-950">
            {NAV_ITEMS.map(item => (
                <Link
                    key={item.to}
                    to={item.to}
                    className={linkClass}
                    activeProps={{ className: activeClass }}
                >
                    {item.name}
                    {item.to === '/connectors' && (
                        <span className="ml-2 rounded-full bg-zinc-200 px-2 py-0.5 text-xs dark:bg-zinc-800">
                            {connectorCount}
                        </span>
                    )}
                </Link>
            ))}
        </nav>
    );
}

export default function Shell() {
    const [dark, setDark] = React.useState(true);
    const { connectors, version } = getEngineStatus();
    return (
        <div className={'flex h-full flex-col text-sm ' + (dark ? 'dark' : '')}>
            <Titlebar dark={dark} onToggleTheme={() => setDark(value => !value)} />
            <div className="flex min-h-0 flex-1">
                <Sidebar connectorCount={connectors} />
                <main className="flex-1 overflow-auto bg-zinc-100 p-6 dark:bg-black">
                    <Outlet />
                </main>
            </div>
            <footer className="flex shrink-0 items-center justify-between bg-zinc-100 px-3 py-1 text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <span>React shell (Beta)</span>
                <span>{version}</span>
            </footer>
        </div>
    );
}

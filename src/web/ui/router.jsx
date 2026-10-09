import React from 'react';
import { createHashHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import Shell from './shell.jsx';

// Route-based splitting (audit §5.7): the initial bundle holds only the
// shell; each view loads on demand when its route opens.
const StartView = React.lazy(() => import('./views/Start.jsx'));
const LibraryView = React.lazy(() => import('./views/Library.jsx'));
const ChaptersView = React.lazy(() => import('./views/Chapters.jsx'));
const ReaderView = React.lazy(() => import('./views/Reader.jsx'));
const DownloadsView = React.lazy(() => import('./views/Downloads.jsx'));
const ConnectorsView = React.lazy(() => import('./views/Connectors.jsx'));
const BookmarksView = React.lazy(() => import('./views/BookmarksView.jsx'));
const SettingsView = React.lazy(() => import('./views/SettingsView.jsx'));

// Hash history: the app runs on a custom scheme (hakuneko://), not http,
// so path history is unusable (audit §5.2).
const rootRoute = createRootRoute({ component: Shell });

const startRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: StartView });
const libraryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/library',
    component: LibraryView
});
const chaptersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/chapters',
    validateSearch: search => ({
        connector: typeof search.connector === 'string' ? search.connector : '',
        manga: typeof search.manga === 'string' ? search.manga : ''
    }),
    component: ChaptersView
});
const downloadsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/downloads',
    component: DownloadsView
});
const connectorsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/connectors',
    component: ConnectorsView
});
const bookmarksRoute = createRoute({ getParentRoute: () => rootRoute, path: '/bookmarks', component: BookmarksView });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsView });

const readerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/reader',
    validateSearch: search => ({
        connector: typeof search.connector === 'string' ? search.connector : '',
        manga: typeof search.manga === 'string' ? search.manga : '',
        chapter: typeof search.chapter === 'string' ? search.chapter : ''
    }),
    component: ReaderView
});
const routeTree = rootRoute.addChildren([
    startRoute,
    libraryRoute,
    chaptersRoute,
    readerRoute,
    downloadsRoute,
    connectorsRoute,
    bookmarksRoute,
    settingsRoute
]);

const router = createRouter({ routeTree, history: createHashHistory() });

export default function AppRouter() {
    return <RouterProvider router={router} />;
}

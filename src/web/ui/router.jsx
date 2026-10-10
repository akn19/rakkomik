import React from 'react';
import { createHashHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import Shell from './shell.jsx';

// Route-based splitting (audit §5.7): the initial bundle holds only the
// shell; each view loads on demand when its route opens.
const StartView = React.lazy(() => import('./views/Start.jsx'));
const ReaderView = React.lazy(() => import('./views/Reader.jsx'));
const DownloadsView = React.lazy(() => import('./views/Downloads.jsx'));
const BookmarksView = React.lazy(() => import('./views/BookmarksView.jsx'));

// Hash history: the app runs on a custom scheme, not http,
// so path history is unusable (audit §5.2).
const rootRoute = createRootRoute({ component: Shell });

const startRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: StartView });
const downloadsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/downloads',
    component: DownloadsView
});
const bookmarksRoute = createRoute({ getParentRoute: () => rootRoute, path: '/bookmarks', component: BookmarksView });

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
    readerRoute,
    downloadsRoute,
    bookmarksRoute
]);

const router = createRouter({ routeTree, history: createHashHistory() });

export default function AppRouter() {
    return <RouterProvider router={router} />;
}

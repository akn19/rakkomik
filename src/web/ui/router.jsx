import { createHashHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import Shell from './shell.jsx';
import StartView from './views/Start.jsx';
import ReaderView from './views/Reader.jsx';
import DownloadsView from './views/Downloads.jsx';
import BookmarksView from './views/BookmarksView.jsx';

// The views are imported statically on purpose, so the whole interface is `ui.js` + `ui.css`.
// A lazy view is a separate file with a hashed name, and an open window asks for the name from the build it
// loaded. When `ui/dist` is rebuilt or the web part is updated underneath that window, opening a view fails with
// "Failed to fetch dynamically imported module". The app reads from local disk, so splitting saves no download.

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

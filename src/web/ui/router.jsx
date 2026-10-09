import { createHashHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import Shell from './shell.jsx';
import StartView from './views/Start.jsx';
import PlaceholderView from './views/Placeholder.jsx';
import LibraryView from './views/Library.jsx';
import ChaptersView from './views/Chapters.jsx';
import ReaderView from './views/Reader.jsx';
import BookmarksView from './views/BookmarksView.jsx';
import SettingsView from './views/SettingsView.jsx';

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
    component: () => <PlaceholderView title="downloads" note="The download queue arrives in a later slice." />
});
const connectorsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/connectors',
    component: () => <PlaceholderView title="connectors" note="Connector management arrives in a later slice." />
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

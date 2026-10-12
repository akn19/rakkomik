// Rendering helpers: the providers that the application puts around its components, and a real router (in memory) for
// the components that navigate or read the address.
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    Outlet,
    RouterProvider,
} from '@tanstack/react-router';
import { queryClient } from '../../queries.js';
import { ToastProvider } from '../../notify.jsx';
import { SelectionProvider } from '../../selection.jsx';

// The query cache outlives a test unless it is emptied, and only once the components are gone: a component that is still
// mounted puts its data back (hooks run in reverse order, so Testing Library's own cleanup would come after this one).
afterEach(() => {
    cleanup();
    queryClient.clear();
});

function Providers({ children, selection }) {
    const content = selection ? <SelectionProvider>{children}</SelectionProvider> : children;
    return (
        <QueryClientProvider client={queryClient}>
            <ToastProvider>{content}</ToastProvider>
        </QueryClientProvider>
    );
}

/**
 * Render a component in the providers of the application (query cache, toasts and, unless asked not to, the selection).
 */
export function renderWithProviders(ui, { selection = true, ...options } = {}) {
    return render(ui, {
        wrapper: ({ children }) => <Providers selection={selection}>{children}</Providers>,
        ...options,
    });
}

/**
 * Render a component inside a real router with an in-memory history, so that `useNavigate`, `useSearch` and
 * `useLocation` work. Resolves when the first route is rendered.
 * @param {React.ReactElement} ui
 * @param {object} [options]
 * @param {string} [options.url] the address to start at, e.g. `/reader?chapter=c1`
 * @param {boolean} [options.selection] wrap the component in the selection provider (default true)
 * @param {object[]} [options.routes] more routes, `{ path, element }` each, to navigate to
 * @returns {Promise<{ router: object } & ReturnType<typeof render>>}
 */
export async function renderRouted(ui, { url = '/', selection = true, routes = [] } = {}) {
    const rootRoute = createRootRoute({
        component: () => (
            <Providers selection={selection}>
                <Outlet />
            </Providers>
        ),
    });
    const children = [
        createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => ui }),
        ...routes.map((route) =>
            createRoute({
                getParentRoute: () => rootRoute,
                path: route.path,
                // the search parameters pass through untouched, as strings
                validateSearch: (search) => ({ ...search }),
                component: () => route.element,
            }),
        ),
    ];
    const router = createRouter({
        routeTree: rootRoute.addChildren(children),
        history: createMemoryHistory({ initialEntries: [url] }),
    });
    await router.load();
    let utils = null;
    await act(async () => {
        utils = render(<RouterProvider router={router} />);
    });
    return { router, ...utils };
}

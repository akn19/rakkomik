import { act, fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider, useToast } from '../notify.jsx';

// mounts the provider and hands out its API, which is what the views call
function mountToasts() {
    const api = {};
    function Probe() {
        Object.assign(api, useToast());
        return null;
    }
    render(
        <ToastProvider>
            <Probe />
        </ToastProvider>
    );
    return api;
}

function toastOf(message) {
    return screen.getByText(message).closest('.pointer-events-auto');
}

describe('toasts', () => {
    it('should show a message, and remove it with its close button', () => {
        const api = mountToasts();
        act(() => {
            api.notify('Settings saved.', 'success');
        });
        expect(screen.getByText('Settings saved.')).toBeTruthy();
        fireEvent.click(screen.getByTitle('Dismiss'));
        expect(screen.queryByText('Settings saved.')).toBeNull();
    });

    it('should remove a message by itself after four seconds, and not before', () => {
        vi.useFakeTimers();
        const api = mountToasts();
        act(() => {
            api.notify('Bookmark removed.');
        });
        act(() => {
            vi.advanceTimersByTime(3999);
        });
        expect(screen.queryByText('Bookmark removed.')).not.toBeNull();
        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(screen.queryByText('Bookmark removed.')).toBeNull();
    });

    it('should keep the messages in the order they came and dismiss only the one that is asked for', () => {
        const api = mountToasts();
        let first = null;
        let second = null;
        act(() => {
            first = api.notify('first');
            second = api.notify('second');
            api.notify('third');
        });
        expect(first).not.toBe(second);
        expect(screen.getAllByText(/^(first|second|third)$/).map(node => node.textContent)).toEqual(['first', 'second', 'third']);
        act(() => {
            api.dismiss(second);
        });
        expect(screen.getAllByText(/^(first|second|third)$/).map(node => node.textContent)).toEqual(['first', 'third']);
    });

    it('should not fail when a message that is gone is dismissed again, or removed by its own timer after a click', () => {
        vi.useFakeTimers();
        const api = mountToasts();
        let id = null;
        act(() => {
            id = api.notify('once');
        });
        fireEvent.click(screen.getByTitle('Dismiss'));
        expect(() => act(() => {
            api.dismiss(id);
            vi.advanceTimersByTime(5000);
        })).not.toThrow();
        expect(screen.queryByText('once')).toBeNull();
    });

    it('should tell errors, successes and plain information apart', () => {
        const api = mountToasts();
        act(() => {
            api.notify('bad', 'error');
            api.notify('good', 'success');
            api.notify('plain', 'info');
            api.notify('unspecified');
            api.notify('odd', 'something else');
        });
        expect(toastOf('bad').className).toMatch(/red/);
        expect(toastOf('good').className).toMatch(/green/);
        expect(toastOf('plain').className).not.toMatch(/red|green/);
        expect(toastOf('unspecified').className).toBe(toastOf('plain').className);
        expect(toastOf('odd').className).toBe(toastOf('plain').className);
    });

    it('should hand out the same functions on every render, because views list them as dependencies of their effects', () => {
        const api = mountToasts();
        const { notify, dismiss } = api;
        act(() => {
            api.notify('anything');
        });
        expect(api.notify).toBe(notify);
        expect(api.dismiss).toBe(dismiss);
    });

    it('should refuse to be used outside of its provider', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        function Lonely() {
            useToast();
            return null;
        }
        expect(() => render(<Lonely />)).toThrow('useToast() must be used inside <ToastProvider>!');
        error.mockRestore();
    });
});

describe('toasts for the screen reader', () => {
    it('should announce an error at once, and the other messages when it is quiet', () => {
        const api = mountToasts();
        act(() => {
            api.notify('bad', 'error');
            api.notify('good', 'success');
            api.notify('plain');
        });
        expect(toastOf('bad').getAttribute('role')).toBe('alert');
        expect(toastOf('good').getAttribute('role')).toBe('status');
        expect(toastOf('plain').getAttribute('role')).toBe('status');
    });

    it('should keep an error until it is dismissed, so that it can be read', () => {
        vi.useFakeTimers();
        const api = mountToasts();
        act(() => {
            api.notify('Failed to update manga list', 'error');
        });
        act(() => {
            vi.advanceTimersByTime(60000);
        });
        expect(screen.getByText('Failed to update manga list')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss this message' }));
        expect(screen.queryByText('Failed to update manga list')).toBeNull();
    });
});

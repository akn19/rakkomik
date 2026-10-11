import { fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from '../dialog.jsx';

function dialog(props = {}) {
    const handlers = { onConfirm: vi.fn(), onCancel: vi.fn() };
    render(<ConfirmDialog open title="Remove bookmark?" {...handlers} {...props} />);
    return handlers;
}

describe('confirm dialog', () => {
    it('should draw nothing while it is closed', () => {
        const { container } = render(<ConfirmDialog open={false} title="Hidden" onConfirm={vi.fn()} onCancel={vi.fn()} />);
        expect(container.innerHTML).toBe('');
    });

    it('should show the title and the message, with the default labels', () => {
        dialog({ message: 'It will be gone.' });
        expect(screen.getByRole('heading').textContent).toBe('Remove bookmark?');
        expect(screen.getByText('It will be gone.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    });

    it('should show the labels it is given instead of the defaults', () => {
        dialog({ confirmLabel: 'Close', cancelLabel: 'Stay' });
        expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Stay' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    });

    it('should leave out the paragraph when there is no message', () => {
        const { container } = render(<ConfirmDialog open title="Only a title" onConfirm={vi.fn()} onCancel={vi.fn()} />);
        expect(container.querySelector('p')).toBeNull();
    });

    it('should report the choice that was made, and nothing else', () => {
        const confirmed = dialog();
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(confirmed.onConfirm).toHaveBeenCalledTimes(1);
        expect(confirmed.onCancel).not.toHaveBeenCalled();
    });

    it('should report a cancellation', () => {
        const cancelled = dialog();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(cancelled.onCancel).toHaveBeenCalledTimes(1);
        expect(cancelled.onConfirm).not.toHaveBeenCalled();
    });
});

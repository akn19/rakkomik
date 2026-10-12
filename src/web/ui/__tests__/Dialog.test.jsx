import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from '../dialog.jsx';

function dialog(props = {}) {
    const handlers = { onConfirm: vi.fn(), onCancel: vi.fn() };
    render(<ConfirmDialog open title="Remove bookmark?" {...handlers} {...props} />);
    return handlers;
}

describe('confirm dialog', () => {
    it('should draw nothing while it is closed', () => {
        const { container } = render(
            <ConfirmDialog open={false} title="Hidden" onConfirm={vi.fn()} onCancel={vi.fn()} />,
        );
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
        const { container } = render(
            <ConfirmDialog open title="Only a title" onConfirm={vi.fn()} onCancel={vi.fn()} />,
        );
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

describe('confirm dialog for the keyboard and the screen reader', () => {
    it('should be a modal dialog that is named by its title and described by its message', () => {
        dialog({ message: 'It will be gone.' });
        const element = screen.getByRole('dialog', { name: 'Remove bookmark?' });
        expect(element.getAttribute('aria-modal')).toBe('true');
        expect(element.getAttribute('aria-labelledby')).toBe(screen.getByRole('heading').id);
        expect(element.getAttribute('aria-describedby')).toBe(
            screen.getByText('It will be gone.').id,
        );
    });

    it('should describe nothing when there is no message', () => {
        dialog();
        expect(screen.getByRole('dialog').getAttribute('aria-describedby')).toBeNull();
    });

    it('should give the focus to the cancel button when it opens, and back to the opener when it closes', () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();
        const props = { title: 'Question', onConfirm: vi.fn(), onCancel: vi.fn() };
        const { rerender } = render(<ConfirmDialog open {...props} />);
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
        rerender(<ConfirmDialog open={false} {...props} />);
        expect(document.activeElement).toBe(opener);
        opener.remove();
    });

    it('should cancel with Escape', () => {
        const handlers = dialog();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(handlers.onCancel).toHaveBeenCalledTimes(1);
        expect(handlers.onConfirm).not.toHaveBeenCalled();
    });

    it('should keep Tab inside: from the last button round to the first, and back with Shift', async () => {
        const user = userEvent.setup();
        dialog();
        const cancel = screen.getByRole('button', { name: 'Cancel' });
        const confirm = screen.getByRole('button', { name: 'Delete' });
        expect(document.activeElement).toBe(cancel);
        await user.tab();
        expect(document.activeElement).toBe(confirm);
        await user.tab();
        expect(document.activeElement).toBe(cancel);
        await user.tab({ shift: true });
        expect(document.activeElement).toBe(confirm);
    });

    it('should not listen for keys while it is closed', () => {
        const onCancel = vi.fn();
        render(
            <ConfirmDialog open={false} title="Hidden" onConfirm={vi.fn()} onCancel={onCancel} />,
        );
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onCancel).not.toHaveBeenCalled();
    });
});

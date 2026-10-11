import { render, screen } from '@testing-library/react';
import StatusLine from '../status.jsx';

describe('status line', () => {
    it('should show the message, and no spinner while nothing is going on', () => {
        const { container } = render(<StatusLine message="Mangas: 3 / 10" />);
        expect(screen.getByText('Mangas: 3 / 10')).toBeTruthy();
        expect(container.querySelector('svg')).toBeNull();
    });

    it('should show a spinner, which names the running task in its tooltip, while it is busy', () => {
        const { container } = render(<StatusLine message="Updating…" busy busyTitle="Loading manga list (Site)" />);
        expect(screen.getByText('Updating…')).toBeTruthy();
        expect(screen.getByTitle('Loading manga list (Site)')).toBeTruthy();
        expect(container.querySelector('svg').classList.contains('animate-spin')).toBe(true);
    });

    it('should follow the message when it changes', () => {
        const { rerender } = render(<StatusLine message="first" />);
        rerender(<StatusLine message="second" />);
        expect(screen.queryByText('first')).toBeNull();
        expect(screen.getByText('second')).toBeTruthy();
    });
});

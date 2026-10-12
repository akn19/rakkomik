import React from 'react';

// what the keyboard can reach inside a dialog
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

function focusable(dialog) {
    return [...dialog.querySelectorAll(FOCUSABLE)].filter(element => !element.disabled && element.tabIndex >= 0 && !element.hidden);
}

/**
 * The keyboard of a dialog (WAI-ARIA dialog pattern): the focus moves into it when it opens and goes back to the element
 * that opened it when it closes, Tab stays inside, and Escape asks to close. One listener on the window, which always
 * calls the `onClose` it was last given.
 * @param {object} options
 * @param {boolean} options.open
 * @param {function(): void} options.onClose
 * @param {React.RefObject} [options.initialFocus] the element that takes the focus when the dialog opens (default: the dialog)
 * @returns {React.RefObject} to put on the element of the dialog
 */
export function useDialog({ open, onClose, initialFocus }) {
    const ref = React.useRef(null);
    const onCloseRef = React.useRef(onClose);
    React.useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);
    React.useEffect(() => {
        if (!open) {
            return undefined;
        }
        const dialog = ref.current;
        const opener = document.activeElement;
        const first = (initialFocus && initialFocus.current) || dialog;
        if (first && typeof first.focus === 'function') {
            first.focus();
        }
        const onKeyDown = event => {
            if (event.key === 'Escape') {
                onCloseRef.current();
                return;
            }
            if (event.key !== 'Tab' || !dialog) {
                return;
            }
            const elements = focusable(dialog);
            if (elements.length === 0) {
                event.preventDefault();
                dialog.focus();
                return;
            }
            const active = document.activeElement;
            // from the dialog itself (it has the focus when it opens) Tab goes to the first control, Shift+Tab to the last
            const outside = active === dialog || !dialog.contains(active);
            if (event.shiftKey && (outside || active === elements[0])) {
                event.preventDefault();
                elements[elements.length - 1].focus();
            } else if (!event.shiftKey && (outside || active === elements[elements.length - 1])) {
                event.preventDefault();
                elements[0].focus();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            if (opener && opener.isConnected && typeof opener.focus === 'function') {
                opener.focus();
            }
        };
    }, [open, initialFocus]);
    return ref;
}

/**
 * Minimal owned confirm dialog (shadcn-Dialog-style API, zero extra deps).
 * Rendered inline where needed; overlay blocks interaction while open. The cancel button has the focus to begin with,
 * so that Enter does nothing that cannot be undone.
 */
export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel, onConfirm, onCancel }) {
    const id = React.useId();
    const cancelRef = React.useRef(null);
    const ref = useDialog({ open, onClose: onCancel, initialFocus: cancelRef });
    if (!open) {
        return null;
    }
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div
                ref={ref}
                role="dialog"
                aria-modal="true"
                aria-labelledby={`${id}-title`}
                aria-describedby={message ? `${id}-message` : undefined}
                tabIndex={-1}
                className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            >
                <h2 id={`${id}-title`} className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
                {message && (
                    <p id={`${id}-message`} className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{message}</p>
                )}
                <div className="mt-4 flex justify-end gap-2">
                    <button
                        ref={cancelRef}
                        type="button"
                        onClick={onCancel}
                        className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                        {cancelLabel || 'Cancel'}
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                    >
                        {confirmLabel || 'Delete'}
                    </button>
                </div>
            </div>
        </div>
    );
}

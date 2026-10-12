import React from 'react';
import Icon from './icon.jsx';

/**
 * Classic status.html parity: footer message with a spinner (and the
 * running task as tooltip, which a screen reader reads as the name of the spinner) while a list is loading or updating.
 */
export default function StatusLine({ message, busy, busyTitle }) {
    return (
        <div className="flex items-center gap-[0.25em]">
            {busy && (
                <span
                    title={busyTitle}
                    role="img"
                    aria-label={busyTitle || 'Busy'}
                    className="rk-icon"
                >
                    <Icon name="spinner" size={12} spin />
                </span>
            )}
            <span>{message}</span>
        </div>
    );
}

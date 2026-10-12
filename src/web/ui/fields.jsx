import React from 'react';
import Icon from './icon.jsx';

// Classic input.html parity: flat accent-underlined fields (see `.rk-field`).
// Every field takes the `id` that its label points to and `describedBy`, the id of the text that explains it.
const TEXT = 'rk-field w-[calc(100%-0.5em)]';

export function TextField({ value, onChange, disabled, readOnly, title, id, label, describedBy }) {
    return (
        <input
            type="text"
            id={id}
            className={TEXT}
            value={value ?? ''}
            title={title}
            aria-label={label}
            aria-describedby={describedBy}
            disabled={disabled}
            readOnly={readOnly}
            onChange={event => onChange(event.target.value)}
        />
    );
}

export function PasswordField({ value, onChange, title, id, describedBy }) {
    return (
        <input
            type="password"
            id={id}
            className={TEXT}
            value={value ?? ''}
            title={title}
            aria-describedby={describedBy}
            onChange={event => onChange(event.target.value)}
        />
    );
}

export function NumberField({ value, min, max, onChange, id, describedBy }) {
    return (
        <input
            type="number"
            id={id}
            className="rk-field w-[4em]"
            value={value ?? ''}
            min={min}
            max={max}
            aria-describedby={describedBy}
            onChange={event => onChange(event.target.value === '' ? '' : Number(event.target.value))}
        />
    );
}

export function SelectField({ value, options, onChange, id, describedBy }) {
    return (
        <select
            id={id}
            className="rk-field rk-field-select w-[calc(100%-0.5em)]"
            value={value ?? ''}
            aria-describedby={describedBy}
            onChange={event => onChange(event.target.value)}
        >
            {(options || []).map(option => (
                <option key={String(option.value)} value={option.value}>
                    {option.name}
                </option>
            ))}
        </select>
    );
}

export function CheckboxField({ value, onChange, id, describedBy }) {
    return (
        <input
            type="checkbox"
            id={id}
            className="m-[0.5em]"
            checked={!!value}
            aria-describedby={describedBy}
            onChange={event => onChange(event.target.checked)}
        />
    );
}

/**
 * A path that is chosen with a dialog: the field shows it and can be read (and copied) but not typed in, the button
 * next to it opens the dialog. `browseLabel` names the button for a screen reader (the tooltip is `browseTitle`).
 */
export function PathField({ value, onBrowse, browseTitle, browseLabel, disabled, id, describedBy }) {
    return (
        <div className="flex items-center">
            <div className="min-w-0 flex-1">
                <TextField value={value} onChange={() => undefined} readOnly title={value} id={id} describedBy={describedBy} />
            </div>
            <button
                type="button"
                title={browseTitle || 'Browse …'}
                aria-label={browseLabel || browseTitle || 'Browse …'}
                disabled={disabled}
                onClick={onBrowse}
                className="rk-icon m-[0.25em] shrink-0 cursor-pointer disabled:opacity-60"
            >
                <Icon name="folder" size={16} />
            </button>
        </div>
    );
}

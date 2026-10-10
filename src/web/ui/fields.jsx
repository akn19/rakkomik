import React from 'react';
import Icon from './icon.jsx';

// Classic input.html parity: flat accent-underlined fields (see `.rk-field`).
const TEXT = 'rk-field w-[calc(100%-0.5em)]';

export function TextField({ value, onChange, disabled, title }) {
    return (
        <input
            type="text"
            className={TEXT}
            value={value ?? ''}
            title={title}
            disabled={disabled}
            onChange={event => onChange(event.target.value)}
        />
    );
}

export function PasswordField({ value, onChange, title }) {
    return (
        <input
            type="password"
            className={TEXT}
            value={value ?? ''}
            title={title}
            onChange={event => onChange(event.target.value)}
        />
    );
}

export function NumberField({ value, min, max, onChange }) {
    return (
        <input
            type="number"
            className="rk-field w-[4em]"
            value={value ?? ''}
            min={min}
            max={max}
            onChange={event => onChange(event.target.value === '' ? '' : Number(event.target.value))}
        />
    );
}

export function SelectField({ value, options, onChange }) {
    return (
        <select
            className="rk-field rk-field-select w-[calc(100%-0.5em)]"
            value={value ?? ''}
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

export function CheckboxField({ value, onChange }) {
    return (
        <input
            type="checkbox"
            className="m-[0.5em]"
            checked={!!value}
            onChange={event => onChange(event.target.checked)}
        />
    );
}

export function PathField({ value, onBrowse, browseTitle, disabled }) {
    return (
        <div className="flex items-center">
            <div className="min-w-0 flex-1">
                <TextField value={value} onChange={() => undefined} disabled title={value} />
            </div>
            <button
                type="button"
                title={browseTitle || 'Browse …'}
                disabled={disabled}
                onClick={onBrowse}
                className="rk-icon m-[0.25em] shrink-0 cursor-pointer disabled:opacity-60"
            >
                <Icon name="folder" size={16} />
            </button>
        </div>
    );
}

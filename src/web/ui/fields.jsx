import React from 'react';

const CONTROL = 'w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-800 disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200';

export function TextField({ value, onChange, disabled, title }) {
    return (
        <input
            type="text"
            className={CONTROL}
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
            className={CONTROL}
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
            className={CONTROL}
            value={value ?? ''}
            min={min}
            max={max}
            onChange={event => onChange(event.target.value === '' ? '' : Number(event.target.value))}
        />
    );
}

export function SelectField({ value, options, onChange }) {
    return (
        <select className={CONTROL} value={value ?? ''} onChange={event => onChange(event.target.value)}>
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
            className="h-4 w-4 accent-zinc-700 dark:accent-zinc-300"
            checked={!!value}
            onChange={event => onChange(event.target.checked)}
        />
    );
}

export function PathField({ value, onBrowse, browseTitle, disabled }) {
    return (
        <div className="flex gap-2">
            <div className="flex-1">
                <TextField value={value} onChange={() => undefined} disabled title={value} />
            </div>
            <button
                type="button"
                title={browseTitle || 'Browse …'}
                disabled={disabled}
                onClick={onBrowse}
                className="shrink-0 rounded border border-zinc-300 px-2 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
                &#128193;
            </button>
        </div>
    );
}

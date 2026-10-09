import React from 'react';
import { getSettingsDraft, saveSettingsDraft, browseDirectory, browseFile } from '../engine.js';
import { useToast } from '../notify.jsx';
import { TextField, PasswordField, NumberField, SelectField, CheckboxField, PathField } from '../fields.jsx';

function SettingControl({ item, onChange }) {
    const ref = item.ref;
    switch (ref.input) {
        case 'password':
            return <PasswordField value={item.value} title={ref.description} onChange={onChange} />;
        case 'numeric':
            return <NumberField value={item.value} min={ref.min} max={ref.max} onChange={onChange} />;
        case 'select':
            return <SelectField value={item.value} options={ref.options} onChange={onChange} />;
        case 'checkbox':
            return <CheckboxField value={item.value} onChange={onChange} />;
        case 'file':
            return (
                <PathField
                    value={item.value}
                    browseTitle="Choose file …"
                    onBrowse={async () => {
                        const path = await browseFile();
                        if (path) {
                            onChange(path);
                        }
                    }}
                />
            );
        case 'directory':
            return (
                <PathField
                    value={item.value}
                    browseTitle="Browse …"
                    onBrowse={async () => {
                        const path = await browseDirectory(item.value);
                        if (path) {
                            onChange(path);
                        }
                    }}
                />
            );
        case 'disabled':
            return <TextField value={item.value} title={item.value} disabled onChange={() => undefined} />;
        case 'text':
        default:
            return <TextField value={item.value} title={ref.description} onChange={onChange} />;
    }
}

export default function SettingsView() {
    const { notify } = useToast();
    const [draft, setDraft] = React.useState(() => getSettingsDraft());
    const [saving, setSaving] = React.useState(false);

    const updateItem = (category, ref, value) => {
        setDraft(current => current.map(group => {
            if (group.category !== category) {
                return group;
            }
            return {
                ...group,
                items: group.items.map(item => item.ref === ref ? { ...item, value } : item)
            };
        }));
    };

    const reset = () => {
        try {
            setDraft(getSettingsDraft());
            notify('Settings reloaded.', 'info');
        } catch (error) {
            notify(`Failed to reload settings: ${error.message}`, 'error');
        }
    };

    const save = async () => {
        setSaving(true);
        try {
            await saveSettingsDraft(draft);
            notify('Settings saved.', 'success');
        } catch (error) {
            notify(`Failed to save settings: ${error.message}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="mx-auto max-w-3xl space-y-6 pb-8">
            {draft.map(group => (
                <section
                    key={group.category}
                    className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900"
                >
                    <h2 className="text-base font-semibold">{group.category}</h2>
                    <div className="mt-3 space-y-4">
                        {group.items.map(item => (
                            <div key={item.ref.label}>
                                <label className="mb-1 block text-sm font-medium">{item.ref.label}</label>
                                <SettingControl
                                    item={item}
                                    onChange={value => updateItem(group.category, item.ref, value)}
                                />
                                {item.ref.description && (
                                    <p className="mt-1 whitespace-pre-line text-xs text-zinc-500 dark:text-zinc-400">
                                        {item.ref.description}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                </section>
            ))}
            <div className="flex justify-end gap-2">
                <button
                    type="button"
                    onClick={reset}
                    disabled={saving}
                    className="rounded border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                    Reset
                </button>
                <button
                    type="button"
                    onClick={save}
                    disabled={saving}
                    className="rounded bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                    {saving ? 'Saving …' : 'Save'}
                </button>
            </div>
        </div>
    );
}

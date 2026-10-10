import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
    getSettingsDraft,
    saveSettingsDraft,
    getVersionInfo,
    openExternalLink,
    browseDirectory,
    browseFile,
    importBookmarksFile
} from './engine.js';
import { useToast } from './notify.jsx';
import { useConnectors } from './connectorsState.js';
import { TextField, PasswordField, NumberField, SelectField, CheckboxField, PathField } from './fields.jsx';
import Icon from './icon.jsx';

const VIEWS = [
    { to: '/', name: 'Start' },
    { to: '/downloads', name: 'Downloads' },
    { to: '/bookmarks', name: 'Bookmarks' }
];

const HELP_LINKS = [
    { icon: 'home', title: 'Visit the RakKomik Homepage', href: 'https://github.com/akn19/rakkomik' },
    { icon: 'book', title: 'Read the Online Documentation', href: 'https://github.com/akn19/rakkomik#readme' },
    { icon: 'bug', title: 'Open a Ticket on GitHub', href: 'https://github.com/akn19/rakkomik/issues' },
    { icon: 'streetView', title: 'Show your external IP and Geolocation', href: 'https://ipinfo.io/json' }
];

function Separator({ children }) {
    return (
        <div className="rk-separator pt-[0.5em] pb-[0.25em] pl-[0.5em] font-bold uppercase text-(--menu-control-category-color)">
            {children}
        </div>
    );
}

function ExternalLink({ href, title, children }) {
    return (
        <a
            title={title || href}
            onClick={() => openExternalLink(href)}
            className="cursor-pointer text-(--menu-credits-link-color)"
        >
            {children}
        </a>
    );
}

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

function About() {
    const version = getVersionInfo();
    return (
        <div className="m-[0.5em] flex">
            <img
                src="/img/logo_m.png"
                alt=""
                className="h-fit shrink-0 [border:var(--menu-control-border)]"
            />
            <div className="ml-[0.5em] min-w-0 flex-1">
                <div className="mb-[0.5em] bg-(--menu-credits-background-color) p-[0.5em] [border:var(--menu-control-border)]">
                    <div>
                        &copy; {new Date().getFullYear()}{' '}
                        <ExternalLink href="https://github.com/akn19/rakkomik">RakKomik</ExternalLink> rev.{' '}
                        <ExternalLink href={version.link} title="Revision History">
                            {version.branch}@{version.revision}
                        </ExternalLink>
                        <hr />
                    </div>
                    <table className="w-full">
                        <tbody>
                            <tr>
                                <td className="w-px py-[2px] pr-[0.5em] align-top whitespace-nowrap">Development:</td>
                                <td className="py-[2px] align-top">
                                    <ExternalLink href="https://github.com/akn19/rakkomik/graphs/contributors">Contributors</ExternalLink>
                                </td>
                            </tr>
                            <tr>
                                <td className="w-px py-[2px] pr-[0.5em] align-top whitespace-nowrap">Help &amp; Info:</td>
                                <td className="flex gap-[0.25em] py-[2px] pt-[0.25em]">
                                    {HELP_LINKS.map(link => (
                                        <button
                                            key={link.icon}
                                            type="button"
                                            title={link.title}
                                            onClick={() => openExternalLink(link.href)}
                                            className="rk-button"
                                        >
                                            <Icon name={link.icon} size={20} />
                                        </button>
                                    ))}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

/**
 * Classic menu.html parity: the hamburger opens a popup over the browse
 * panels with the About card, the categorized settings table and the
 * import / save / discard buttons. The draft is a local copy, so closing
 * without saving simply discards it. The "Views" links carry the React-only
 * routes that classic never had as menu entries.
 */
export default function MenuPopup({ onClose }) {
    const { notify } = useToast();
    const navigate = useNavigate();
    const importRef = React.useRef(null);
    const { ready } = useConnectors();
    const [draft, setDraft] = React.useState(() => getSettingsDraft());
    const [saving, setSaving] = React.useState(false);

    // Connectors load in the background: add their settings once they are registered (keep edits).
    React.useEffect(() => {
        if (ready) {
            setDraft(current => {
                const known = new Set(current.map(group => group.category));
                return current.concat(getSettingsDraft().filter(group => !known.has(group.category)));
            });
        }
    }, [ready]);

    React.useEffect(() => {
        const onKeyDown = event => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

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

    const save = async () => {
        setSaving(true);
        try {
            await saveSettingsDraft(draft);
            notify('Settings saved.', 'success');
            onClose();
        } catch (error) {
            notify(`Failed to save settings: ${error.message}`, 'error');
            setSaving(false);
        }
    };

    const onImport = async event => {
        const file = event.target.files[0];
        try {
            await importBookmarksFile(file);
            notify('Bookmarks imported.', 'success');
        } catch (error) {
            notify(error.message, 'error');
        } finally {
            // reset the input or the same file cannot be chosen again
            event.target.value = '';
        }
    };

    const go = to => {
        onClose();
        navigate({ to });
    };

    return (
        <div className="absolute inset-0 z-10 m-[0.5em] flex flex-col bg-(--menu-control-background-color) [border:var(--menu-control-border)] [box-shadow:var(--menu-control-shadow)]">
            <Separator>Views</Separator>
            <div className="flex gap-[1em] p-[0.5em]">
                {VIEWS.map(view => (
                    <button
                        key={view.to}
                        type="button"
                        onClick={() => go(view.to)}
                        className="rk-button"
                    >
                        {view.name}
                    </button>
                ))}
            </div>
            <Separator>About</Separator>
            <About />
            <Separator>Settings</Separator>
            {!ready && <p className="px-[0.5em] pt-[0.25em] opacity-70">Loading connectors … their settings appear below when done.</p>}
            <div className="min-h-0 flex-1 overflow-y-scroll bg-(--menu-settings-background-color) p-[0.5em]">
                <table className="w-full border-collapse">
                    <tbody>
                        {draft.map(group => (
                            <React.Fragment key={group.category}>
                                <tr>
                                    <td colSpan={2} className="p-[0.5em] text-center font-bold uppercase text-(--menu-control-category-color)">
                                        {group.category}
                                    </td>
                                </tr>
                                {group.items.map(item => (
                                    <tr key={item.ref.label}>
                                        <td className="w-px overflow-hidden whitespace-nowrap [border-bottom:var(--menu-settings-row-border)]">
                                            <label title={item.ref.description} className="flex items-center gap-[0.25em]">
                                                <Icon name="info" size={13} className="rk-icon shrink-0" />
                                                {item.ref.label}
                                            </label>
                                        </td>
                                        <td className="overflow-hidden whitespace-nowrap [border-bottom:var(--menu-settings-row-border)]">
                                            <SettingControl
                                                item={item}
                                                onChange={value => updateItem(group.category, item.ref, value)}
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="flex items-center justify-between p-[0.25em]">
                <div>
                    <button type="button" title="Import bookmarks" onClick={() => importRef.current.click()} className="rk-button m-[0.25em]">
                        <Icon name="import" size={26} />
                    </button>
                    <input
                        ref={importRef}
                        type="file"
                        accept="application/x-sqlite3,.db,.db3"
                        onChange={onImport}
                        className="hidden"
                    />
                </div>
                <div className="flex">
                    <button type="button" title="Save settings and close menu" disabled={saving} onClick={save} className="rk-button m-[0.25em] disabled:opacity-60">
                        <Icon name="checkCircle" size={26} />
                    </button>
                    <button type="button" title="Close menu without saving settings" onClick={onClose} className="rk-button m-[0.25em]">
                        <Icon name="closeCircle" size={26} />
                    </button>
                </div>
            </div>
        </div>
    );
}

import React from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import {
    getSettingsDraft,
    saveSettingsDraft,
    getVersionInfo,
    openExternalLink,
    browseDirectory,
    browseFile,
    importBookmarksFile,
} from './engine.js';
import { useToast } from './notify.jsx';
import { useConnectors } from './connectorsState.js';
import { useDialog } from './dialog.jsx';
import {
    TextField,
    PasswordField,
    NumberField,
    SelectField,
    CheckboxField,
    PathField,
} from './fields.jsx';
import Icon from './icon.jsx';

const VIEWS = [
    { to: '/', name: 'Start' },
    { to: '/downloads', name: 'Downloads' },
    { to: '/bookmarks', name: 'Bookmarks' },
];

const HELP_LINKS = [
    {
        icon: 'home',
        title: 'Visit the RakKomik Homepage',
        href: 'https://github.com/akn19/rakkomik',
    },
    {
        icon: 'book',
        title: 'Read the Online Documentation',
        href: 'https://github.com/akn19/rakkomik#readme',
    },
    {
        icon: 'bug',
        title: 'Open a Ticket on GitHub',
        href: 'https://github.com/akn19/rakkomik/issues',
    },
    {
        icon: 'streetView',
        title: 'Show your external IP and Geolocation',
        href: 'https://ipinfo.io/json',
    },
];

// the headings of the parts of the menu
function Separator({ children }) {
    return (
        <h2 className="rk-separator pt-[0.5em] pb-[0.25em] pl-[0.5em] font-bold uppercase text-(--menu-control-category-color)">
            {children}
        </h2>
    );
}

// a link that the browser of the system opens: a real link, so that the keyboard reaches it
function ExternalLink({ href, title, children }) {
    return (
        <a
            href={href}
            title={title || href}
            onClick={(event) => {
                event.preventDefault();
                openExternalLink(href);
            }}
            className="cursor-pointer text-(--menu-credits-link-color)"
        >
            {children}
        </a>
    );
}

function SettingControl({ item, id, describedBy, onChange }) {
    const { notify } = useToast();
    const ref = item.ref;
    // the dialog is the main process's: when it fails the user is told, and the choice stays as it was
    const browse = async (choose) => {
        try {
            const path = await choose();
            if (path) {
                onChange(path);
            }
        } catch (error) {
            notify(`Failed to choose a path: ${error.message}`, 'error');
        }
    };
    switch (ref.input) {
        case 'password':
            return (
                <PasswordField
                    value={item.value}
                    title={ref.description}
                    id={id}
                    describedBy={describedBy}
                    onChange={onChange}
                />
            );
        case 'numeric':
            return (
                <NumberField
                    value={item.value}
                    min={ref.min}
                    max={ref.max}
                    id={id}
                    describedBy={describedBy}
                    onChange={onChange}
                />
            );
        case 'select':
            return (
                <SelectField
                    value={item.value}
                    options={ref.options}
                    id={id}
                    describedBy={describedBy}
                    onChange={onChange}
                />
            );
        case 'checkbox':
            return (
                <CheckboxField
                    value={item.value}
                    id={id}
                    describedBy={describedBy}
                    onChange={onChange}
                />
            );
        case 'file':
            return (
                <PathField
                    value={item.value}
                    browseTitle="Choose file …"
                    browseLabel={`Choose a file for ${ref.label}`}
                    id={id}
                    describedBy={describedBy}
                    onBrowse={() => browse(browseFile)}
                />
            );
        case 'directory':
            return (
                <PathField
                    value={item.value}
                    browseTitle="Browse …"
                    browseLabel={`Choose a folder for ${ref.label}`}
                    id={id}
                    describedBy={describedBy}
                    onBrowse={() => browse(() => browseDirectory(item.value))}
                />
            );
        case 'disabled':
            return (
                <TextField
                    value={item.value}
                    title={item.value}
                    id={id}
                    describedBy={describedBy}
                    disabled
                    onChange={() => undefined}
                />
            );
        case 'text':
        default:
            return (
                <TextField
                    value={item.value}
                    title={ref.description}
                    id={id}
                    describedBy={describedBy}
                    onChange={onChange}
                />
            );
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
                        <ExternalLink href="https://github.com/akn19/rakkomik">
                            RakKomik
                        </ExternalLink>{' '}
                        rev.{' '}
                        <ExternalLink href={version.link} title="Revision History">
                            {version.branch}@{version.revision}
                        </ExternalLink>
                        <hr />
                    </div>
                    <table className="w-full">
                        <tbody>
                            <tr>
                                <th
                                    scope="row"
                                    className="w-px py-[2px] pr-[0.5em] text-left align-top font-normal whitespace-nowrap"
                                >
                                    Development:
                                </th>
                                <td className="py-[2px] align-top">
                                    <ExternalLink href="https://github.com/akn19/rakkomik/graphs/contributors">
                                        Contributors
                                    </ExternalLink>
                                </td>
                            </tr>
                            <tr>
                                <th
                                    scope="row"
                                    className="w-px py-[2px] pr-[0.5em] text-left align-top font-normal whitespace-nowrap"
                                >
                                    Help &amp; Info:
                                </th>
                                <td className="flex gap-[0.25em] py-[2px] pt-[0.25em]">
                                    {HELP_LINKS.map((link) => (
                                        <button
                                            key={link.icon}
                                            type="button"
                                            title={link.title}
                                            aria-label={link.title}
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
 *
 * The popup is a dialog: it takes the keyboard focus when it opens, keeps it (Tab goes round inside), closes with
 * Escape and gives the focus back to the button that opened it.
 */
export default function MenuPopup({ id, onClose }) {
    const { notify } = useToast();
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const importRef = React.useRef(null);
    const { ready } = useConnectors();
    const [draft, setDraft] = React.useState(() => getSettingsDraft());
    const [saving, setSaving] = React.useState(false);
    const fieldId = React.useId();
    const dialogRef = useDialog({ open: true, onClose });

    // Connectors load in the background: add their settings once they are registered (keep edits).
    React.useEffect(() => {
        if (ready) {
            setDraft((current) => {
                const known = new Set(current.map((group) => group.category));
                return current.concat(
                    getSettingsDraft().filter((group) => !known.has(group.category)),
                );
            });
        }
    }, [ready]);

    const updateItem = (category, ref, value) => {
        setDraft((current) =>
            current.map((group) => {
                if (group.category !== category) {
                    return group;
                }
                return {
                    ...group,
                    items: group.items.map((item) =>
                        item.ref === ref ? { ...item, value } : item,
                    ),
                };
            }),
        );
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

    const onImport = async (event) => {
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

    const go = (to) => {
        onClose();
        navigate({ to });
    };

    return (
        <div
            ref={dialogRef}
            id={id}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            tabIndex={-1}
            className="absolute inset-0 z-10 m-[0.5em] flex flex-col bg-(--menu-control-background-color) [border:var(--menu-control-border)] [box-shadow:var(--menu-control-shadow)]"
        >
            <Separator>Views</Separator>
            <nav aria-label="Views" className="flex gap-[1em] p-[0.5em]">
                {VIEWS.map((view) => (
                    <button
                        key={view.to}
                        type="button"
                        aria-current={pathname === view.to ? 'page' : undefined}
                        onClick={() => go(view.to)}
                        className={'rk-button ' + (pathname === view.to ? 'underline' : '')}
                    >
                        {view.name}
                    </button>
                ))}
            </nav>
            <Separator>About</Separator>
            <About />
            <Separator>Settings</Separator>
            {!ready && (
                <p
                    role="status"
                    className="px-[0.5em] pt-[0.25em] text-(--menu-control-category-color)"
                >
                    Loading connectors … their settings appear below when done.
                </p>
            )}
            <div className="min-h-0 flex-1 overflow-y-scroll bg-(--menu-settings-background-color) p-[0.5em]">
                <table className="w-full border-collapse">
                    {draft.map((group, groupIndex) => (
                        <tbody key={group.category}>
                            <tr>
                                <th
                                    colSpan={2}
                                    scope="rowgroup"
                                    className="p-[0.5em] text-center font-bold uppercase text-(--menu-control-category-color)"
                                >
                                    {group.category}
                                </th>
                            </tr>
                            {group.items.map((item, itemIndex) => {
                                const id = `${fieldId}-${groupIndex}-${itemIndex}`;
                                return (
                                    <tr key={item.ref.label}>
                                        <td className="w-px overflow-hidden whitespace-nowrap [border-bottom:var(--menu-settings-row-border)]">
                                            <label
                                                htmlFor={id}
                                                title={item.ref.description}
                                                className="flex items-center gap-[0.25em]"
                                            >
                                                <Icon
                                                    name="info"
                                                    size={13}
                                                    className="rk-icon shrink-0"
                                                />
                                                {item.ref.label}
                                            </label>
                                            {/* the tooltip of the label, for a screen reader: it describes the control */}
                                            <span id={`${id}-description`} className="sr-only">
                                                {item.ref.description}
                                            </span>
                                        </td>
                                        <td className="overflow-hidden whitespace-nowrap [border-bottom:var(--menu-settings-row-border)]">
                                            <SettingControl
                                                item={item}
                                                id={id}
                                                describedBy={
                                                    item.ref.description
                                                        ? `${id}-description`
                                                        : undefined
                                                }
                                                onChange={(value) =>
                                                    updateItem(group.category, item.ref, value)
                                                }
                                            />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    ))}
                </table>
            </div>
            <div className="flex items-center justify-between p-[0.25em]">
                <div>
                    <button
                        type="button"
                        title="Import bookmarks"
                        aria-label="Import bookmarks"
                        onClick={() => importRef.current.click()}
                        className="rk-button m-[0.25em]"
                    >
                        <Icon name="import" size={26} />
                    </button>
                    <input
                        ref={importRef}
                        type="file"
                        accept="application/x-sqlite3,.db,.db3"
                        aria-label="Bookmarks file"
                        onChange={onImport}
                        className="hidden"
                    />
                </div>
                <div className="flex">
                    <button
                        type="button"
                        title="Save settings and close menu"
                        aria-label="Save settings and close menu"
                        disabled={saving}
                        onClick={save}
                        className="rk-button m-[0.25em] disabled:opacity-60"
                    >
                        <Icon name="checkCircle" size={26} />
                    </button>
                    <button
                        type="button"
                        title="Close menu without saving settings"
                        aria-label="Close menu without saving settings"
                        onClick={onClose}
                        className="rk-button m-[0.25em]"
                    >
                        <Icon name="closeCircle" size={26} />
                    </button>
                </div>
            </div>
        </div>
    );
}

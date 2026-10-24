import React from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import {
    getSettingsDraft,
    saveSettingsDraft,
    mangaDirectoryProblem,
    getVersionInfo,
    openExternalLink,
    browseDirectory,
    browseFile,
    importBookmarksFile,
    hasActiveDownloads,
} from './engine.js';
import {
    canUpdateWebPart,
    installedWebPart,
    checkWebPartUpdate,
    installWebPartUpdate,
    restartWebPart,
    describeWebPart,
    megabytes,
} from './updates.js';
import { useToast } from './notify.jsx';
import { useConnectors } from './connectorsState.js';
import { useDialog, ConfirmDialog } from './dialog.jsx';
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

// what a step of an update that is installed says (see Updater.updateCache of src/app)
function installStep(step) {
    switch (step.stage) {
        case 'downloading':
            return step.total
                ? `Downloading: ${megabytes(step.received)} of ${megabytes(step.total)}`
                : `Downloading: ${megabytes(step.received || 0)}`;
        case 'verifying':
            return 'Verifying the signature …';
        case 'installing':
            return 'Installing …';
        default:
            return 'Asking the update server …';
    }
}

/**
 * The connectors and the interface (the web part) are updated apart from the application: the version that is
 * installed, whether the update server has a newer one, installing it, and reloading the window onto it. An older
 * application only installs an update when it starts.
 */
function Updates() {
    const supported = canUpdateWebPart();
    const [installed, setInstalled] = React.useState(undefined);
    const [state, setState] = React.useState({ phase: 'idle' });
    const [confirmRestart, setConfirmRestart] = React.useState(false);

    React.useEffect(() => {
        if (!supported) {
            return undefined;
        }
        let live = true;
        installedWebPart().then(
            (version) => live && setInstalled(version),
            () => undefined,
        );
        return () => {
            live = false;
        };
    }, [supported]);

    const check = async () => {
        setState({ phase: 'checking' });
        try {
            const answer = await checkWebPartUpdate();
            if (answer.error) {
                setState({ phase: 'failed', message: answer.error });
            } else if (answer.disabled) {
                setState({ phase: 'disabled' });
            } else {
                setInstalled(answer.current);
                setState({
                    phase: answer.available ? 'available' : 'current',
                    latest: answer.latest,
                });
            }
        } catch (error) {
            setState({ phase: 'failed', message: error.message });
        }
    };

    const install = async () => {
        setState({ phase: 'installing', step: { stage: 'checking' } });
        try {
            const last = await installWebPartUpdate((step) =>
                setState({ phase: 'installing', step }),
            );
            if (last.stage === 'updated') {
                setInstalled(last.version);
                setState({ phase: 'installed', latest: last.version });
            } else if (last.stage === 'current' || last.stage === 'disabled') {
                setState({ phase: last.stage });
            } else {
                setState({ phase: 'failed', message: last.message });
            }
        } catch (error) {
            setState({ phase: 'failed', message: error.message });
        }
    };

    const restart = () => {
        if (hasActiveDownloads()) {
            setConfirmRestart(true);
        } else {
            restartWebPart();
        }
    };

    const step = state.step || {};
    const percent =
        state.phase === 'installing' && step.stage === 'downloading' && step.total
            ? Math.floor((100 * step.received) / step.total)
            : null;
    const message = !supported
        ? 'This version of RakKomik installs updates when it starts: restart RakKomik to get the newest connectors.'
        : {
              idle: '',
              checking: 'Asking the update server …',
              current: 'The connectors are up to date.',
              available: `A newer version is available: ${describeWebPart(state.latest)}.`,
              installing: installStep(step),
              installed: 'Installed. Restart to load the new connectors.',
              failed: `The update failed: ${state.message || 'unknown error'}`,
              disabled: 'Updates are switched off for this application.',
          }[state.phase];
    const action = !supported
        ? null
        : state.phase === 'available'
          ? { label: 'Update now', onClick: install }
          : state.phase === 'installed'
            ? { label: 'Restart now', onClick: restart }
            : state.phase === 'failed'
              ? { label: 'Try again', onClick: check }
              : {
                    label: 'Check for updates',
                    onClick: check,
                    disabled: state.phase === 'checking' || state.phase === 'installing',
                };

    return (
        <div className="m-[0.5em] flex items-center gap-[0.5em] bg-(--menu-credits-background-color) p-[0.5em] [border:var(--menu-control-border)]">
            <div className="min-w-0 flex-1">
                <div>
                    Connectors &amp; interface:{' '}
                    {supported
                        ? describeWebPart(installed === undefined ? '' : installed)
                        : 'see the start of RakKomik'}
                </div>
                <div role="status" className="text-(--menu-control-category-color)">
                    {message}
                </div>
                {percent !== null && (
                    <progress
                        max={100}
                        value={percent}
                        aria-label="Download of the update"
                        className="mt-[0.25em] h-[0.5em] w-full"
                    />
                )}
            </div>
            {action && (
                <button
                    type="button"
                    disabled={action.disabled}
                    onClick={action.onClick}
                    className="rk-button shrink-0 px-[0.5em] text-(--menu-credits-link-color) py-[0.125em] whitespace-nowrap [border:var(--menu-control-border)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                    {action.label}
                </button>
            )}
            <ConfirmDialog
                open={confirmRestart}
                title="Restart now?"
                message="Downloads that wait or run stop when RakKomik reloads."
                confirmLabel="Restart"
                cancelLabel="Later"
                onConfirm={() => {
                    setConfirmRestart(false);
                    restartWebPart();
                }}
                onCancel={() => setConfirmRestart(false)}
            />
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
            // the settings are kept either way: the problem is only said, until it is dismissed
            const problem = await mangaDirectoryProblem();
            if (problem) {
                notify(problem, 'error');
            }
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
            <Separator>Updates</Separator>
            <Updates />
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

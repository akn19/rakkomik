import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Settings from '../../mjs/engine/Settings.mjs';
import MenuPopup from '../menu.jsx';
import {
    createConnector,
    createSettings,
    installBridge,
    installEngine,
} from './support/fakeEngine.js';
import { renderRouted } from './support/render.jsx';

let engine = null;

afterEach(() => {
    vi.restoreAllMocks();
});

// the settings of the engine: `ref`s with the members that Settings.mjs gives them
function setting(fields) {
    return { input: 'text', label: 'A setting', description: 'What it does', value: '', ...fields };
}

function group(category, ...settings) {
    return { category, settings };
}

// one setting of every input type, as the engine has them
function typedGroups() {
    return [
        group(
            'General',
            setting({ input: 'text', label: 'Text', description: 'A text', value: 'abc' }),
            setting({
                input: 'password',
                label: 'Password',
                description: 'A secret',
                value: 'hunter2',
            }),
            setting({
                input: 'numeric',
                label: 'Quality',
                description: 'A number',
                value: 90,
                min: 50,
                max: 100,
            }),
            setting({
                input: 'select',
                label: 'Format',
                description: 'A choice',
                value: '.cbz',
                options: [
                    { value: 'img', name: 'Folder with Images' },
                    { value: '.cbz', name: 'Comic Book Archive' },
                    { value: '.epub', name: 'Ebook Reader' },
                ],
            }),
            setting({ input: 'checkbox', label: 'Reader', description: 'A switch', value: true }),
            setting({ input: 'file', label: 'Key file', description: 'A file', value: '/keys/id' }),
            setting({
                input: 'directory',
                label: 'Manga Directory',
                description: 'A directory',
                value: '/mangas',
            }),
            setting({
                input: 'disabled',
                label: 'Bookmarks Directory',
                description: 'Cannot be changed',
                value: '/userdata',
            }),
        ),
    ];
}

// The popup as the interface opens it, with a function that is asked to close it. The same element is under every route,
// so that the buttons for the views can be tried from each of them.
async function openMenu({ groups = [], ready = true, url = '/', members = {} } = {}) {
    const settings = createSettings({ groups });
    engine = installEngine({ ready, engine: { Settings: settings, ...members } });
    const onClose = vi.fn();
    const menu = <MenuPopup onClose={onClose} />;
    const view = await renderRouted(menu, {
        url,
        selection: false,
        routes: ['/downloads', '/bookmarks'].map((path) => ({ path, element: menu })),
    });
    return { ...view, settings, onClose };
}

// The popup as the shell opens it: the parent takes it away when it asks to be closed, and it starts from the engine when
// it is opened again.
async function openLikeTheShell(groups) {
    const settings = createSettings({ groups });
    engine = installEngine({ engine: { Settings: settings } });
    function Host() {
        const [open, setOpen] = React.useState(true);
        return (
            <>
                <button type="button" onClick={() => setOpen(true)}>
                    Open the menu
                </button>
                {open && <MenuPopup onClose={() => setOpen(false)} />}
            </>
        );
    }
    await renderRouted(<Host />, { selection: false });
    return { settings };
}

const saveButton = () => screen.getByTitle('Save settings and close menu');
const closeButton = () => screen.getByTitle('Close menu without saving settings');
const importButton = () => screen.getByTitle('Import bookmarks');
const importInput = () => document.querySelector('input[type="file"]');

function rowOf(label) {
    return screen.getByText(label).closest('tr');
}

// the input, or the select, of a setting
function controlOf(label) {
    return rowOf(label).querySelector('input, select');
}

function type(label, value) {
    fireEvent.change(controlOf(label), { target: { value } });
}

// the headings of the categories and the labels of the settings, in the order they are drawn
function outline() {
    return [...document.querySelectorAll('th[colspan], label')].map((node) => node.textContent);
}

function toastOf(message) {
    return screen.getByText(message).closest('.pointer-events-auto');
}

describe('menu popup', () => {
    describe('settings', () => {
        it('should draw the settings under the heading of their category, in the order of the engine', async () => {
            await openMenu({
                groups: [
                    group('General', setting({ label: 'Name' }), setting({ label: 'Mode' })),
                    group('Site A', setting({ label: 'Throttle' })),
                    group('Site B', setting({ label: 'Throttle' }), setting({ label: 'Login' })),
                ],
            });
            expect(outline()).toEqual([
                'General',
                'Name',
                'Mode',
                'Site A',
                'Throttle',
                'Site B',
                'Throttle',
                'Login',
            ]);
        });

        it('should show the description of a setting as the tooltip of its label', async () => {
            await openMenu({
                groups: [
                    group(
                        'General',
                        setting({ label: 'Name', description: 'What the name is for' }),
                    ),
                ],
            });
            expect(screen.getByText('Name').getAttribute('title')).toBe('What the name is for');
        });

        it('should draw no settings, and still be able to save, when the engine has none', async () => {
            const { settings, onClose } = await openMenu({ groups: [] });
            expect(outline()).toEqual([]);
            fireEvent.click(saveButton());
            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            expect(settings.save).toHaveBeenCalledTimes(1);
        });

        it('should draw a category that has no settings as a heading only', async () => {
            await openMenu({
                groups: [group('General', setting({ label: 'Name' })), group('Empty Site')],
            });
            expect(outline()).toEqual(['General', 'Name', 'Empty Site']);
        });

        describe('controls', () => {
            beforeEach(async () => {
                await openMenu({ groups: typedGroups() });
            });

            it('should draw a text field for text, with the description as tooltip', () => {
                const input = controlOf('Text');
                expect(input.type).toBe('text');
                expect(input.value).toBe('abc');
                expect(input.title).toBe('A text');
                expect(input.disabled).toBe(false);
            });

            it('should draw a field that hides what is typed for a password, with the description as tooltip', () => {
                const input = controlOf('Password');
                expect(input.type).toBe('password');
                expect(input.value).toBe('hunter2');
                expect(input.title).toBe('A secret');
            });

            it('should draw a number field with the limits of the setting for a numeric setting', () => {
                const input = controlOf('Quality');
                expect(input.type).toBe('number');
                expect(input.value).toBe('90');
                expect(input.getAttribute('min')).toBe('50');
                expect(input.getAttribute('max')).toBe('100');
            });

            it('should draw a choice of the options, with the value selected, for a select setting', () => {
                const select = controlOf('Format');
                expect(select.tagName).toBe('SELECT');
                expect(
                    [...select.options].map((option) => [option.value, option.textContent]),
                ).toEqual([
                    ['img', 'Folder with Images'],
                    ['.cbz', 'Comic Book Archive'],
                    ['.epub', 'Ebook Reader'],
                ]);
                expect(select.value).toBe('.cbz');
            });

            it('should draw a box that is checked or not for a checkbox setting', () => {
                const box = controlOf('Reader');
                expect(box.type).toBe('checkbox');
                expect(box.checked).toBe(true);
            });

            it.each([
                ['a file', 'Key file', '/keys/id', 'Choose file …'],
                ['a directory', 'Manga Directory', '/mangas', 'Browse …'],
            ])(
                'should show the path of %s as text that cannot be typed, but read, with a button to browse',
                (name, label, value, browse) => {
                    const input = controlOf(label);
                    expect(input.value).toBe(value);
                    expect(input.readOnly).toBe(true);
                    expect(input.disabled).toBe(false);
                    expect(within(rowOf(label)).getByTitle(browse)).toBeTruthy();
                },
            );

            it('should show a setting that cannot be changed as a text that cannot be typed, with its value as tooltip', () => {
                const input = controlOf('Bookmarks Directory');
                expect(input.value).toBe('/userdata');
                expect(input.disabled).toBe(true);
                expect(input.title).toBe('/userdata');
                expect(within(rowOf('Bookmarks Directory')).queryByRole('button')).toBeNull();
            });
        });

        it('should draw a text field for an input type that it does not know', async () => {
            await openMenu({
                groups: [
                    group('General', setting({ input: 'colour', label: 'Colour', value: 'red' })),
                ],
            });
            const input = controlOf('Colour');
            expect(input.type).toBe('text');
            expect(input.value).toBe('red');
            expect(input.disabled).toBe(false);
        });

        it.each([
            ['text', undefined],
            ['password', null],
            ['numeric', undefined],
            ['select', undefined],
        ])(
            'should draw an empty %s control for a setting without a value',
            async (input, value) => {
                await openMenu({
                    groups: [
                        group('General', setting({ input, label: 'Empty', value, options: [] })),
                    ],
                });
                expect(controlOf('Empty').value).toBe('');
            },
        );

        it('should draw an unchecked box for a checkbox setting without a value', async () => {
            await openMenu({
                groups: [
                    group(
                        'General',
                        setting({ input: 'checkbox', label: 'Switch', value: undefined }),
                    ),
                ],
            });
            expect(controlOf('Switch').checked).toBe(false);
        });
    });

    describe('saving', () => {
        it('should keep the changes in the draft until the settings are saved', async () => {
            const groups = typedGroups();
            const { settings, onClose } = await openMenu({ groups });
            type('Text', 'changed');
            type('Password', 'new secret');
            type('Quality', '75');
            type('Format', '.epub');
            fireEvent.click(controlOf('Reader'));
            // what the user sees has changed ...
            expect(controlOf('Text').value).toBe('changed');
            expect(controlOf('Password').value).toBe('new secret');
            expect(controlOf('Quality').value).toBe('75');
            expect(controlOf('Format').value).toBe('.epub');
            expect(controlOf('Reader').checked).toBe(false);
            // ... but not the engine
            const [text, password, quality, format, reader] = groups[0].settings;
            expect([text.value, password.value, quality.value, format.value, reader.value]).toEqual(
                ['abc', 'hunter2', 90, '.cbz', true],
            );
            expect(settings.save).not.toHaveBeenCalled();
            expect(onClose).not.toHaveBeenCalled();
        });

        it('should write the changes into the settings, then save them, tell so, and close', async () => {
            const groups = typedGroups();
            const { settings, onClose } = await openMenu({ groups });
            const [text, password, quality, format, reader] = groups[0].settings;
            let seenBySave = null;
            settings.save.mockImplementation(async () => {
                seenBySave = [
                    text.value,
                    password.value,
                    quality.value,
                    format.value,
                    reader.value,
                ];
            });
            type('Text', 'changed');
            type('Password', 'new secret');
            type('Quality', '75');
            type('Format', '.epub');
            fireEvent.click(controlOf('Reader'));
            fireEvent.click(saveButton());
            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            // the engine saves what it holds, so the values have to be in place before it is asked to
            expect(seenBySave).toEqual(['changed', 'new secret', 75, '.epub', false]);
            expect(typeof quality.value).toBe('number');
            expect(settings.save).toHaveBeenCalledTimes(1);
            expect(screen.getByText('Settings saved.')).toBeTruthy();
            expect(toastOf('Settings saved.').className).toMatch(/green/);
        });

        it('should save the settings that were not changed as they were', async () => {
            const groups = typedGroups();
            const { settings, onClose } = await openMenu({ groups });
            fireEvent.click(saveButton());
            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            expect(groups[0].settings.map((entry) => entry.value)).toEqual([
                'abc',
                'hunter2',
                90,
                '.cbz',
                true,
                '/keys/id',
                '/mangas',
                '/userdata',
            ]);
            expect(settings.save).toHaveBeenCalledTimes(1);
        });

        it.each([
            ['below the minimum', 30, 50],
            ['at the minimum', 50, 50],
            ['inside the limits', 75, 75],
            ['at the maximum', 100, 100],
            ['above the maximum', 150, 100],
        ])('should save a number %s of its setting as %i', async (name, typed, saved) => {
            const quality = setting({
                input: 'numeric',
                label: 'Quality',
                value: 90,
                min: 50,
                max: 100,
            });
            const { onClose } = await openMenu({ groups: [group('General', quality)] });
            type('Quality', String(typed));
            // the field shows what was typed, the limits are applied when it is saved
            expect(controlOf('Quality').value).toBe(String(typed));
            fireEvent.click(saveButton());
            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            expect(quality.value).toBe(saved);
        });

        it('should save a numeric setting that the engine holds as text as a number, also when it was not touched', async () => {
            const quality = setting({
                input: 'numeric',
                label: 'Quality',
                value: '75',
                min: 50,
                max: 100,
            });
            const { onClose } = await openMenu({ groups: [group('General', quality)] });
            expect(controlOf('Quality').value).toBe('75');
            fireEvent.click(saveButton());
            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            expect(quality.value).toBe(75);
        });

        it('should not limit a number whose setting has no limits', async () => {
            const count = setting({ input: 'numeric', label: 'Count', value: 1 });
            const { onClose } = await openMenu({ groups: [group('General', count)] });
            type('Count', '-12345');
            fireEvent.click(saveButton());
            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            expect(count.value).toBe(-12345);
        });

        it('should change only the setting of the category that is edited when two categories have a setting with the same label', async () => {
            const first = setting({ label: 'Throttle', value: 'a' });
            const second = setting({ label: 'Throttle', value: 'b' });
            const { onClose } = await openMenu({
                groups: [group('Site A', first), group('Site B', second)],
            });
            fireEvent.change(
                screen.getAllByText('Throttle')[1].closest('tr').querySelector('input'),
                { target: { value: 'edited' } },
            );
            fireEvent.click(saveButton());
            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            expect(first.value).toBe('a');
            expect(second.value).toBe('edited');
        });

        it('should not write into a setting that cannot be changed', async () => {
            const groups = typedGroups();
            const { onClose } = await openMenu({ groups });
            fireEvent.change(controlOf('Bookmarks Directory'), { target: { value: '/elsewhere' } });
            expect(controlOf('Bookmarks Directory').value).toBe('/userdata');
            fireEvent.click(saveButton());
            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            expect(groups[0].settings[7].value).toBe('/userdata');
        });

        it('should disable the save button while it saves, and save only once', async () => {
            let finish = null;
            const { settings, onClose } = await openMenu({
                groups: [group('General', setting({ label: 'Name' }))],
            });
            settings.save.mockImplementation(
                () =>
                    new Promise((resolve) => {
                        finish = resolve;
                    }),
            );
            expect(saveButton().disabled).toBe(false);
            fireEvent.click(saveButton());
            expect(saveButton().disabled).toBe(true);
            fireEvent.click(saveButton());
            expect(settings.save).toHaveBeenCalledTimes(1);
            expect(onClose).not.toHaveBeenCalled();
            expect(screen.queryByText('Settings saved.')).toBeNull();
            await act(async () => finish());
            expect(onClose).toHaveBeenCalledTimes(1);
            expect(screen.getByText('Settings saved.')).toBeTruthy();
        });

        it('should say that saving failed, stay open, and let the user try again with the edits still in place', async () => {
            const name = setting({ label: 'Name', value: 'old' });
            const { settings, onClose } = await openMenu({ groups: [group('General', name)] });
            settings.save.mockRejectedValueOnce(new Error('disk is full'));
            type('Name', 'new');
            fireEvent.click(saveButton());
            expect(await screen.findByText('Failed to save settings: disk is full')).toBeTruthy();
            expect(toastOf('Failed to save settings: disk is full').className).toMatch(/red/);
            expect(screen.queryByText('Settings saved.')).toBeNull();
            expect(onClose).not.toHaveBeenCalled();
            expect(saveButton().disabled).toBe(false);
            expect(controlOf('Name').value).toBe('new');
            fireEvent.click(saveButton());
            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            expect(settings.save).toHaveBeenCalledTimes(2);
            expect(screen.getByText('Settings saved.')).toBeTruthy();
        });
    });

    describe('the manga directory that is saved', () => {
        async function openWithDirectory() {
            const directory = setting({
                input: 'directory',
                label: 'Manga Directory',
                value: '/mangas',
            });
            const view = await openMenu({ groups: [group('General', directory)] });
            view.settings.baseDirectory = directory;
            return view;
        }

        // the directory is chosen in the dialog of the system, the field is not typed in
        async function choose(path) {
            engine.Storage.folderBrowser.mockResolvedValueOnce(path);
            fireEvent.click(within(rowOf('Manga Directory')).getByRole('button'));
            await waitFor(() => expect(controlOf('Manga Directory').value).toBe(path));
        }

        it('should be looked at after the save, and not be mentioned when it can take the chapters', async () => {
            const { settings, onClose } = await openWithDirectory();
            let seenAtCheck = null;
            engine.Storage.checkDirectory.mockImplementation(async (value) => {
                seenAtCheck = { value, saved: settings.save.mock.calls.length };
            });
            await choose('/mnt/disk/mangas');
            fireEvent.click(saveButton());
            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            expect(seenAtCheck).toEqual({ value: '/mnt/disk/mangas', saved: 1 });
            expect(screen.getByText('Settings saved.')).toBeTruthy();
            expect(screen.queryByText(/Cannot access the manga directory/)).toBeNull();
        });

        it('should be said to be out of reach, until the message is dismissed, with the settings kept and the menu closed', async () => {
            const { settings, onClose } = await openWithDirectory();
            engine.Storage.checkDirectory.mockRejectedValueOnce(
                new Error("EACCES: permission denied, access '/mnt/disk/mangas'"),
            );
            await choose('/mnt/disk/mangas');
            fireEvent.click(saveButton());
            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            const toast = toastOf(/Cannot access the manga directory!/);
            expect(toast.className).toMatch(/red/);
            expect(toast.getAttribute('role')).toBe('alert');
            expect(toast.textContent).toContain("EACCES: permission denied, access '/mnt/disk");
            expect(toastOf('Settings saved.').className).toMatch(/green/);
            expect(settings.save).toHaveBeenCalledTimes(1);
            expect(settings.baseDirectory.value).toBe('/mnt/disk/mangas');
        });

        it('should not be looked at when the settings could not be saved', async () => {
            const { settings, onClose } = await openWithDirectory();
            settings.save.mockRejectedValueOnce(new Error('disk is full'));
            fireEvent.click(saveButton());
            expect(await screen.findByText('Failed to save settings: disk is full')).toBeTruthy();
            expect(engine.Storage.checkDirectory).not.toHaveBeenCalled();
            expect(onClose).not.toHaveBeenCalled();
        });
    });

    describe('closing', () => {
        it('should discard the draft when the close button is used, and close', async () => {
            const name = setting({ label: 'Name', value: 'old' });
            const { settings, onClose } = await openMenu({ groups: [group('General', name)] });
            type('Name', 'new');
            fireEvent.click(closeButton());
            expect(onClose).toHaveBeenCalledTimes(1);
            expect(settings.save).not.toHaveBeenCalled();
            expect(name.value).toBe('old');
        });

        it('should discard the draft when Escape is pressed, and close', async () => {
            const user = userEvent.setup();
            const name = setting({ label: 'Name', value: 'old' });
            const { settings, onClose } = await openMenu({ groups: [group('General', name)] });
            type('Name', 'new');
            await user.keyboard('{Escape}');
            expect(onClose).toHaveBeenCalledTimes(1);
            expect(settings.save).not.toHaveBeenCalled();
            expect(name.value).toBe('old');
        });

        it('should ignore the other keys', async () => {
            const user = userEvent.setup();
            const { onClose } = await openMenu();
            await user.keyboard('a{Enter}{Backspace}{ArrowDown}{Delete}');
            expect(onClose).not.toHaveBeenCalled();
        });

        it('should start from the engine again when it is opened again, whether it was left or saved', async () => {
            const name = setting({ label: 'Name', value: 'old' });
            await openLikeTheShell([group('General', name)]);
            type('Name', 'discarded');
            fireEvent.keyDown(window, { key: 'Escape' });
            expect(screen.queryByText('Name')).toBeNull();
            fireEvent.click(screen.getByRole('button', { name: 'Open the menu' }));
            expect(controlOf('Name').value).toBe('old');
            type('Name', 'saved');
            fireEvent.click(saveButton());
            await waitFor(() => expect(screen.queryByText('Name')).toBeNull());
            expect(name.value).toBe('saved');
            fireEvent.click(screen.getByRole('button', { name: 'Open the menu' }));
            expect(controlOf('Name').value).toBe('saved');
        });

        it('should listen for Escape once, and stop listening when it goes away', async () => {
            const add = vi.spyOn(window, 'addEventListener');
            const remove = vi.spyOn(window, 'removeEventListener');
            const { unmount, onClose } = await openMenu();
            const added = add.mock.calls.filter(([type]) => type === 'keydown');
            expect(added).toHaveLength(1);
            unmount();
            expect(
                remove.mock.calls
                    .filter(([type]) => type === 'keydown')
                    .map(([, listener]) => listener),
            ).toEqual([added[0][1]]);
            fireEvent.keyDown(window, { key: 'Escape' });
            expect(onClose).not.toHaveBeenCalled();
        });

        it('should call the function that it was last given when Escape is pressed, not the first one', async () => {
            const first = vi.fn();
            const second = vi.fn();
            engine = installEngine({ engine: { Settings: createSettings() } });
            function Host() {
                const [version, setVersion] = React.useState(1);
                return (
                    <>
                        <button type="button" onClick={() => setVersion(2)}>
                            Swap
                        </button>
                        <MenuPopup onClose={version === 1 ? first : second} />
                    </>
                );
            }
            await renderRouted(<Host />, { selection: false });
            fireEvent.click(screen.getByRole('button', { name: 'Swap' }));
            fireEvent.keyDown(window, { key: 'Escape' });
            expect(first).not.toHaveBeenCalled();
            expect(second).toHaveBeenCalledTimes(1);
        });
    });

    describe('connectors that are not ready', () => {
        const early = () => [
            group('General', setting({ label: 'Name', value: 'old' })),
            group('Early Site', setting({ label: 'Early', value: 'e' })),
        ];

        it('should say that the connectors are loading while they are, and not when they are ready', async () => {
            await openMenu({ groups: early(), ready: false });
            expect(
                screen.getByText('Loading connectors … their settings appear below when done.'),
            ).toBeTruthy();
            expect(outline()).toEqual(['General', 'Name', 'Early Site', 'Early']);
        });

        it('should draw all the settings, and no notice, when the connectors are ready from the start', async () => {
            await openMenu({ groups: early(), ready: true });
            expect(screen.queryByText(/^Loading connectors/)).toBeNull();
            expect(outline()).toEqual(['General', 'Name', 'Early Site', 'Early']);
        });

        it('should add the settings of connectors that register late when all are ready, and keep the edits made meanwhile', async () => {
            const groups = early();
            const late = setting({ label: 'Late', value: 'l' });
            const { settings } = await openMenu({ groups, ready: false });
            type('Name', 'edited');
            type('Early', 'also edited');
            // a connector registers, with its settings; they wait until the registry is ready
            settings.groups.push(group('Late Site', late));
            engine.Connectors.push(createConnector({ id: 'late', label: 'Late Site' }));
            act(() => engine.ConnectorRegistry.emit('registered'));
            expect(outline()).toEqual(['General', 'Name', 'Early Site', 'Early']);
            expect(screen.getByText(/^Loading connectors/)).toBeTruthy();
            engine.ConnectorRegistry.isReady = true;
            act(() => engine.ConnectorRegistry.emit('ready'));
            expect(outline()).toEqual([
                'General',
                'Name',
                'Early Site',
                'Early',
                'Late Site',
                'Late',
            ]);
            expect(screen.queryByText(/^Loading connectors/)).toBeNull();
            expect(controlOf('Name').value).toBe('edited');
            expect(controlOf('Early').value).toBe('also edited');
            expect(controlOf('Late').value).toBe('l');
        });

        it('should save the edits of the settings that were there and of those that came late', async () => {
            const groups = early();
            const late = setting({ label: 'Late', value: 'l' });
            const { settings, onClose } = await openMenu({ groups, ready: false });
            type('Name', 'edited');
            settings.groups.push(group('Late Site', late));
            engine.ConnectorRegistry.isReady = true;
            act(() => engine.ConnectorRegistry.emit('ready'));
            type('Late', 'edited too');
            fireEvent.click(saveButton());
            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            expect(groups[0].settings[0].value).toBe('edited');
            expect(groups[1].settings[0].value).toBe('e');
            expect(late.value).toBe('edited too');
        });

        it('should not draw a category twice, which the engine hands out again, when the connectors become ready', async () => {
            await openMenu({ groups: early(), ready: false });
            engine.ConnectorRegistry.isReady = true;
            act(() => engine.ConnectorRegistry.emit('ready'));
            act(() => engine.ConnectorRegistry.emit('ready'));
            expect(outline()).toEqual(['General', 'Name', 'Early Site', 'Early']);
            expect(screen.queryByText(/^Loading connectors/)).toBeNull();
        });
    });

    describe('views', () => {
        it.each([
            ['Downloads', '/', '/downloads'],
            ['Bookmarks', '/', '/bookmarks'],
            ['Start', '/downloads', '/'],
        ])('should close the popup and go to the view %s', async (name, from, to) => {
            const { router, onClose } = await openMenu({ url: from });
            expect(router.state.location.pathname).toBe(from);
            fireEvent.click(screen.getByRole('button', { name }));
            expect(onClose).toHaveBeenCalledTimes(1);
            await waitFor(() => expect(router.state.location.pathname).toBe(to));
        });

        it('should not save anything when it goes to a view', async () => {
            const name = setting({ label: 'Name', value: 'old' });
            const { settings, router } = await openMenu({ groups: [group('General', name)] });
            type('Name', 'new');
            fireEvent.click(screen.getByRole('button', { name: 'Downloads' }));
            await waitFor(() => expect(router.state.location.pathname).toBe('/downloads'));
            expect(settings.save).not.toHaveBeenCalled();
            expect(name.value).toBe('old');
        });
    });

    describe('about', () => {
        it('should show the version of the engine, and open its history', async () => {
            const open = vi.spyOn(window, 'open').mockImplementation(() => null);
            await openMenu();
            const revision = screen.getByText('main@abc1234');
            expect(revision.getAttribute('title')).toBe('Revision History');
            fireEvent.click(revision);
            expect(open).toHaveBeenCalledTimes(1);
            expect(open.mock.calls[0].slice(0, 2)).toEqual([
                'https://example.test/revision',
                '_blank',
            ]);
        });

        it('should open nothing when the engine knows no link for its revision', async () => {
            const open = vi.spyOn(window, 'open').mockImplementation(() => null);
            await openMenu({ members: { Version: undefined } });
            fireEvent.click(screen.getByTitle('Revision History'));
            expect(open).not.toHaveBeenCalled();
        });

        it('should show the current year', async () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(new Date('2031-06-15T12:00:00Z'));
            await openMenu();
            expect(screen.getByText(/©\s*2031/)).toBeTruthy();
        });

        it.each([
            [
                'the name of the project',
                () => screen.getByText('RakKomik'),
                'https://github.com/akn19/rakkomik',
            ],
            [
                'the contributors',
                () => screen.getByText('Contributors'),
                'https://github.com/akn19/rakkomik/graphs/contributors',
            ],
            [
                'the homepage',
                () => screen.getByTitle('Visit the RakKomik Homepage'),
                'https://github.com/akn19/rakkomik',
            ],
            [
                'the documentation',
                () => screen.getByTitle('Read the Online Documentation'),
                'https://github.com/akn19/rakkomik#readme',
            ],
            [
                'the tickets',
                () => screen.getByTitle('Open a Ticket on GitHub'),
                'https://github.com/akn19/rakkomik/issues',
            ],
            [
                'the geolocation',
                () => screen.getByTitle('Show your external IP and Geolocation'),
                'https://ipinfo.io/json',
            ],
        ])(
            'should open %s in a window of its own, not in the application',
            async (name, find, url) => {
                const open = vi.spyOn(window, 'open').mockImplementation(() => null);
                await openMenu();
                fireEvent.click(find());
                expect(open).toHaveBeenCalledTimes(1);
                expect(open.mock.calls[0].slice(0, 2)).toEqual([url, '_blank']);
            },
        );

        it('should give a link of the project a tooltip that says where it goes', async () => {
            await openMenu();
            expect(screen.getByText('RakKomik').getAttribute('title')).toBe(
                'https://github.com/akn19/rakkomik',
            );
            expect(screen.getByText('Contributors').getAttribute('title')).toBe(
                'https://github.com/akn19/rakkomik/graphs/contributors',
            );
        });
    });

    describe('browsing for a path', () => {
        const browseButton = (label) => within(rowOf(label)).getByRole('button');

        it('should put the directory that was chosen into the draft, and start the dialog at the one that is in it', async () => {
            const directory = setting({
                input: 'directory',
                label: 'Manga Directory',
                value: '/mangas',
            });
            const { onClose } = await openMenu({ groups: [group('General', directory)] });
            engine.Storage.folderBrowser.mockResolvedValueOnce('/new/mangas');
            fireEvent.click(browseButton('Manga Directory'));
            await waitFor(() => expect(controlOf('Manga Directory').value).toBe('/new/mangas'));
            expect(engine.Storage.folderBrowser).toHaveBeenLastCalledWith('/mangas');
            // the engine is not changed until the settings are saved
            expect(directory.value).toBe('/mangas');
            // the next dialog starts where the last choice was
            engine.Storage.folderBrowser.mockResolvedValueOnce('/newer');
            fireEvent.click(browseButton('Manga Directory'));
            await waitFor(() => expect(controlOf('Manga Directory').value).toBe('/newer'));
            expect(engine.Storage.folderBrowser).toHaveBeenLastCalledWith('/new/mangas');
            fireEvent.click(saveButton());
            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            expect(directory.value).toBe('/newer');
        });

        it.each([
            ['cancelled', null],
            ['closed without an answer', undefined],
            ['answered with an empty path', ''],
        ])('should leave the directory as it was when the dialog is %s', async (name, answer) => {
            const directory = setting({
                input: 'directory',
                label: 'Manga Directory',
                value: '/mangas',
            });
            await openMenu({ groups: [group('General', directory)] });
            engine.Storage.folderBrowser.mockResolvedValueOnce(answer);
            fireEvent.click(browseButton('Manga Directory'));
            await waitFor(() => expect(engine.Storage.folderBrowser).toHaveBeenCalledTimes(1));
            await act(async () => undefined);
            expect(controlOf('Manga Directory').value).toBe('/mangas');
        });

        it('should put the file that was chosen into the draft, from the dialog of the window', async () => {
            const bridge = installBridge();
            const file = setting({ input: 'file', label: 'Key file', value: '' });
            const { onClose } = await openMenu({ groups: [group('General', file)] });
            bridge.dialog.showOpenDialog.mockResolvedValueOnce({
                canceled: false,
                filePaths: ['/keys/id_ed25519', '/keys/other'],
            });
            fireEvent.click(browseButton('Key file'));
            await waitFor(() => expect(controlOf('Key file').value).toBe('/keys/id_ed25519'));
            expect(bridge.dialog.showOpenDialog).toHaveBeenCalledExactlyOnceWith({
                properties: ['openFile'],
            });
            expect(file.value).toBe('');
            fireEvent.click(saveButton());
            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            expect(file.value).toBe('/keys/id_ed25519');
        });

        it.each([
            ['cancelled', { canceled: true, filePaths: ['/keys/ignored'] }],
            ['confirmed without a file', { canceled: false, filePaths: [] }],
            ['answered without a list of files', { canceled: false }],
            ['answered with nothing', undefined],
        ])('should leave the file as it was when the dialog is %s', async (name, answer) => {
            const bridge = installBridge();
            await openMenu({
                groups: [
                    group(
                        'General',
                        setting({ input: 'file', label: 'Key file', value: '/keys/id' }),
                    ),
                ],
            });
            bridge.dialog.showOpenDialog.mockResolvedValueOnce(answer);
            fireEvent.click(browseButton('Key file'));
            await waitFor(() => expect(bridge.dialog.showOpenDialog).toHaveBeenCalledTimes(1));
            await act(async () => undefined);
            expect(controlOf('Key file').value).toBe('/keys/id');
        });

        it('should say so, and leave the directory as it was, when the dialog cannot be shown', async () => {
            const directory = setting({
                input: 'directory',
                label: 'Manga Directory',
                value: '/mangas',
            });
            await openMenu({ groups: [group('General', directory)] });
            engine.Storage.folderBrowser.mockRejectedValueOnce(new Error('no display'));
            fireEvent.click(browseButton('Manga Directory'));
            expect(await screen.findByText('Failed to choose a path: no display')).toBeTruthy();
            expect(controlOf('Manga Directory').value).toBe('/mangas');
        });

        it('should say so, and leave the file as it was, when the dialog of the window fails', async () => {
            const bridge = installBridge();
            await openMenu({
                groups: [
                    group(
                        'General',
                        setting({ input: 'file', label: 'Key file', value: '/keys/id' }),
                    ),
                ],
            });
            bridge.dialog.showOpenDialog.mockRejectedValueOnce(new Error('IPC failed'));
            fireEvent.click(browseButton('Key file'));
            expect(await screen.findByText('Failed to choose a path: IPC failed')).toBeTruthy();
            expect(controlOf('Key file').value).toBe('/keys/id');
        });

        it('should leave the file as it was when the window has no dialog to ask', async () => {
            await openMenu({
                groups: [
                    group(
                        'General',
                        setting({ input: 'file', label: 'Key file', value: '/keys/id' }),
                    ),
                ],
            });
            expect(window.hakuneko).toBeUndefined();
            fireEvent.click(browseButton('Key file'));
            await act(async () => undefined);
            expect(controlOf('Key file').value).toBe('/keys/id');
        });
    });

    // The popup is written for what Settings.mjs hands out, and the fake settings of the other tests are a copy of that: here the
    // settings are the real ones, so that a setting or an input type that the engine gets is not forgotten by the popup.
    describe('with the settings of the real engine', () => {
        // what the popup draws for an input type: the field, whether it can be typed into, and how many buttons come with it
        const DRAWN = {
            text: { field: 'text', typed: true, buttons: 0 },
            password: { field: 'password', typed: true, buttons: 0 },
            numeric: { field: 'number', typed: true, buttons: 0 },
            select: { field: 'select', typed: true, buttons: 0 },
            checkbox: { field: 'checkbox', typed: true, buttons: 0 },
            file: { field: 'text', typed: false, buttons: 1 },
            directory: { field: 'text', typed: false, buttons: 1 },
            disabled: { field: 'text', typed: false, buttons: 0 },
        };

        function realEngine() {
            window.hakuneko = { app: { getPath: () => '/docs' }, platform: 'linux', env: {} };
            const settings = new Settings();
            const west = createConnector({
                id: 'west',
                label: 'West',
                config: {
                    throttle: {
                        label: 'Throttle Requests',
                        description: 'Milliseconds between two requests',
                        input: 'numeric',
                        min: 0,
                        max: 5000,
                        value: 1000,
                    },
                    token: {
                        label: 'Access Token',
                        description: 'The token of the account',
                        input: 'password',
                        value: '',
                    },
                },
            });
            engine = installEngine({ connectors: [west], engine: { Settings: settings } });
            engine.Storage.saveConfig = vi.fn(async () => undefined);
            engine.Storage.directoryExist = vi.fn(async () => undefined);
            return { settings, west };
        }

        it('should draw a control that fits the input type of every setting, and know every input type that the engine has', async () => {
            const { settings, west } = realEngine();
            const refs = [...settings, ...Object.values(west.config)];
            expect(refs.length).toBeGreaterThan(10);
            expect(
                [...new Set(refs.map((ref) => ref.input))].filter((input) => !(input in DRAWN)),
            ).toEqual([]);
            await renderRouted(<MenuPopup onClose={vi.fn()} />, { selection: false });
            for (const ref of refs) {
                const row = rowOf(ref.label);
                const control = row.querySelector('input, select');
                const drawn = DRAWN[ref.input];
                expect(control.tagName === 'SELECT' ? 'select' : control.type, ref.label).toBe(
                    drawn.field,
                );
                expect(!!(control.disabled || control.readOnly), ref.label).toBe(!drawn.typed);
                expect(row.querySelectorAll('button'), ref.label).toHaveLength(drawn.buttons);
                expect(screen.getByText(ref.label).getAttribute('title'), ref.label).toBe(
                    ref.description,
                );
                if (ref.input === 'numeric') {
                    expect(control.getAttribute('min'), ref.label).toBe(String(ref.min));
                    expect(control.getAttribute('max'), ref.label).toBe(String(ref.max));
                }
                if (ref.input === 'select') {
                    expect(
                        [...control.options].map((option) => option.textContent),
                        ref.label,
                    ).toEqual(ref.options.map((option) => option.name));
                    expect(control.value, ref.label).toBe(ref.value);
                }
                if (ref.input === 'checkbox') {
                    expect(control.checked, ref.label).toBe(ref.value);
                }
            }
        });

        it('should draw the settings of the engine in the order of its categories: the general ones, then those of each website', async () => {
            realEngine();
            await renderRouted(<MenuPopup onClose={vi.fn()} />, { selection: false });
            const headings = [...document.querySelectorAll('th[colspan]')].map(
                (node) => node.textContent,
            );
            expect(headings).toEqual(['General', 'West']);
        });

        it('should save the edits through the settings of the engine: limited, encrypted, announced, and read back', async () => {
            const { settings, west } = realEngine();
            const saved = vi.fn();
            settings.addEventListener('saved', saved);
            const onClose = vi.fn();
            await renderRouted(<MenuPopup onClose={onClose} />, { selection: false });
            type('De-Scrambling Quality', '150');
            type('Proxy Authentication', 'user:secret');
            type('Throttle Requests', '9999');
            fireEvent.click(controlOf('Use Sub-Directories'));
            fireEvent.click(saveButton());
            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            expect(engine.Storage.saveConfig).toHaveBeenCalledTimes(1);
            const [key, data] = engine.Storage.saveConfig.mock.calls[0];
            expect(key).toBe('settings');
            expect(data.recompressionQuality).toBe(100);
            expect(data.useSubdirectory).toBe(true);
            expect(data.proxyAuth).not.toBe('user:secret');
            expect(data.connectors.west).toEqual({ throttle: 5000, token: '' });
            expect(settings.recompressionQuality.value).toBe(100);
            expect(west.config.throttle.value).toBe(5000);
            expect(saved).toHaveBeenCalledTimes(1);
            // what was saved is what the engine reads back at the next start
            settings.proxyAuth.value = '';
            engine.Storage.loadConfig = vi.fn(async () => data);
            await settings.load();
            expect(settings.proxyAuth.value).toBe('user:secret');
            expect(settings.useSubdirectory.value).toBe(true);
        });
    });

    describe('importing bookmarks', () => {
        const database = () =>
            new File(['SQLite format 3'], 'favorites.db', { type: 'application/x-sqlite3' });

        it('should open the file chooser that only offers databases when the import button is clicked', async () => {
            await openMenu();
            const clicked = vi.fn();
            importInput().addEventListener('click', clicked);
            expect(importInput().getAttribute('accept')).toBe('application/x-sqlite3,.db,.db3');
            fireEvent.click(importButton());
            expect(clicked).toHaveBeenCalledTimes(1);
        });

        it('should import the file that was chosen, tell so, and forget the choice', async () => {
            const user = userEvent.setup();
            await openMenu();
            const file = database();
            await user.upload(importInput(), file);
            expect(await screen.findByText('Bookmarks imported.')).toBeTruthy();
            expect(engine.BookmarkManager.importBookmarks).toHaveBeenCalledExactlyOnceWith(file);
            expect(toastOf('Bookmarks imported.').className).toMatch(/green/);
            expect(importInput().files).toHaveLength(0);
            expect(importInput().value).toBe('');
        });

        it('should be able to import the same file again, which the browser only allows when the choice was forgotten', async () => {
            const user = userEvent.setup();
            await openMenu();
            const file = database();
            await user.upload(importInput(), file);
            await waitFor(() =>
                expect(engine.BookmarkManager.importBookmarks).toHaveBeenCalledTimes(1),
            );
            await waitFor(() => expect(importInput().files).toHaveLength(0));
            await user.upload(importInput(), file);
            await waitFor(() =>
                expect(engine.BookmarkManager.importBookmarks).toHaveBeenCalledTimes(2),
            );
            expect(engine.BookmarkManager.importBookmarks.mock.calls[1][0]).toBe(file);
        });

        it('should show the message of the engine when the import fails, forget the choice, and not say that it worked', async () => {
            const user = userEvent.setup();
            await openMenu();
            engine.BookmarkManager.importBookmarks.mockRejectedValueOnce(
                new Error("File type 'text/plain' is not supported!"),
            );
            await user.upload(importInput(), database());
            expect(
                await screen.findByText("File type 'text/plain' is not supported!"),
            ).toBeTruthy();
            expect(toastOf("File type 'text/plain' is not supported!").className).toMatch(/red/);
            expect(screen.queryByText('Bookmarks imported.')).toBeNull();
            expect(importInput().files).toHaveLength(0);
            // and the next try is possible with the same file
            await user.upload(importInput(), database());
            expect(await screen.findByText('Bookmarks imported.')).toBeTruthy();
        });

        it('should keep the popup and its draft while it imports', async () => {
            const user = userEvent.setup();
            const name = setting({ label: 'Name', value: 'old' });
            const { onClose } = await openMenu({ groups: [group('General', name)] });
            type('Name', 'edited');
            await user.upload(importInput(), database());
            await screen.findByText('Bookmarks imported.');
            expect(onClose).not.toHaveBeenCalled();
            expect(controlOf('Name').value).toBe('edited');
        });
    });
});

describe('menu popup for the keyboard and the screen reader', () => {
    it('should be a modal dialog named Menu, with the parts under headings and the views as navigation', async () => {
        await openMenu({ groups: [group('General', setting({ label: 'Name' }))] });
        const dialog = screen.getByRole('dialog', { name: 'Menu' });
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(
            screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
        ).toEqual(['Views', 'About', 'Settings']);
        expect(
            within(screen.getByRole('navigation', { name: 'Views' }))
                .getAllByRole('button')
                .map((button) => button.textContent),
        ).toEqual(['Start', 'Downloads', 'Bookmarks']);
    });

    it('should mark the view that is shown as the current one', async () => {
        await openMenu({ url: '/downloads' });
        expect(screen.getByRole('button', { name: 'Downloads' }).getAttribute('aria-current')).toBe(
            'page',
        );
        expect(
            screen.getByRole('button', { name: 'Start' }).getAttribute('aria-current'),
        ).toBeNull();
    });

    it('should take the focus when it opens, keep Tab inside, and give the focus back to the button that opened it', async () => {
        const user = userEvent.setup();
        await openLikeTheShell([group('General', setting({ label: 'Name', value: 'x' }))]);
        const dialog = screen.getByRole('dialog', { name: 'Menu' });
        expect(document.activeElement).toBe(dialog);
        await user.tab({ shift: true });
        expect(document.activeElement).toBe(closeButton());
        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Start' }));
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull();
        // the shell gave the focus to nothing in particular before: it stays where it is
        fireEvent.click(screen.getByRole('button', { name: 'Open the menu' }));
        expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Menu' }));
    });

    it('should label every setting, and describe it with its tooltip', async () => {
        await openMenu({ groups: typedGroups() });
        for (const [label, description] of [
            ['Text', 'A text'],
            ['Password', 'A secret'],
            ['Quality', 'A number'],
            ['Format', 'A choice'],
            ['Reader', 'A switch'],
            ['Key file', 'A file'],
            ['Manga Directory', 'A directory'],
            ['Bookmarks Directory', 'Cannot be changed'],
        ]) {
            const control = screen.getByLabelText(label);
            expect(control, label).toBe(controlOf(label));
            expect(
                document.getElementById(control.getAttribute('aria-describedby')).textContent,
                label,
            ).toBe(description);
        }
        expect(screen.getByRole('button', { name: 'Choose a file for Key file' })).toBeTruthy();
        expect(
            screen.getByRole('button', { name: 'Choose a folder for Manga Directory' }),
        ).toBeTruthy();
    });

    it('should head the table of the settings with the categories', async () => {
        await openMenu({
            groups: [
                group('General', setting({ label: 'Name' })),
                group('Site', setting({ label: 'Key' })),
            ],
        });
        expect(
            [...document.querySelectorAll('th[scope="rowgroup"]')].map(
                (heading) => heading.textContent,
            ),
        ).toEqual(['General', 'Site']);
        // each category is a group of rows of its own
        expect(screen.getByText('General').closest('table').querySelectorAll('tbody')).toHaveLength(
            2,
        );
    });

    it('should make the links of the credits real links that the keyboard reaches, and still open them outside', async () => {
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        await openMenu();
        const link = screen.getByRole('link', { name: 'Contributors' });
        expect(link.getAttribute('href')).toBe(
            'https://github.com/akn19/rakkomik/graphs/contributors',
        );
        const notPrevented = fireEvent.click(link);
        expect(notPrevented).toBe(false);
        expect(open).toHaveBeenCalledExactlyOnceWith(
            'https://github.com/akn19/rakkomik/graphs/contributors',
            '_blank',
            'nodeIntegration=no',
        );
    });

    it('should name the buttons that import, save and close', async () => {
        await openMenu();
        expect(screen.getByRole('button', { name: 'Import bookmarks' })).toBe(importButton());
        expect(screen.getByRole('button', { name: 'Save settings and close menu' })).toBe(
            saveButton(),
        );
        expect(screen.getByRole('button', { name: 'Close menu without saving settings' })).toBe(
            closeButton(),
        );
        expect(screen.getByRole('button', { name: 'Open a Ticket on GitHub' })).toBeTruthy();
    });
});

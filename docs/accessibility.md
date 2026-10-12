# Accessibility

The user interface (`src/web/ui`) is built to WCAG 2.2 level AA. This page says what that means for the code, which
patterns the components use, how it is checked and what is known to fall short.

## What the interface does

- **Keyboard.** Everything can be done with the keyboard. Tab reaches every control; the two lists have their own keys
  (see [keyboard](#keyboard)). Nothing traps the focus: a dialog keeps Tab inside and gives the focus back to the control
  that opened it when it closes. Shortcuts that are a single character (`+`, `-`, `*`, `/` in the reader) only work while
  the reader, or nothing in particular, has the focus (WCAG 2.1.4).
- **Focus.** The control that has the keyboard focus shows a ring (`:focus-visible` in `index.css`, the colour
  `--focus-ring-color`) that has a contrast of at least 3:1 against every background of the theme. The mouse does not
  draw it.
- **Names and roles.** Every button that shows an icon has an `aria-label`; its tooltip (`title`) becomes its description.
  The settings have `<label for>` and are described by their tooltip (`aria-describedby`). The panels, the download bar
  and the content pane are landmarks (`<section aria-labelledby>`, `<main>`), the parts of the menu and of the website
  picker have headings. The popups are dialogs (`role="dialog"`, `aria-modal`). What changes on its own is announced:
  toasts are `role="status"`, errors `role="alert"`, counters and loading messages `role="status"`.
- **Colour.** The colours of both themes meet 4.5:1 for text and 3:1 for icons, focus rings and the other parts of
  controls, each against the background that it is drawn on (`Contrast.test.jsx` checks the pairs). Nothing is told by
  colour alone: a selected row or card has a mark (`.rk-selected`, `.rk-selected-ring`) next to its background, a
  bookmarked manga a star in front of its title, a chapter its status as an icon and a label, a pressed tag or marker
  `aria-pressed`.
- **Size.** Every button is at least 24 x 24 pixels (`button` in `index.css`, WCAG 2.5.8), and the window can be zoomed
  with Control + and -, Control 0 resets it (the menu of the application, WCAG 1.4.4). The reader keeps Control + and -
  for the spacing of its pages while it reads.
- **Motion.** When the system asks for less motion (`prefers-reduced-motion`), the spinners stand still, the progress bar
  does not sweep and the reader scrolls in one jump. An error stays until it is dismissed, so that it can be read; the
  other messages leave after four seconds.

## Keyboard

| Where | Keys |
|---|---|
| Manga list (a list box) | The list has the focus. Up and Down move between the mangas, Page Up and Page Down by a screen, Home and End to the ends; Enter or Space selects the manga the keys are on. A click selects and leaves the keys on the manga that was clicked. |
| Chapter list (a grid) | Tab stops on one cell. Up and Down move between the chapters, Left and Right between the cells of a chapter (status, preview, marker, title), Page Up and Page Down by a screen, Home and End to the ends of the row, with Control to the ends of the list. Enter or Space works the button of a cell; Enter on the title opens the folder of the chapter, as a double click does. |
| Website picker, menu, questions | Escape closes; Tab goes round inside; the focus goes back to the control that opened the dialog. |
| Reader | Unchanged: the arrows and Page Up and Down scroll, Left and Right change the chapter, Space is the magic scroll, `+` `-` `*` `/` the size of the pages, Control + and - their spacing, Escape closes. |
| Window | Control + and - zoom, Control 0 resets the zoom. |

## How it is checked

- `src/web/ui/__tests__/Contrast.test.jsx` reads the tokens of `index.css` and checks the contrast of every pair of
  colours that the interface draws, in both themes. A new colour belongs in its table.
- The tests of the components (`__tests__/*.test.jsx`) try the keyboard of the lists and the dialogs and check the
  names, roles and states.
- `pnpm run lint` runs the `jsx-a11y` rules of oxlint over the interface (`.oxlintrc.json`): labels, roles, key handlers
  for click handlers, focus for interactive roles. `prefer-tag-over-role` is off, because the virtual lists are made of
  `div`s with roles on purpose.
- `src/__tests__/Accessibility.e2e.mjs` (part of `pnpm run test:e2e`) runs axe-core over the real application in both
  themes: the start page, the menu, the website picker, the chapter list, the downloads, the bookmarks and the reader,
  and tries the keyboard of the lists, a dialog and the zoom of the window.

## Known limitations

- The layout is two panels next to the content pane in a desktop window; it does not reflow to a width of 320 pixels
  (WCAG 1.4.10). At a zoom of 200 percent the panels take most of a window of 1120 pixels and the content pane gets
  narrow; the reader itself takes the whole window and is not affected.
- The text of a novel is shown as the website wrote it: it has no language mark of its own (WCAG 3.1.2).
- The tooltips (`title`) only show for the mouse, as every browser shows them; a screen reader reads them as the
  description of the control, and the keyboard has the names and the labels.

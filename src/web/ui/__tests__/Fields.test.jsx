import { fireEvent, render, screen } from '@testing-library/react';
import { CheckboxField, NumberField, PasswordField, PathField, SelectField, TextField } from '../fields.jsx';

function type(element, value) {
    fireEvent.change(element, { target: { value } });
}

describe('text field', () => {
    it('should show the value and report what is typed as a string', () => {
        const onChange = vi.fn();
        render(<TextField value="abc" onChange={onChange} title="Name" />);
        const input = screen.getByTitle('Name');
        expect(input.value).toBe('abc');
        type(input, 'abcd');
        expect(onChange).toHaveBeenCalledExactlyOnceWith('abcd');
    });

    it.each([undefined, null])('should show an empty field for %s, not the word', value => {
        render(<TextField value={value} onChange={vi.fn()} title="Name" />);
        expect(screen.getByTitle('Name').value).toBe('');
    });

    it('should keep a value of 0 and the empty string apart from a missing value', () => {
        render(<TextField value={0} onChange={vi.fn()} title="Zero" />);
        expect(screen.getByTitle('Zero').value).toBe('0');
    });

    it('should be possible to disable it', () => {
        render(<TextField value="x" disabled onChange={vi.fn()} title="Locked" />);
        expect(screen.getByTitle('Locked').disabled).toBe(true);
    });
});

describe('password field', () => {
    it('should hide what is typed and report it unchanged', () => {
        const onChange = vi.fn();
        render(<PasswordField value="secret" onChange={onChange} title="Password" />);
        const input = screen.getByTitle('Password');
        expect(input.type).toBe('password');
        expect(input.value).toBe('secret');
        type(input, 'secret 2');
        expect(onChange).toHaveBeenCalledExactlyOnceWith('secret 2');
    });

    it('should show an empty field for a missing value', () => {
        render(<PasswordField onChange={vi.fn()} title="Password" />);
        expect(screen.getByTitle('Password').value).toBe('');
    });
});

describe('number field', () => {
    function numberField(props) {
        const onChange = vi.fn();
        const { container } = render(<NumberField value={5} min={1} max={10} onChange={onChange} {...props} />);
        return { input: container.querySelector('input'), onChange };
    }

    it('should hand its limits to the input', () => {
        const { input } = numberField();
        expect(input.type).toBe('number');
        expect(input.min).toBe('1');
        expect(input.max).toBe('10');
    });

    it.each([['7', 7], ['0', 0], ['-3', -3], ['2.5', 2.5]])('should report %s as the number %d', (typed, expected) => {
        const { input, onChange } = numberField();
        type(input, typed);
        expect(onChange).toHaveBeenCalledExactlyOnceWith(expected);
    });

    it('should report an emptied field as an empty string and not as 0, so that it can be told from a real 0', () => {
        const { input, onChange } = numberField();
        type(input, '');
        expect(onChange).toHaveBeenCalledExactlyOnceWith('');
    });

    it('should show 0 as 0 and a missing value as an empty field', () => {
        expect(numberField({ value: 0 }).input.value).toBe('0');
        document.body.innerHTML = '';
        expect(numberField({ value: undefined }).input.value).toBe('');
    });
});

describe('select field', () => {
    const options = [{ value: '.cbz', name: 'Comic Book Archive' }, { value: '.epub', name: 'Ebook' }];

    it('should list the options by name and select the current one', () => {
        render(<SelectField value=".epub" options={options} onChange={vi.fn()} />);
        const select = screen.getByRole('combobox');
        expect([...select.options].map(option => [option.value, option.textContent])).toEqual([
            ['.cbz', 'Comic Book Archive'],
            ['.epub', 'Ebook']
        ]);
        expect(select.value).toBe('.epub');
    });

    it('should report the value of the chosen option', () => {
        const onChange = vi.fn();
        render(<SelectField value=".cbz" options={options} onChange={onChange} />);
        type(screen.getByRole('combobox'), '.epub');
        expect(onChange).toHaveBeenCalledExactlyOnceWith('.epub');
    });

    it('should draw no options, and not fail, when there are none', () => {
        render(<SelectField value="x" onChange={vi.fn()} />);
        expect(screen.getByRole('combobox').options).toHaveLength(0);
    });

    it('should accept options whose values are not strings', () => {
        render(<SelectField value="2" options={[{ value: 1, name: 'One' }, { value: 2, name: 'Two' }]} onChange={vi.fn()} />);
        const select = screen.getByRole('combobox');
        expect(select.value).toBe('2');
        expect([...select.options].map(option => option.textContent)).toEqual(['One', 'Two']);
    });
});

describe('checkbox field', () => {
    it.each([[true, true], [false, false], [undefined, false], [null, false], [1, true], ['', false]])('should show %j as checked: %s', (value, checked) => {
        render(<CheckboxField value={value} onChange={vi.fn()} />);
        expect(screen.getByRole('checkbox').checked).toBe(checked);
    });

    it('should report the new state as a boolean', () => {
        const onChange = vi.fn();
        render(<CheckboxField value={false} onChange={onChange} />);
        fireEvent.click(screen.getByRole('checkbox'));
        expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
    });
});

describe('path field', () => {
    it('should show the path, which cannot be typed but can be read, with the browse button next to it', () => {
        const onBrowse = vi.fn();
        render(<PathField value="/home/me/manga" onBrowse={onBrowse} />);
        const input = screen.getByTitle('/home/me/manga');
        expect(input.value).toBe('/home/me/manga');
        expect(input.readOnly).toBe(true);
        expect(input.disabled).toBe(false);
        fireEvent.click(screen.getByTitle('Browse …'));
        expect(onBrowse).toHaveBeenCalledTimes(1);
    });

    it('should use the title that it is given for the browse button', () => {
        render(<PathField value="" browseTitle="Choose file …" onBrowse={vi.fn()} />);
        expect(screen.getByTitle('Choose file …')).toBeTruthy();
        expect(screen.queryByTitle('Browse …')).toBeNull();
    });

    it('should not browse while it is disabled', () => {
        const onBrowse = vi.fn();
        render(<PathField value="" disabled onBrowse={onBrowse} />);
        const button = screen.getByTitle('Browse …');
        expect(button.disabled).toBe(true);
        fireEvent.click(button);
        expect(onBrowse).not.toHaveBeenCalled();
    });
});

describe('fields for the screen reader', () => {
    it.each([
        ['text', props => <TextField {...props} />],
        ['password', props => <PasswordField {...props} />],
        ['number', props => <NumberField {...props} />],
        ['select', props => <SelectField options={[]} {...props} />],
        ['checkbox', props => <CheckboxField {...props} />],
        ['path', props => <PathField onBrowse={vi.fn()} {...props} />]
    ])('should take the id of its label and the id of its description: %s field', (name, field) => {
        const { container } = render(field({ value: '', onChange: vi.fn(), id: 'the-field', describedBy: 'the-description' }));
        const control = container.querySelector('input, select');
        expect(control.id).toBe('the-field');
        expect(control.getAttribute('aria-describedby')).toBe('the-description');
    });

    it('should name the browse button of a path for the screen reader, apart from its tooltip', () => {
        render(<PathField value="/mangas" onBrowse={vi.fn()} browseTitle="Browse …" browseLabel="Choose a folder for Manga Directory" />);
        expect(screen.getByRole('button', { name: 'Choose a folder for Manga Directory' }).title).toBe('Browse …');
    });

    it('should name the browse button after its tooltip when it is given no name', () => {
        render(<PathField value="/mangas" onBrowse={vi.fn()} browseTitle="Choose file …" />);
        expect(screen.getByRole('button', { name: 'Choose file …' })).toBeTruthy();
    });
});

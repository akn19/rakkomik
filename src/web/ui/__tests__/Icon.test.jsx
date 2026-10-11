import fs from 'node:fs';
import path from 'node:path';
import { render } from '@testing-library/react';
import Icon from '../icon.jsx';

function svgOf(props) {
    const { container } = render(<Icon {...props} />);
    return container.querySelector('svg');
}

// the shape of the icon: Lucide names it in the class of the element (`lucide-x`, `lucide-circle-x`, ...)
function shapeOf(svg) {
    return [...svg.classList].filter(name => name.startsWith('lucide-')).join(' ');
}

describe('icon', () => {
    it('should be hidden from assistive technology and 14 pixels big by default', () => {
        const svg = svgOf({ name: 'search' });
        expect(svg.getAttribute('aria-hidden')).toBe('true');
        expect(svg.getAttribute('width')).toBe('14');
        expect(svg.getAttribute('height')).toBe('14');
    });

    it('should take the size that it is given', () => {
        expect(svgOf({ name: 'search', size: 28 }).getAttribute('width')).toBe('28');
    });

    it('should be an outline, unless it is asked to be filled', () => {
        expect(svgOf({ name: 'star' }).getAttribute('fill')).toBe('none');
        expect(svgOf({ name: 'star', filled: true }).getAttribute('fill')).toBe('currentColor');
    });

    it('should turn when it spins, and keep the class that it is given', () => {
        expect(svgOf({ name: 'spinner', spin: true }).classList.contains('animate-spin')).toBe(true);
        const svg = svgOf({ name: 'spinner', spin: true, className: 'mr-1' });
        expect(svg.classList.contains('animate-spin')).toBe(true);
        expect(svg.classList.contains('mr-1')).toBe(true);
    });

    it('should not turn, and not write "undefined" into its class, when there is no class', () => {
        const svg = svgOf({ name: 'spinner' });
        expect(svg.classList.contains('animate-spin')).toBe(false);
        expect(svg.getAttribute('class')).not.toMatch(/undefined/);
    });

    it('should draw the close icon for a name that does not exist', () => {
        expect(shapeOf(svgOf({ name: 'no-such-icon' }))).toBe(shapeOf(svgOf({ name: 'close' })));
        expect(shapeOf(svgOf({}))).toBe(shapeOf(svgOf({ name: 'close' })));
    });

    it('should draw different shapes for different names', () => {
        const names = ['plug', 'refresh', 'search', 'language', 'star', 'download', 'folder', 'folderClosed', 'cloud', 'cloudDownload'];
        expect(new Set(names.map(name => shapeOf(svgOf({ name })))).size).toBe(names.length);
    });
});

// A name that is not in the table is not an error, it quietly draws the close icon. So the names that the interface uses
// are collected from its sources, and every one of them has to be drawn as itself.
describe('the icons that the interface uses', () => {
    const root = path.resolve(import.meta.dirname, '..');
    const sources = [...fs.readdirSync(root), ...fs.readdirSync(path.join(root, 'views')).map(name => path.join('views', name))]
        .filter(name => name.endsWith('.jsx'))
        .map(name => [name, fs.readFileSync(path.join(root, name), 'utf8')]);

    function usedNames(source) {
        const names = new Set();
        const quoted = text => [...text.matchAll(/['"]([A-Za-z]+)['"]/g)].forEach(match => names.add(match[1]));
        for (const match of source.matchAll(/<Icon\b[^>]*?\bname=(?:"([^"]+)"|\{([^}]*)\})/g)) {
            quoted(match[1] ? `"${match[1]}"` : match[2]);
        }
        for (const match of source.matchAll(/\bicon(?:=|:\s*)["']([A-Za-z]+)["']/g)) {
            names.add(match[1]);
        }
        for (const match of source.matchAll(/SORT_ICON = \{([^}]*)\}/g)) {
            quoted(match[1]);
        }
        return names;
    }

    it('should have been found at all', () => {
        const all = new Set(sources.flatMap(([, source]) => [...usedNames(source)]));
        expect(all.size).toBeGreaterThan(30);
        expect(all.has('refresh')).toBe(true);
        expect(all.has('sortAlphaUp')).toBe(true);
        expect(all.has('closeBox')).toBe(true);
    });

    it.each(sources)('should all exist in %s', (name, source) => {
        const fallback = shapeOf(svgOf({ name: 'no-such-icon' }));
        const missing = [...usedNames(source)].filter(icon => icon !== 'close' && shapeOf(svgOf({ name: icon })) === fallback);
        expect(missing).toEqual([]);
    });
});

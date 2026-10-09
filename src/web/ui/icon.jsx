import {
    ArrowLeft,
    ArrowDownToLine,
    BookOpen,
    Bookmark,
    ChevronLeft,
    ChevronRight,
    Download,
    FolderOpen,
    House,
    Minus,
    Moon,
    Plug,
    Settings as SettingsIcon,
    Square,
    Star,
    Sun,
    X
} from 'lucide-react';

/**
 * Single icon component (audit §5.8: Font Awesome → Lucide).
 * Tree-shaken (only the used icons join the bundle), offline-safe.
 * `filled` renders solid glyphs (e.g. active bookmark stars).
 */
const ICONS = {
    back: ArrowLeft,
    bookmark: Bookmark,
    book: BookOpen,
    chevronLeft: ChevronLeft,
    chevronRight: ChevronRight,
    close: X,
    disconnect: Plug,
    download: Download,
    downloadToLine: ArrowDownToLine,
    folder: FolderOpen,
    home: House,
    magicScroll: ArrowDownToLine,
    maximize: Square,
    minimize: Minus,
    moon: Moon,
    settings: SettingsIcon,
    star: Star,
    sun: Sun
};

export default function Icon({ name, size, filled, className }) {
    const Component = ICONS[name] || X;
    return (
        <Component
            size={size || 14}
            className={className}
            fill={filled ? 'currentColor' : 'none'}
            aria-hidden="true"
        />
    );
}

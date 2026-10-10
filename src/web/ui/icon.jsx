import {
    ArrowDownAZ,
    ArrowLeft,
    ArrowLeftRight,
    ArrowDownToLine,
    ArrowUpAZ,
    ArrowUpDown,
    Ban,
    BookOpen,
    Bookmark,
    Bug,
    ChartNoAxesColumn,
    Check,
    ChevronLeft,
    ChevronRight,
    CircleCheck,
    CircleMinus,
    CirclePlus,
    CircleX,
    ClipboardPaste,
    Clock,
    Cloud,
    CloudDownload,
    Download,
    FileInput,
    Folder,
    FolderOpen,
    House,
    Image,
    Info,
    Languages,
    Loader,
    Minus,
    Menu,
    MessageCircle,
    Moon,
    PersonStanding,
    Plug,
    RefreshCw,
    Search,
    Settings as SettingsIcon,
    Square,
    Star,
    Sun,
    TriangleAlert,
    X
} from 'lucide-react';

/**
 * Single icon component (audit §5.8: Font Awesome → Lucide).
 * Tree-shaken (only the used icons join the bundle), offline-safe.
 * `filled` renders solid glyphs (e.g. active bookmark stars).
 */
const ICONS = {
    back: ArrowLeft,
    ban: Ban,
    bookmark: Bookmark,
    book: BookOpen,
    bug: Bug,
    chart: ChartNoAxesColumn,
    check: Check,
    checkCircle: CircleCheck,
    chevronLeft: ChevronLeft,
    chevronRight: ChevronRight,
    clock: Clock,
    close: X,
    closeCircle: CircleX,
    cloud: Cloud,
    cloudDownload: CloudDownload,
    disconnect: Plug,
    discord: MessageCircle,
    download: Download,
    downloadToLine: ArrowDownToLine,
    exchange: ArrowLeftRight,
    folder: FolderOpen,
    folderClosed: Folder,
    home: House,
    image: Image,
    import: FileInput,
    info: Info,
    language: Languages,
    magicScroll: ArrowDownToLine,
    maximize: Square,
    menu: Menu,
    minimize: Minus,
    minusCircle: CircleMinus,
    moon: Moon,
    paste: ClipboardPaste,
    plug: Plug,
    plusCircle: CirclePlus,
    refresh: RefreshCw,
    search: Search,
    settings: SettingsIcon,
    sort: ArrowUpDown,
    sortAlphaDown: ArrowDownAZ,
    sortAlphaUp: ArrowUpAZ,
    spinner: Loader,
    star: Star,
    streetView: PersonStanding,
    sun: Sun,
    warning: TriangleAlert
};

export default function Icon({ name, size, filled, spin, className }) {
    const Component = ICONS[name] || X;
    return (
        <Component
            size={size || 14}
            className={spin ? `animate-spin ${className || ''}` : className}
            fill={filled ? 'currentColor' : 'none'}
            aria-hidden="true"
        />
    );
}

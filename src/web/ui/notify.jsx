import React from 'react';

const ToastContext = React.createContext(null);

let nextId = 1;

export function ToastProvider({ children }) {
    const [toasts, setToasts] = React.useState([]);
    const dismiss = React.useCallback(id => {
        setToasts(current => current.filter(toast => toast.id !== id));
    }, []);
    const notify = React.useCallback((message, type) => {
        const id = nextId++;
        setToasts(current => [...current, { id, message, type: type || 'info' }]);
        setTimeout(() => dismiss(id), 4000);
        return id;
    }, [dismiss]);
    const value = React.useMemo(() => ({ notify, dismiss }), [notify, dismiss]);
    return (
        <ToastContext.Provider value={value}>
            {children}
            <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
                {toasts.map(toast => (
                    <div
                        key={toast.id}
                        className={
                            'pointer-events-auto rounded border px-3 py-2 text-sm shadow-lg ' +
                            (toast.type === 'error'
                                ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
                                : toast.type === 'success'
                                    ? 'border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200'
                                    : 'border-zinc-300 bg-white text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200')
                        }
                    >
                        <div className="flex items-start justify-between gap-2">
                            <span>{toast.message}</span>
                            <button
                                type="button"
                                onClick={() => dismiss(toast.id)}
                                className="shrink-0 opacity-60 hover:opacity-100"
                                title="Dismiss"
                            >
                                &#10005;
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast() {
    const context = React.useContext(ToastContext);
    if (!context) {
        throw new Error('useToast() must be used inside <ToastProvider>!');
    }
    return context;
}

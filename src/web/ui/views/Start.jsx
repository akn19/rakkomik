import React from 'react';
import QUOTES from '../quotes.js';

function pickQuote() {
    return QUOTES[Math.floor(Math.random() * QUOTES.length)];
}

const STEPS = [
    'Select your connector (the website) and use the filters.',
    'Click the refresh button to fetch the manga list (can take minutes).',
    'Find a manga, then pick a chapter to download or read.'
];

export default function StartView() {
    const quote = React.useMemo(pickQuote, []);
    return (
        <div className="mx-auto max-w-3xl space-y-6">
            <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
                <h1 className="text-xl font-semibold">Welcome to RakKomik</h1>
                <p className="mt-2 text-sm leading-relaxed">
                    RakKomik helps you download media for offline usage — ad-hoc consumption,
                    get it when you want to read it. RakKomik hosts nothing itself: find a
                    website that provides the content you want, then follow the steps below.
                </p>
            </section>
            <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
                <h2 className="text-base font-semibold">Getting started</h2>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                    {STEPS.map(step => (
                        <li key={step}>{step}</li>
                    ))}
                </ol>
            </section>
            <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
                <blockquote className="space-y-1">
                    {quote.lines.map(line => (
                        <p key={line} className="text-sm italic">{line}</p>
                    ))}
                    <footer className="pt-1 text-xs text-zinc-500 dark:text-zinc-400">— {quote.author}</footer>
                </blockquote>
            </section>
        </div>
    );
}

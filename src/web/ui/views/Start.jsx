import React from 'react';
import QUOTES from '../quotes.js';
import Icon from '../icon.jsx';

function pickQuote() {
    return QUOTES[Math.floor(Math.random() * QUOTES.length)];
}

const CARD = 'rounded-[1em] border-2 border-black/15 bg-(--start-card-background-color) p-[1em]';

/** Classic start.html parity: welcome card, how-to card, closing card. */
export default function StartView() {
    const quote = React.useMemo(pickQuote, []);
    return (
        <div className="text-[1.25em]">
            <h1 className="mt-0 mb-0 text-[1.5em] font-bold">Welcome to RakKomik</h1>
            <p className={CARD + ' my-[1em] flow-root'}>
                <img src="/img/logo_s.png" alt="" className="float-left mr-[1em] rounded-[10%]" />
                <strong>RakKomik</strong> was made to help users who download media for circumstances that requires
                offline usage.
                <br />
                The philosophy is <u>ad-hoc consumption</u>, get it when you want to read/watch it.
                <br />
                Read the documentation on GitHub (link available in the menu)
            </p>
            <h3 className="mb-[0.1em] text-[1.17em] font-bold">Find a site to get the content you want to view</h3>
            <div className={CARD}>
                <strong>RakKomik</strong> is not hosting anything. Find a website on the internet that provides the
                content you want. Then :
                <ol className="my-[1em] list-decimal pl-[2.5em]">
                    <li>
                        <Icon name="plug" size={16} className="rk-icon mr-[0.25em] inline -scale-x-100 align-text-bottom" />
                        Select your connector (the website). Use the filters
                    </li>
                    <li>
                        <Icon name="refresh" size={16} className="rk-icon mr-[0.25em] inline align-text-bottom" />
                        Click on the refresh button (can take minutes)
                    </li>
                    <li>
                        <Icon name="search" size={16} className="rk-icon mr-[0.25em] inline align-text-bottom" />
                        Find a manga
                    </li>
                    <li>
                        <Icon name="language" size={16} className="rk-icon mr-[0.25em] inline align-text-bottom" />
                        Filter chapters by language (optional)
                    </li>
                    <li>
                        <Icon name="search" size={16} className="rk-icon mr-[0.25em] inline align-text-bottom" />
                        Select a chapter
                    </li>
                </ol>
                The connector you are looking for is not in the list ?
                <br />
                👉 Create a website request on the github (issue)
                <br />
                Use the copy/paste feature if you already have the manga link
                <br />
                👉 See the documentation for details
            </div>
            <h3 className="mt-[1em] mb-[0.1em] text-[1.17em] font-bold">Ready to go 🚀</h3>
            <div className={CARD}>Download, view, bookmark your favorite mangas 📚</div>
            <blockquote className={CARD + ' mt-[1em] space-y-1'}>
                {quote.lines.map(line => (
                    <p key={line} className="italic">{line}</p>
                ))}
                <footer className="pt-1 text-right italic">— {quote.author}</footer>
            </blockquote>
        </div>
    );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard' },
  { href: '/models', label: 'Models' },
  { href: '/releases', label: 'Releases' },
  { href: '/category/coding', label: 'Categories', match: '/category/' },
  { href: '/compare', label: 'Compare' },
  { href: '/hardware', label: 'Hardware' },
  { href: '/voice', label: 'Voice' },
  { href: '/video', label: 'Video' },
  { href: '/admin', label: 'Data health' },
  { href: '/methodology', label: 'Method' },
];

function navLinkClass(active: boolean) {
  return `px-3 py-1.5 rounded text-sm transition-colors ${
    active
      ? 'bg-zinc-800 text-zinc-100'
      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
  }`;
}

export function Navigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  function itemLink(item: (typeof NAV_ITEMS)[number], keyPrefix: string) {
    const isActive = item.href === '/'
      ? pathname === '/'
      : pathname.startsWith('match' in item && item.match ? item.match : item.href);
    return (
      <Link
        key={`${keyPrefix}-${item.href}`}
        href={item.href}
        className={navLinkClass(isActive)}
        aria-current={isActive ? 'page' : undefined}
        onClick={() => setOpen(false)}
      >
        {item.label}
      </Link>
    );
  }

  return (
    <nav className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <Link href="/" onClick={() => setOpen(false)} className="flex items-center gap-2 text-zinc-100 font-semibold tracking-tight">
            <span className="text-emerald-400 text-lg">*</span>
            <span>Local LLM Radar</span>
          </Link>
          <div className="hidden xl:flex items-center gap-1">
            {NAV_ITEMS.map((item) => itemLink(item, 'desktop'))}
          </div>
          <button
            type="button"
            className="xl:hidden px-3 py-1.5 rounded text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? 'Close' : 'Menu'}
          </button>
        </div>
        {open && (
          <div id="mobile-nav" className="xl:hidden pb-3 flex flex-col gap-1">
            {NAV_ITEMS.map((item) => itemLink(item, 'mobile'))}
          </div>
        )}
      </div>
    </nav>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MODEL_FAMILIES, modelFamilyForPath } from '@/lib/model-navigation';

export function ModelTypeButtons() {
  const pathname = usePathname();
  const selected = modelFamilyForPath(pathname);
  if (!selected) return null;
  return <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 space-y-3">
    <nav aria-label="Model type" className="flex flex-wrap gap-1.5">
      {MODEL_FAMILIES.map(family => <Link key={family.id} href={family.href} aria-current={selected.id === family.id ? 'page' : undefined} className={`rounded border px-3 py-1.5 text-xs font-medium transition-colors ${selected.id === family.id ? 'border-emerald-700 bg-emerald-900/30 text-emerald-300' : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'}`}>{family.label}</Link>)}
    </nav>
    {selected.options.length > 0 && <nav aria-label={`${selected.label} leaderboard`} className="flex flex-wrap gap-1">
      {selected.options.map(option => <Link key={option.href} href={option.href} aria-current={pathname === option.href ? 'page' : undefined} className={`px-2.5 py-1 rounded text-xs transition-colors ${pathname === option.href ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300'}`}>{option.label}</Link>)}
    </nav>}
  </div>;
}

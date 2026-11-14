'use client';

import { textReleaseEvidence } from '@/lib/model-release';

import { compareReleaseDates } from '@/lib/model-release';
import { ReleaseDate } from '@/components/ReleaseDate';
import { useState } from 'react';
import Link from 'next/link';

interface ModelRow {
  metadata_sources?: import('@/lib/merge-models').MergedModel['metadata_sources'];
  model_id?: string;
  modelId?: string;
  name: string;
  slug: string;
  provider: string;
  release?: string | null;
  parameter_count?: number | null;
  model_type: string;
  rank?: number | null;
  rank_change?: number | null;
  previous_rank?: number | null;
  score?: number;
  estimated_vram_q4_gb?: number | null;
  coverage?: number | null;
  rank_status?: string;
  hardwareFit?: {
    fit: string;
    bestQuantization: string | null;
    explanation: string;
  };
}

interface ModelTableProps {
  models: ModelRow[];
  showRank?: boolean;
  showHardwareFit?: boolean;
  showScore?: boolean;
  onCompareToggle?: (modelSlug: string) => void;
  compareList?: string[];
}

interface SortHeaderProps {
  field: string;
  children: React.ReactNode;
  sortField: string;
  sortDir: 'asc' | 'desc';
  onSort: (field: string) => void;
}

function SortHeader({ field, children, sortField, sortDir, onSort }: SortHeaderProps) {
  return (
    <th
      className="px-3 py-2 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider cursor-pointer hover:text-zinc-300 select-none"
      onClick={() => onSort(field)}
      tabIndex={0}
      aria-sort={sortField === field ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSort(field); } }}
    >
      <span className="flex items-center gap-1">
        {children}
        {sortField === field && (
          <span className="text-emerald-400">{sortDir === 'asc' ? '^' : 'v'}</span>
        )}
      </span>
    </th>
  );
}

export function ModelTable({
  models,
  showRank = true,
  showHardwareFit = false,
  showScore = true,
  onCompareToggle,
  compareList = [],
}: ModelTableProps) {
  const [sortField, setSortField] = useState<string>('rank');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'rank' ? 'asc' : 'desc');
    }
  };

  const sorted = [...models].sort((a, b) => {
    if (sortField === 'release') return compareReleaseDates(a.release, b.release, sortDir);
    let aVal: number | string;
    let bVal: number | string;
    switch (sortField) {
      case 'rank': aVal = a.rank ?? Infinity; bVal = b.rank ?? Infinity; break;
      case 'name': aVal = a.name; bVal = b.name; break;
      case 'score': aVal = a.score ?? 0; bVal = b.score ?? 0; break;
      case 'params': aVal = a.parameter_count ?? 0; bVal = b.parameter_count ?? 0; break;
      default: aVal = 0; bVal = 0;
    }
    if (typeof aVal === 'string') {
      const aText = aVal;
      const bText = String(bVal);
      return sortDir === 'asc' ? aText.localeCompare(bText) : bText.localeCompare(aText);
    }
    const aNumber = Number(aVal);
    const bNumber = Number(bVal);
    return sortDir === 'asc' ? aNumber - bNumber : bNumber - aNumber;
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-zinc-800">
          <tr>
            {onCompareToggle && <th className="px-3 py-2 w-8" />}
            {showRank && <SortHeader field="rank" sortField={sortField} sortDir={sortDir} onSort={handleSort}>#</SortHeader>}
            {showRank && <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider" title="Week-over-week rank change">Trend</th>}
            <SortHeader field="name" sortField={sortField} sortDir={sortDir} onSort={handleSort}>Model</SortHeader>
            <SortHeader field="release" sortField={sortField} sortDir={sortDir} onSort={handleSort}>Released</SortHeader>
            <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Type</th>
            <SortHeader field="params" sortField={sortField} sortDir={sortDir} onSort={handleSort}>Params</SortHeader>
            {showScore && <SortHeader field="score" sortField={sortField} sortDir={sortDir} onSort={handleSort}>Index</SortHeader>}
            {showScore && <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Evidence</th>}
            <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">VRAM (Q4)</th>
            {showHardwareFit && (
              <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">HW Fit</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {sorted.map((model, i) => (
            <tr key={model.slug || i} className="hover:bg-zinc-900/50 transition-colors">
              {onCompareToggle && (
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={compareList.includes(model.slug)}
                    onChange={() => onCompareToggle(model.slug)}
                    className="rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500/20 cursor-pointer"
                  />
                </td>
              )}
              {showRank && (
                <td className="px-3 py-2 text-zinc-500 font-mono text-xs">
                  {model.rank ?? '-'}
                </td>
              )}
              {showRank && (
                <td className="px-3 py-2 font-mono text-xs">
                  {model.rank_change == null ? (
                    <span className="text-zinc-600" title="No comparable prior rank for this view">–</span>
                  ) : model.rank_change > 0 ? (
                    <span className="text-emerald-400" title={`Up ${model.rank_change} from #${model.previous_rank}`}>↑{model.rank_change}</span>
                  ) : model.rank_change < 0 ? (
                    <span className="text-red-400" title={`Down ${Math.abs(model.rank_change)} from #${model.previous_rank}`}>↓{Math.abs(model.rank_change)}</span>
                  ) : (
                    <span className="text-zinc-500" title="No change">—</span>
                  )}
                </td>
              )}
              <td className="px-3 py-2">
                <Link
                  href={`/models/${model.slug}`}
                  className="text-zinc-200 hover:text-emerald-400 transition-colors font-medium"
                >
                  {model.name}
                </Link>
                <div className="text-zinc-600 text-xs">{model.provider}</div>
              </td>
              <td className="px-3 py-2 text-xs text-zinc-500"><ReleaseDate value={model.release} evidence={textReleaseEvidence(model)} /></td>
              <td className="px-3 py-2">
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    model.model_type === 'open-weight'
                      ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-800/50'
                      : model.model_type === 'closed'
                      ? 'bg-amber-900/40 text-amber-400 border border-amber-800/50'
                      : 'bg-blue-900/40 text-blue-400 border border-blue-800/50'
                  }`}
                  title={
                    model.model_type === 'open-weight'
                      ? 'Open weights — you can download and self-host this model. Whether it fits YOUR machine depends on its size; check the Hardware page.'
                      : model.model_type === 'closed'
                      ? 'Closed API-only model — cannot be run locally'
                      : 'Downloadable weight availability is unverified; check the provider'
                  }
                >
                  {model.model_type === 'open-weight' ? 'OPEN' :
                   model.model_type === 'closed' ? 'API' : 'WEIGHTS UNKNOWN'}
                </span>
              </td>
              <td className="px-3 py-2 text-zinc-400 font-mono text-xs">
                {model.parameter_count ? `${model.parameter_count}B` : '—'}
              </td>
              {showScore && (
                <td className="px-3 py-2 text-zinc-200 font-mono text-xs">
                  {model.score !== undefined ? model.score.toFixed(1) : '—'}
                </td>
              )}
              {showScore && (
                <td className="px-3 py-2 text-xs">
                  <span className={model.rank_status === 'ranked' ? 'text-emerald-500' : model.rank_status === 'provisional' ? 'text-amber-500' : 'text-zinc-600'}>
                    {model.coverage != null ? `${Math.round(model.coverage * 100)}%` : '—'}
                  </span>
                </td>
              )}
              <td className="px-3 py-2 text-zinc-500 font-mono text-xs">
                {model.estimated_vram_q4_gb ? `${model.estimated_vram_q4_gb}GB` : '—'}
              </td>
              {showHardwareFit && model.hardwareFit && (
                <td className="px-3 py-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    model.hardwareFit.fit === 'fits-well'
                      ? 'bg-emerald-900/40 text-emerald-400'
                      : model.hardwareFit.fit === 'borderline'
                      ? 'bg-amber-900/40 text-amber-400'
                      : model.hardwareFit.fit === 'too-large'
                      ? 'bg-red-900/40 text-red-400'
                      : 'bg-zinc-800 text-zinc-500'
                  }`}>
                    {model.hardwareFit.fit}
                  </span>
                  {model.hardwareFit.bestQuantization && (
                    <span className="ml-1.5 text-[10px] text-zinc-500">
                      {model.hardwareFit.bestQuantization}
                    </span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length === 0 && (
        <div className="text-center py-12 text-zinc-600">
          No models found. Run a refresh to fetch data.
        </div>
      )}
    </div>
  );
}

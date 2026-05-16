import Link from 'next/link';
import { candidateToSlug } from '../../lib/slug.js';
import { Sparkline } from './Sparkline.js';

export interface BarRowProps {
  candidato: string;
  pct: number;        // 0-100
  maxPct: number;     // para escalar (el bar fill se calcula sobre el más alto)
  delta7d?: number;   // pp, signo incluido (e.g. +1.2 / -0.4)
  sparkline?: number[]; // serie de price (0-1) o pct (0-100), sólo importa la forma
  linkable?: boolean;
}

export function BarRow({ candidato, pct, maxPct, delta7d, sparkline, linkable = true }: BarRowProps) {
  const fillPct = Math.min(100, (pct / Math.max(maxPct, 1)) * 100);
  const deltaSign = delta7d != null && delta7d >= 0 ? '+' : '';
  const deltaColor = delta7d != null ? (delta7d >= 0 ? 'text-pageInk' : 'text-caption') : '';
  const inner = (
    <>
      <div className="font-sans font-bold text-sm sm:text-base w-24 sm:w-44 truncate text-pageInk shrink-0">
        {candidato}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className="bg-ink h-6"
          style={{ width: `${fillPct}%`, minWidth: 6 }}
        />
      </div>
      {sparkline && sparkline.length >= 2 && (
        <div className="hidden sm:block text-pageInk shrink-0" aria-hidden>
          <Sparkline points={sparkline} />
        </div>
      )}
      {delta7d != null && (
        <div
          className={`font-mono text-xs ${deltaColor} shrink-0 tabular-nums w-14 text-right hidden sm:block`}
          title="Δ 7 días"
        >
          {deltaSign}
          {delta7d.toFixed(1)}pp
        </div>
      )}
      <div className="font-mono font-bold text-sm sm:text-base text-pageInk shrink-0 tabular-nums w-12 sm:w-14 text-right">
        {pct.toFixed(1)}%
      </div>
    </>
  );
  return linkable ? (
    <Link
      href={`/c/${candidateToSlug(candidato)}` as never}
      className="flex items-center gap-3 py-1 hover:text-accent group"
    >
      {inner}
    </Link>
  ) : (
    <div className="flex items-center gap-3 py-1">{inner}</div>
  );
}

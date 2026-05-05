import Link from 'next/link';
import { candidateToSlug } from '../../lib/slug.js';

export interface BarRowProps {
  candidato: string;
  pct: number;        // 0-100
  maxPct: number;     // para escalar (el bar fill se calcula sobre el más alto)
  linkable?: boolean;
}

export function BarRow({ candidato, pct, maxPct, linkable = true }: BarRowProps) {
  const fillPct = Math.min(100, (pct / Math.max(maxPct, 1)) * 100);
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

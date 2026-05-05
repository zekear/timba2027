import Link from 'next/link';
import { candidateToSlug } from '../../lib/slug.js';

export interface BarRowProps {
  candidato: string;
  pct: number;        // 0-100
  maxPct: number;     // para escalar
  linkable?: boolean;
}

const MAX_W = 480;

export function BarRow({ candidato, pct, maxPct, linkable = true }: BarRowProps) {
  const w = Math.max(8, (pct / Math.max(maxPct, 1)) * MAX_W);
  const inner = (
    <>
      <div className="font-sans font-bold text-base w-44 truncate text-pageInk">{candidato}</div>
      <div className="bg-ink h-6" style={{ width: w }} />
      <div className="font-mono font-bold text-base text-pageInk">{pct.toFixed(1)}%</div>
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

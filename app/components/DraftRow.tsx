import { basename } from 'node:path';

export interface DraftRowProps {
  id: number;
  shape: string;
  caption: string;
  cardPath: string;
  generatedAt: Date;
  candidateFocus: string | null;
  llmSource: string | null;
}

export function DraftRow(p: DraftRowProps) {
  const cardFile = basename(p.cardPath);
  const cardUrl = `/api/cards/${encodeURIComponent(cardFile)}`;
  return (
    <a
      href={`/posts/${p.id}`}
      className="block border-b border-hairline py-4 hover:bg-paper transition-colors"
    >
      <div className="flex gap-6 items-start">
        <img src={cardUrl} alt="" className="w-48 h-27 border border-ink object-cover" />
        <div className="flex-1 min-w-0">
          <div className="font-mono text-xs uppercase tracking-wide text-caption">
            {p.shape} · #{p.id} · {p.generatedAt.toLocaleString('es-AR')}
            {p.candidateFocus ? ` · focus: ${p.candidateFocus}` : null}
            {p.llmSource ? ` · caption: ${p.llmSource}` : null}
          </div>
          <p className="font-serif text-lg mt-2 text-pageInk">{p.caption}</p>
        </div>
      </div>
    </a>
  );
}

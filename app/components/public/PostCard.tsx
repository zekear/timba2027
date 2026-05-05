import Link from 'next/link';
import { basename } from 'node:path';

export interface PublicPostProps {
  id: number;
  shape: string;
  caption: string;
  cardPath: string;
  publishedAt: Date | null;
}

const SHAPE_LABEL: Record<string, string> = {
  morning_brief: 'MORNING BRIEF',
  market_move: 'POLYMARKET MOVE',
  new_poll: 'NUEVA ENCUESTA',
  hot_news: 'HOT NEWS',
};

export function PostCard({ id, shape, caption, cardPath, publishedAt }: PublicPostProps) {
  const cardFile = basename(cardPath);
  const cardUrl = `/api/cards/${encodeURIComponent(cardFile)}`;
  const ts = publishedAt ? publishedAt.toLocaleDateString('es-AR') : 's/d';
  return (
    <article className="border-b border-hairline pb-6 mb-6">
      <div className="font-mono text-xs uppercase tracking-wide text-caption mb-2">
        {SHAPE_LABEL[shape] ?? shape} · {ts}
      </div>
      <Link href={`/posts/${id}` as never} className="block group">
        <img src={cardUrl} alt="" className="w-full border-2 border-ink mb-3 group-hover:opacity-90 transition-opacity" />
        <p className="font-serif text-xl leading-snug text-pageInk group-hover:text-accent">
          {caption}
        </p>
      </Link>
    </article>
  );
}

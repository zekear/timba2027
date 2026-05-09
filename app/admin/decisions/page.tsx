import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export const dynamic = 'force-dynamic';

const REASON_LABEL: Record<string, string> = {
  candidate_cooldown: 'Cooldown de candidato',
  daily_cap: 'Tope diario alcanzado',
  quiet_hour: 'Hora silenciosa',
};

interface DiscardedRow {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  discard_reason: string | null;
  created_at: Date;
  processed_at: Date | null;
}

function summarizePayload(type: string, payload: Record<string, unknown>): string {
  if (type === 'MARKET_MOVE') {
    const c = payload.candidate as string | undefined;
    const d = payload.deltaPct as number | undefined;
    const s = payload.marketSlug as string | undefined;
    if (c && d != null) {
      const sign = d >= 0 ? '+' : '';
      return `${c} ${sign}${d.toFixed(1)}pp${s ? ` (${s})` : ''}`;
    }
  }
  if (type === 'HOT_NEWS') {
    const h = payload.headline as string | undefined;
    if (h) return h.slice(0, 100);
  }
  if (type === 'NEW_POLL') {
    const t = payload.topCandidate as string | undefined;
    const p = payload.topCandidatePct as number | undefined;
    if (t && p != null) return `${t} ${p.toFixed(1)}%`;
  }
  return JSON.stringify(payload).slice(0, 100);
}

export default async function Decisions() {
  const result = await db.execute(sql`
    SELECT id, type, payload, discard_reason, created_at, processed_at
    FROM events
    WHERE status = 'discarded'
    ORDER BY processed_at DESC NULLS LAST, created_at DESC
    LIMIT 100
  `);
  const rows = result.rows as unknown as DiscardedRow[];

  const byReason = new Map<string, number>();
  for (const r of rows) {
    const k = r.discard_reason ?? '(sin razón)';
    byReason.set(k, (byReason.get(k) ?? 0) + 1);
  }

  return (
    <main className="max-w-5xl mx-auto p-8">
      <header className="border-b-2 border-ink pb-4 mb-6">
        <div className="font-mono text-xs uppercase tracking-wide text-caption mb-2">
          <a href="/admin" className="text-accent underline">← review queue</a>
        </div>
        <h1 className="font-serif text-5xl">Decisiones del bot</h1>
        <div className="font-mono text-xs uppercase tracking-wide text-caption mt-2">
          Últimos {rows.length} events descartados (cooldown, caps, quiet hours)
        </div>
      </header>

      {byReason.size > 0 && (
        <section className="mb-8">
          <h2 className="font-mono text-xs uppercase tracking-wide font-bold border-b border-hairline pb-2 mb-3">
            Por razón
          </h2>
          <ul className="font-mono text-xs uppercase tracking-wide grid grid-cols-2 gap-y-1">
            {[...byReason.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([reason, count]) => (
                <li key={reason}>
                  <span className="text-caption">{REASON_LABEL[reason] ?? reason}:</span>{' '}
                  <span className="font-bold">{count}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {rows.length === 0 ? (
        <p className="text-caption">No hay decisiones registradas todavía.</p>
      ) : (
        <table className="w-full font-mono text-xs">
          <thead>
            <tr className="border-b-2 border-ink uppercase tracking-wide text-left">
              <th className="py-2">Cuándo</th>
              <th className="py-2">Tipo</th>
              <th className="py-2">Razón</th>
              <th className="py-2">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const when = r.processed_at ?? r.created_at;
              const ts = when
                ? new Date(when).toLocaleString('es-AR', {
                    timeZone: 'America/Argentina/Buenos_Aires',
                    hour12: false,
                  })
                : '—';
              return (
                <tr key={r.id} className="border-b border-hairline align-top">
                  <td className="py-2 pr-3 whitespace-nowrap text-caption">{ts}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{r.type}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {REASON_LABEL[r.discard_reason ?? ''] ?? r.discard_reason ?? '—'}
                  </td>
                  <td className="py-2">{summarizePayload(r.type, r.payload)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}

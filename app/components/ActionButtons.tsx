'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ActionButtons({ postId, status }: { postId: number; status: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  async function act(action: 'approve' | 'kill' | 'publish-now'): Promise<void> {
    setLoading(action);
    const res = await fetch(`/api/posts/${postId}/${action}`, { method: 'POST' });
    setLoading(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      // eslint-disable-next-line no-restricted-globals
      (globalThis as unknown as { alert(m: string): void }).alert(
        `Action failed: ${(body as { error?: string }).error ?? res.statusText}`,
      );
      return;
    }
    router.refresh();
  }

  const btn = 'border-2 border-ink px-4 py-2 font-mono text-sm uppercase tracking-wide hover:bg-ink hover:text-paper transition-colors';
  const btnDanger = btn + ' border-red-700 hover:bg-red-700';

  return (
    <div className="flex gap-3 mt-6">
      {(status === 'draft') && (
        <button onClick={() => act('approve')} disabled={!!loading} className={btn}>
          {loading === 'approve' ? '…' : 'Approve'}
        </button>
      )}
      {(status === 'draft' || status === 'approved') && (
        <button onClick={() => act('publish-now')} disabled={!!loading} className={btn}>
          {loading === 'publish-now' ? '…' : 'Publish now (skip delay)'}
        </button>
      )}
      {status !== 'published' && status !== 'killed' && (
        <button onClick={() => act('kill')} disabled={!!loading} className={btnDanger}>
          {loading === 'kill' ? '…' : 'Kill'}
        </button>
      )}
    </div>
  );
}

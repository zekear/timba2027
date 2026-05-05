'use client';

import { useEffect, useState } from 'react';

export default function AdminPage() {
  const [state, setState] = useState<{ kill_switch?: string; publish_mode?: string }>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/admin/state')
      .then((r) => r.json() as Promise<{ kill_switch?: string; publish_mode?: string }>)
      .then(setState);
  }, []);

  async function update(key: 'kill_switch' | 'publish_mode', value: string): Promise<void> {
    setSaving(true);
    const res = await fetch('/api/admin/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
    setSaving(false);
    if (!res.ok) {
      (globalThis as unknown as { alert(m: string): void }).alert('Failed to save');
      return;
    }
    setState((s) => ({ ...s, [key]: value }));
  }

  const killOn = state.kill_switch === 'true';

  return (
    <main className="max-w-2xl mx-auto p-8">
      <h1 className="font-serif text-4xl border-b-2 border-ink pb-4 mb-6">Admin</h1>

      <section className="mb-8">
        <div className="font-mono text-xs uppercase tracking-wide text-caption mb-2">Kill switch</div>
        <button
          onClick={() => update('kill_switch', killOn ? 'false' : 'true')}
          disabled={saving}
          className={
            killOn
              ? 'border-2 border-red-700 bg-red-700 text-paper px-6 py-3 font-mono uppercase tracking-wide'
              : 'border-2 border-ink px-6 py-3 font-mono uppercase tracking-wide hover:bg-ink hover:text-paper'
          }
        >
          {killOn ? '🚨 KILL SWITCH ACTIVE — click to disable' : 'Kill switch off (click to activate)'}
        </button>
        <p className="text-caption text-sm mt-2">
          Mientras esté activo, ningún post se publica a X. Drafts se siguen generando normalmente.
        </p>
      </section>

      <section className="mb-8">
        <div className="font-mono text-xs uppercase tracking-wide text-caption mb-2">Publish mode</div>
        <div className="flex gap-3">
          {(['shadow', 'soft', 'full'] as const).map((m) => (
            <button
              key={m}
              onClick={() => update('publish_mode', m)}
              disabled={saving}
              className={
                state.publish_mode === m
                  ? 'border-2 border-ink bg-ink text-paper px-4 py-2 font-mono uppercase tracking-wide'
                  : 'border-2 border-ink px-4 py-2 font-mono uppercase tracking-wide hover:bg-ink hover:text-paper'
              }
            >
              {m}
            </button>
          ))}
        </div>
        <p className="text-caption text-sm mt-2">
          Shadow: no publica. Soft: 9-22hs ARG, cap 3, delay 60s. Full: 24/7 con quiet hours, cap 6.
        </p>
      </section>

      <a href="/admin" className="font-mono text-xs uppercase tracking-wide text-accent underline">← back to queue</a>
    </main>
  );
}

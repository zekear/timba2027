import { env } from '../../../src/lib/env.js';

export function Footer() {
  const handle = env.BOT_HANDLE.replace(/^@/, '');
  return (
    <footer className="border-t-2 border-ink mt-16">
      <div className="max-w-5xl mx-auto px-6 py-8 font-mono text-xs uppercase tracking-wide text-caption space-y-2">
        <p>
          🤖 Datos automatizados · Polymarket + encuestas locales + noticias mainstream argentinas.
        </p>
        <p>
          Sin afiliación política. Cada post tiene fuente verificable. No es asesoramiento ni predicción.
        </p>
        <p>
          <a
            href={`https://x.com/${handle}`}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline"
          >
            @{handle}
          </a>
          {' · '}
          <a
            href="https://github.com/zekear/timba2027"
            target="_blank"
            rel="noreferrer"
            className="text-accent underline"
          >
            código en github
          </a>
        </p>
      </div>
    </footer>
  );
}

export function Footer() {
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
          <a href="https://github.com/ezeqmina/ar-elections-2027" className="text-accent underline">code</a>
          {' · '}
          <a href="/admin" className="text-accent underline">admin</a>
        </p>
      </div>
    </footer>
  );
}

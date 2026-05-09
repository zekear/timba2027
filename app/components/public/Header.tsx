import Link from 'next/link';

export function Header() {
  return (
    <header className="border-b-2 border-ink">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-baseline gap-6">
        <Link href="/" className="font-serif text-2xl font-normal hover:text-accent flex items-baseline gap-2">
          <span>TIMBA</span>
          <span className="font-mono text-xs uppercase tracking-wide text-caption">2027</span>
        </Link>
        <nav className="font-mono text-xs uppercase tracking-wide text-pageInk flex gap-4 ml-auto">
          <Link href="/2027" className="hover:text-accent">2027</Link>
          <Link href="/" className="hover:text-accent">posts</Link>
        </nav>
      </div>
    </header>
  );
}

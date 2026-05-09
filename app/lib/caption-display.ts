/**
 * En X la URL al final de la caption se envuelve en t.co automáticamente.
 * En el sitio público preferimos mostrar el texto sin la URL larga, y
 * el link al artículo aparte como "fuente → dominio.com".
 */
const URL_RE = /https?:\/\/[^\s)]+/g;

export function splitCaptionAndUrl(caption: string): { text: string; url: string | null } {
  const match = caption.match(URL_RE);
  const url = match?.[0] ?? null;
  const text = url ? caption.replace(url, '').trim() : caption;
  return { text, url };
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

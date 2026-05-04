export interface NewsFeed {
  source: string;       // identificador corto, va a la columna news.source
  url: string;          // URL del feed RSS
  active: boolean;
}

export const FEEDS: NewsFeed[] = [
  { source: 'clarin', url: 'https://www.clarin.com/rss/politica/', active: true },
  { source: 'lanacion', url: 'https://www.lanacion.com.ar/arc/outboundfeeds/rss/category/politica/?outputType=xml', active: true },
  { source: 'infobae', url: 'https://www.infobae.com/feeds/rss/sections/politica/', active: true },
  { source: 'pagina12', url: 'https://www.pagina12.com.ar/rss/secciones/el-pais/notas', active: true },
  { source: 'cenital', url: 'https://www.cenital.com/feed/', active: true },
  { source: 'letrap', url: 'https://www.letrap.com.ar/rss/politica.xml', active: true },
  { source: 'ambito', url: 'https://www.ambito.com/rss/politica.xml', active: true },
  { source: 'perfil', url: 'https://www.perfil.com/feed/politica', active: true },
];

// Nota: las URLs son tentativas. Ezequiel debe verificar cada una con `curl -I` o navegador
// y ajustar si alguna devuelve 404 o cambió de path. Después del primer run podemos podar
// las que no respondan.

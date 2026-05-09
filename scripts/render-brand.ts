/**
 * Genera logo (400×400) + banner (1500×500) + favicon (256×256).
 * Run: pnpm tsx scripts/render-brand.ts
 *
 * Outputs:
 *   storage/cards/brand-logo.png
 *   storage/cards/brand-banner.png
 *   storage/cards/brand-favicon.png
 */
import { renderToPng } from '../src/render/compose.js';
import { logoCard, bannerCard, faviconCard, brandSizes } from '../src/render/cards/brand.js';
import { env } from '../src/lib/env.js';

const handle = env.BOT_HANDLE;
const domain = env.SITE_URL.replace(/^https?:\/\//, '');

const { absPath: logoAbs } = await renderToPng(
  logoCard({ handle, domain }),
  'brand-logo',
  brandSizes.logo,
);
console.log('Logo:   ', logoAbs);

const { absPath: bannerAbs } = await renderToPng(
  bannerCard({ handle, domain }),
  'brand-banner',
  brandSizes.banner,
);
console.log('Banner: ', bannerAbs);

const { absPath: faviconAbs } = await renderToPng(
  faviconCard(),
  'brand-favicon',
  brandSizes.favicon,
);
console.log('Favicon:', faviconAbs);

process.exit(0);

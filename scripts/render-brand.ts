/**
 * Genera logo (400×400) + banner (1500×500) para la cuenta de X.
 * Run: pnpm tsx scripts/render-brand.ts
 *
 * Outputs:
 *   storage/cards/brand-logo.png
 *   storage/cards/brand-banner.png
 */
import { renderToPng } from '../src/render/compose.js';
import { logoCard, bannerCard, brandSizes } from '../src/render/cards/brand.js';
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

process.exit(0);

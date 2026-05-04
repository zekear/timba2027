import { fetchEventsByTag } from '../src/sources/polymarket/client.js';
import { writeFileSync, mkdirSync } from 'fs';

mkdirSync('tests/fixtures', { recursive: true });
const events = await fetchEventsByTag('argentina');
console.log('Total events fetched:', events.length);
events.forEach(e => console.log(' -', e.slug, '| markets:', e.markets.length));
const sample = events.find(e => e.slug === 'argentina-presidential-election-winner') ?? events.find(e => e.markets.length > 1) ?? events[0];
writeFileSync('tests/fixtures/polymarket-event.json', JSON.stringify(sample, null, 2));
console.log('Wrote fixture:', sample?.slug, 'with', sample?.markets.length, 'markets');

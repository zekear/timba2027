import { runPolymarketIngest } from '../src/sources/polymarket/ingest.js';
const result = await runPolymarketIngest();
console.log('Result:', result);
process.exit(0);

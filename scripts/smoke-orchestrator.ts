import { emitEvent } from '../src/trigger/events.js';
import { runTriggerOrchestrator } from '../src/trigger/orchestrator.js';

const id = await emitEvent('MARKET_MOVE', {
  marketId: '0x1', candidate: 'Milei', priceNow: 0.52, priceThen: 0.48, deltaPct: 4.2, windowHours: 6,
});
console.log('Emitted event id', id);

const stats = await runTriggerOrchestrator();
console.log('Stats:', stats);
process.exit(0);

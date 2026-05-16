/**
 * Corre runWeeklyRecap manualmente. Crea un draft de weekly_recap.
 *
 * Run: pnpm tsx scripts/run-weekly-recap.ts
 */
import { runWeeklyRecap } from '../src/trigger/weekly-recap.js';

const result = await runWeeklyRecap();
console.log(JSON.stringify(result, null, 2));
process.exit(0);

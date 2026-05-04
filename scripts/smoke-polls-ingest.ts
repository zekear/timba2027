import { runPollsIngest } from '../src/sources/polls/ingest.js';
import { pool } from '../src/db/client.js';

const stats = await runPollsIngest();
console.log(JSON.stringify(stats, null, 2));
await pool.end();
process.exit(0);

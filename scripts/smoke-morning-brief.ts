import { runMorningBrief } from '../src/trigger/morning-brief.js';

const r = await runMorningBrief();
console.log(r);
process.exit(0);

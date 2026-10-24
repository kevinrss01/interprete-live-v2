import {spawnSync} from 'node:child_process';
const stages={stt:['stt.mjs'],tts:['tts.mjs'],translation:['llm.mjs','translation'],decision:['llm.mjs','decision'],prediction:['llm.mjs','prediction'],native:['native.mjs'],pipeline:['pipeline.mjs'],quality:['judge.mjs']};
const stage=process.argv[2];
if(!stages[stage]){console.log('Usage: pnpm benchmark -- <stt|tts|translation|decision|prediction|native|pipeline|quality>\nRuns real, billable provider requests using the private .env.local. REPS, CASES and PROVIDERS can narrow a run. See BENCHMARK.md.');process.exit(stage?1:0);}
const result=spawnSync(process.execPath,['scripts/'+stages[stage][0],...stages[stage].slice(1)],{stdio:'inherit',env:process.env});
process.exit(result.status??1);

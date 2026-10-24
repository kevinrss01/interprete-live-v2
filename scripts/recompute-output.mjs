import fs from 'node:fs';import path from 'node:path';
import {OUT} from './config.mjs';import {signalBounds,scheduledTimeAt} from './audio-metrics.mjs';
for(const kind of ['native','pipeline-stream']){
 const input=path.join(OUT,kind+'.jsonl');if(!fs.existsSync(input))continue;
 const rows=fs.readFileSync(input,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
 let updated=0;
 for(const row of rows){
  if(!row.audioTimeline?.length)continue;
  const names=kind==='native'?[`native-${row.caseId}-${row.rep}.pcm`]:[`stream-${row.policy||'stable'}-${row.stt}-${row.tts}-${row.caseId}-${row.rep}.pcm`,`stream-${row.stt}-${row.tts}-${row.caseId}-${row.rep}.pcm`];
  const bytes=row.audioTimeline.reduce((n,x)=>n+x.bytes,0);
  const candidates=names.map(n=>path.join(OUT,n)).filter(p=>fs.existsSync(p)&&fs.statSync(p).size===bytes);
  if(!candidates.length)continue;
  const file=candidates.sort((a,b)=>Math.abs(fs.statSync(a).mtimeMs-Date.parse(row.timestamp))-Math.abs(fs.statSync(b).mtimeMs-Date.parse(row.timestamp)))[0];
  row.signal=signalBounds(fs.readFileSync(file));row.speechPlaybackStartMs=scheduledTimeAt(row.signal.speechOnsetMs,row.audioTimeline);row.speechPlaybackEndMs=scheduledTimeAt(row.signal.speechOffsetMs,row.audioTimeline);row.recomputedFrom=path.basename(file);updated++;
 }
 fs.writeFileSync(path.join(OUT,kind+'-reviewed.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');console.log(kind,updated,'PCM timelines checked');
}

import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {OUT,record,safeError} from './config.mjs';import {wer} from './stt.mjs';
const read=n=>fs.readFileSync(path.join(OUT,n+'.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const candidates=[...read('native-reviewed'),...read('pipeline-stream-reviewed')].filter(r=>r.status==='ok'&&r.recomputedFrom&&r.caseId==='fr-2');
const existing=fs.existsSync(path.join(OUT,'audio-verification.jsonl'))?read('audio-verification'):[];
const selected=[...new Map(candidates.map(r=>[r.provider,r])).values()].filter(r=>!existing.some(x=>x.file===r.recomputedFrom&&x.transcribed));
for(let i=0;i<selected.length;i+=2)await Promise.all(selected.slice(i,i+2).map(async r=>{
 try{
  const file=path.join(OUT,r.recomputedFrom);const wav=execFileSync('ffmpeg',['-v','error','-f','s16le','-ar','24000','-ac','1','-i',file,'-f','wav','-'],{maxBuffer:16*1024*1024});
  const form=new FormData();form.set('file',new Blob([wav],{type:'audio/wav'}),'generated.wav');form.set('model','gpt-4o-transcribe');form.set('language',r.target??'en');
  const res=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:form,signal:AbortSignal.timeout(45000)});const j=await res.json();if(!res.ok)throw new Error(safeError(JSON.stringify(j)));
  record('audio-verification',{provider:r.provider,caseId:r.caseId,file:r.recomputedFrom,intended:r.text,transcribed:j.text,...wer(r.text,j.text)});console.log(r.provider,Math.round(wer(r.text,j.text).wer*100)+'% audio/text WER');
 }catch(e){console.log('audio verification',safeError(e));record('audio-verification',{provider:r.provider,caseId:r.caseId,status:'failed',error:safeError(e)});}
}));

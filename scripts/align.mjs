import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {FIXTURES,OUT,safeError} from './config.mjs';
const items=JSON.parse(fs.readFileSync(path.join(FIXTURES,'manifest.json')));
for(const item of items){
 const folder=path.join(FIXTURES,item.id),dest=path.join(folder,'alignment.json');if(fs.existsSync(dest))continue;
 execFileSync('ffmpeg',['-v','error','-f','s16le','-ar','16000','-ac','1','-i',path.join(folder,'pcm16000.raw'),'-y',path.join(folder,'benchmark.wav')]);
 const form=new FormData();form.set('file',new Blob([fs.readFileSync(path.join(folder,'benchmark.wav'))],{type:'audio/wav'}),'benchmark.wav');form.set('text',item.text);
 const r=await fetch('https://api.elevenlabs.io/v1/forced-alignment',{method:'POST',headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY},body:form,signal:AbortSignal.timeout(60000)});
 const json=await r.json();if(!r.ok){console.log(item.id,r.status,safeError(JSON.stringify(json)));continue;}
 fs.writeFileSync(dest,JSON.stringify(json));console.log(item.id,'aligned',json.words?.length);
}

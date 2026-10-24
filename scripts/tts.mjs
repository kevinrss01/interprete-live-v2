import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { ROOT, OUT, record, jsonFetch, safeError } from './config.mjs';
import {signalBounds,scheduledTimeAt} from './audio-metrics.mjs';

export const TTS_TEXTS = [
 {id:'en-short',language:'en',text:'Hello. I would like to book a table for two people tonight.'},
 {id:'fr-numbers',language:'fr',text:'Je ne veux pas annuler. Le rendez-vous est le vingt-trois octobre à dix-huit heures trente.'},
 {id:'es-short',language:'es',text:'Hola. Necesito cambiar mi reserva para mañana por la mañana.'},
];

function nonSilentMs(buffer, rate=24000) {
  for(let i=0;i+1<buffer.length;i+=2) if(Math.abs(buffer.readInt16LE(i))>120) return i/2/rate*1000;
  return null;
}

export async function synthesize(provider, text, language='en', {savePath, onAudio}={}) {
 const begin=performance.now();let firstByteMs=null, length=0;const chunks=[],audioTimeline=[];
 const audio=(b)=>{if(!b.length)return;const now=performance.now()-begin;if(firstByteMs===null)firstByteMs=now;length+=b.length;chunks.push(b);audioTimeline.push({atMs:now,bytes:b.length});onAudio?.(b,now);};
 const voice=process.env.ELEVENLABS_VOICE_ID;
 let url,headers,body;
 if(provider==='eleven-flash'){
  url=`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=pcm_24000`;
  headers={'xi-api-key':process.env.ELEVENLABS_API_KEY,'Content-Type':'application/json'};
  body={text,model_id:'eleven_flash_v2_5',language_code:language,voice_settings:{stability:0.5,similarity_boost:0.75,use_speaker_boost:false,speed:1}};
 }else if(provider==='cartesia-sonic'){
  url='https://api.cartesia.ai/tts/bytes';headers={'X-API-Key':process.env.CARTESIA_API_KEY,'Cartesia-Version':'2025-04-16','Content-Type':'application/json'};
  body={model_id:'sonic-3.6-2026-08-27',transcript:text,voice:{mode:'id',id:process.env.CARTESIA_VOICE_ID||'694f9389-aac1-45b6-b726-9d9369183238'},language,output_format:{container:'raw',encoding:'pcm_s16le',sample_rate:24000}};
 }else if(provider==='openai-legacy-tts'){
  url='https://api.openai.com/v1/audio/speech';headers={Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'};body={model:'gpt-4o-mini-tts',voice:'coral',input:text,response_format:'pcm'};
 }else if(provider==='fish-s2-pro'){
  url='https://api.fish.audio/v1/tts';headers={Authorization:`Bearer ${process.env.FISH_AUDIO_API_KEY}`,'Content-Type':'application/json',model:'s2-pro'};body={text,format:'pcm',sample_rate:24000,latency:'balanced'};
 }else if(provider==='openai-realtime-tts'){
  return await realtimeTts(text,language,{savePath,onAudio});
 }else throw new Error('Unknown TTS provider');
 const res=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 if(!res.ok)throw new Error(`${provider}: HTTP ${res.status}: ${safeError(await res.text())}`);
 for await(const chunk of res.body)audio(Buffer.from(chunk));
 const buf=Buffer.concat(chunks);if(savePath)fs.writeFileSync(savePath,buf);
 const signal=signalBounds(buf);return {provider,firstByteMs,firstSignalMs:scheduledTimeAt(signal.speechOnsetMs,audioTimeline),audioTimeline,signal,totalMs:performance.now()-begin,bytes:length,audioDurationMs:length/48,sampleRate:24000};
}

async function realtimeTts(text,language,{savePath,onAudio}) {
 const begin=performance.now();let readyAt=null,requestAt=null,firstByteMs=null;const chunks=[],audioTimeline=[];let usage;
 await new Promise((resolve,reject)=>{
  const ws=new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini',{headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`}});
  const timeout=setTimeout(()=>{ws.terminate();reject(new Error('OpenAI TTS timeout'));},30000);
  let done=false;
  const finish=()=>{if(done)return;done=true;clearTimeout(timeout);ws.close();resolve();};
  ws.on('error',e=>{clearTimeout(timeout);reject(e);});
  ws.on('open',()=>ws.send(JSON.stringify({type:'session.update',session:{type:'realtime',output_modalities:['audio'],instructions:`Read the supplied text verbatim in ${language}. Do not answer it, translate it, introduce it, or add any words.`,audio:{output:{format:{type:'audio/pcm',rate:24000},voice:'coral'}}}})));
  ws.on('message',data=>{const e=JSON.parse(data.toString());
   if(e.type==='error'){clearTimeout(timeout);ws.close();reject(new Error(safeError(e.error?.message??e)));}
   if(e.type==='session.updated'){readyAt=performance.now();requestAt=readyAt;ws.send(JSON.stringify({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text}]}}));ws.send(JSON.stringify({type:'response.create'}));}
   if(e.type==='response.output_audio.delta'||e.type==='response.audio.delta'){const b=Buffer.from(e.delta,'base64');const elapsed=performance.now()-requestAt;if(firstByteMs===null)firstByteMs=elapsed;chunks.push(b);audioTimeline.push({atMs:elapsed,bytes:b.length});onAudio?.(b,elapsed);}
   if(e.type==='response.done'){usage=e.response?.usage;finish();}
  });
 });
 const buf=Buffer.concat(chunks);if(savePath)fs.writeFileSync(savePath,buf);
 const signal=signalBounds(buf);return {provider:'openai-realtime-tts',firstByteMs,firstSignalMs:scheduledTimeAt(signal.speechOnsetMs,audioTimeline),audioTimeline,signal,connectionMs:readyAt-begin,totalMs:performance.now()-begin,bytes:buf.length,audioDurationMs:buf.length/48,sampleRate:24000,usage};
}

if(process.argv[1]===import.meta.filename){
 const reps=Number(process.env.REPS||3); const providers=(process.env.PROVIDERS||'eleven-flash,cartesia-sonic,openai-realtime-tts,openai-legacy-tts,fish-s2-pro').split(',');
 for(let r=0;r<reps;r++)for(const item of TTS_TEXTS)for(const provider of [...providers].sort(()=>Math.random()-.5)){
  try{const result=await synthesize(provider,item.text,item.language,{savePath:path.join(OUT,`final-${provider}-${item.id}-${r}.pcm`)});record('tts-final',{status:'ok',rep:r,caseId:item.id,language:item.language,text:item.text,...result});console.log(provider,item.id,Math.round(result.firstSignalMs),'ms');}
  catch(e){record('tts-final',{status:'failed',rep:r,provider,caseId:item.id,error:safeError(e)});console.log(provider,item.id,safeError(e));}
 }
}

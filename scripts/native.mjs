import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { FIXTURES, OUT, delay, record, safeError } from './config.mjs';
import {signalBounds,scheduledTimeAt} from './audio-metrics.mjs';

export async function nativeTranslate(item,{savePath,onAudio}={}){
 const begin=performance.now();let start,readyAt,firstAudioMs=null,firstTextMs=null,simulatedPlaybackStartMs=null,scheduledEndMs=0,text='',source='',chunks=[],usage,finished=false;const audioTimeline=[];
 let resolveReady,rejectReady,resolveDone,rejectDone;
 const ready=new Promise((r,j)=>{resolveReady=r;rejectReady=j;});ready.catch(()=>{});
 const done=new Promise((r,j)=>{resolveDone=r;rejectDone=j;});done.catch(()=>{});
 const ws=new WebSocket('wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate',{headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},handshakeTimeout:12000});
 const timeout=setTimeout(()=>{ws.terminate();rejectReady(new Error('Native translation timeout'));rejectDone(new Error('Native translation timeout'));},45000);
 ws.on('error',e=>{rejectReady(e);rejectDone(e);});
 ws.on('open',()=>ws.send(JSON.stringify({type:'session.update',session:{audio:{output:{language:item.target}}}})));
 ws.on('message',raw=>{
  const e=JSON.parse(raw.toString());
  if(e.type==='error'){const error=new Error(safeError(e.error?.message??e));rejectReady(error);rejectDone(error);return;}
  if(e.type==='session.updated'){readyAt=performance.now();resolveReady();}
  if(e.type==='session.output_transcript.delta'){if(firstTextMs===null)firstTextMs=performance.now()-start;text+=e.delta;}
  if(e.type==='session.input_transcript.delta')source+=e.delta;
  if(e.type==='session.output_audio.delta'){
   const b=Buffer.from(e.delta,'base64'),now=performance.now()-start;
   if(firstAudioMs===null)firstAudioMs=now;
   let offset=null;for(let i=0;i+1<b.length;i+=2)if(Math.abs(b.readInt16LE(i))>120){offset=i/48;break;}
   if(simulatedPlaybackStartMs===null&&offset!==null)simulatedPlaybackStartMs=Math.max(now,scheduledEndMs)+offset;
   scheduledEndMs=Math.max(now,scheduledEndMs)+b.length/48;chunks.push(b);audioTimeline.push({atMs:now,bytes:b.length});onAudio?.(b,now);
  }
  if(e.type==='session.closed'){usage=e.usage;finished=true;resolveDone();}
 });
 ws.on('close',()=>{if(!finished){rejectReady(new Error('Native closed early'));rejectDone(new Error('Native closed without session.closed'));}});
 try{
  await ready;const pcm=fs.readFileSync(path.join(FIXTURES,item.id,'pcm24000.raw'));start=performance.now();
  const trailing=24000*2;const size=4800; // 100ms chunks + one second preserved silence
  for(let pos=0;pos<pcm.length+trailing;pos+=size){await delay(Math.max(0,start+pos/48-performance.now()));if(ws.readyState!==WebSocket.OPEN)break;ws.send(JSON.stringify({type:'session.input_audio_buffer.append',audio:(pos<pcm.length?pcm.subarray(pos,Math.min(pos+size,pcm.length)):Buffer.alloc(size)).toString('base64')}));}
  ws.send(JSON.stringify({type:'session.close'}));await done;
  if(!text.trim()||!chunks.length)throw new Error('No native translated speech');
  const pcmOut=Buffer.concat(chunks);if(savePath)fs.writeFileSync(savePath,pcmOut);
  const signal=signalBounds(pcmOut);const speechPlaybackStartMs=scheduledTimeAt(signal.speechOnsetMs,audioTimeline),speechPlaybackEndMs=scheduledTimeAt(signal.speechOffsetMs,audioTimeline);
  return {provider:'openai-native',status:'ok',caseId:item.id,sourceLanguage:item.language,target:item.target,text,source,firstTextMs,firstAudioMs,speechPlaybackStartMs,speechPlaybackEndMs,signal,audioTimeline,simulatedPlaybackStartMs,simulatedPlaybackEndMs:scheduledEndMs,simulatedFinalLagMs:speechPlaybackEndMs-item.speechEndMs,connectionMs:readyAt-begin,audioDurationMs:pcmOut.length/48,usage};
 }finally{clearTimeout(timeout);ws.terminate();}
}
if(process.argv[1]===import.meta.filename){
 let items=JSON.parse(fs.readFileSync(path.join(FIXTURES,'manifest.json')));if(process.env.CASES)items=items.filter(x=>process.env.CASES.split(',').includes(x.id));
 const parallel=Number(process.env.PARALLEL||2);
 for(let rep=Number(process.env.REP_START||0);rep<Number(process.env.REP_START||0)+Number(process.env.REPS||2);rep++)for(let i=0;i<items.length;i+=parallel)await Promise.all(items.slice(i,i+parallel).map(async item=>{
  try{const r=await nativeTranslate(item,{savePath:path.join(OUT,`native-${item.id}-${rep}.pcm`)});record('native',{rep,...r});console.log('native',item.id,Math.round(r.firstAudioMs),'ms',r.text.slice(0,120));}
  catch(e){record('native',{rep,provider:'openai-native',caseId:item.id,status:'failed',error:safeError(e)});console.log('native',item.id,safeError(e));}
 }));
}

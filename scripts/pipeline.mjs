import fs from 'node:fs';
import path from 'node:path';
import {transcribe} from './stt.mjs';
import {translate} from './llm.mjs';
import {synthesize} from './tts.mjs';
import {createSpeechStream} from './speech-stream.mjs';
import {signalBounds,scheduledTimeAt} from './audio-metrics.mjs';
import {FIXTURES,OUT,record,safeError} from './config.mjs';

export async function pipeline(item,{stt='gladia',llm='google/gemini-3.5-flash-lite',tts='eleven-flash',policy='stable',savePath}={}){
 const chunks=[],audioTimeline=[];const segments=new Map();const tasks=[];let overallStart=null,firstTextMs=null,firstAudioMs=null,firstPlayableMs=null,scheduleEnd=0,translated='',queue=Promise.resolve(),errors=[],sourceRevisions=0;
 const speech=await createSpeechStream(tts,item.target,b=>{
   if(overallStart===null)return;
   const now=performance.now()-overallStart;if(firstAudioMs===null)firstAudioMs=now;
   let n=null;for(let i=0;i+1<b.length;i+=2)if(Math.abs(b.readInt16LE(i))>120){n=i/48;break;}
   if(firstPlayableMs===null&&n!==null)firstPlayableMs=Math.max(now,scheduleEnd)+n;
   scheduleEnd=Math.max(now,scheduleEnd)+b.length/48;chunks.push(b);audioTimeline.push({atMs:now,bytes:b.length});
 });
 const observed=[];
 function submit(text,atMs){
  if(!text.trim())return;const enqueuedAt=performance.now();
  queue=queue.then(async()=>{
   if(translated)speech.sendText(' ');
   const r=await translate(llm,text,item.language,item.target,{onToken:(delta)=>{
    if(firstTextMs===null)firstTextMs=performance.now()-overallStart;
    speech.sendText(delta);
   }});
   translated+=[translated?' ':'',r.text].join('');speech.flush();
   observed.push({source:text,translation:r.text,commitAtMs:atMs,queueDelayMs:enqueuedAt-overallStart-atMs,translationMs:r.totalMs});
  }).catch(e=>{errors.push(safeError(e));});tasks.push(queue);
 }
 let result;try{result=await transcribe(stt,item,{onEvent:e=>{if(overallStart===null&&e.atMs!==null)overallStart=performance.now()-e.atMs;},onTranscript:(text,isFinal,e)=>{
  if(overallStart===null)overallStart=performance.now()-e.atMs;
  const id=String(e.id),words=text.trim().split(/\s+/);const state=segments.get(id)??{previous:[],committed:[]};
  let stable=0;while(stable<Math.min(state.previous.length,words.length)&&state.previous[stable]===words[stable])stable++;
  if(state.committed.some((w,i)=>words[i]!==w))sourceRevisions++;
  const end=isFinal?words.length:policy==='final'?0:stable;
  if(end>state.committed.length&&(isFinal||end-state.committed.length>=4)){
   submit(words.slice(state.committed.length,end).join(' '),e.atMs);state.committed=words.slice(0,end);
  }
  state.previous=words;segments.set(id,state);
 }});
 await Promise.all(tasks);await queue;await speech.close();}catch(e){speech.abort();throw e;}
 const pcm=Buffer.concat(chunks);if(savePath)fs.writeFileSync(savePath,pcm);const signal=signalBounds(pcm);const speechPlaybackStartMs=scheduledTimeAt(signal.speechOnsetMs,audioTimeline),speechPlaybackEndMs=scheduledTimeAt(signal.speechOffsetMs,audioTimeline);
 return {provider:`${stt} → ${llm} → ${tts}${policy==='final'?' (finals)':''}`,stt,llm,tts,policy,ttsTransport:'persistent-websocket',caseId:item.id,status:errors.length?'partial':chunks.length?'ok':'empty',sourceLanguage:item.language,target:item.target,text:translated,source:result.transcript,firstTextMs,firstAudioMs,speechPlaybackStartMs,speechPlaybackEndMs,signal,audioTimeline,simulatedPlaybackStartMs:firstPlayableMs,simulatedPlaybackEndMs:scheduleEnd,simulatedFinalLagMs:speechPlaybackEndMs-item.speechEndMs,sourceRevisions,segments:observed,errors,sttWer:result.wer};
}
if(process.argv[1]===import.meta.filename){
 let items=JSON.parse(fs.readFileSync(path.join(FIXTURES,'manifest.json')));if(process.env.CASES)items=items.filter(x=>process.env.CASES.split(',').includes(x.id));
 const setups=[
  {stt:'gladia',tts:'eleven-flash'},
  {stt:'gladia',tts:'cartesia-sonic'},
  {stt:'openai-live-minimal',tts:'eleven-flash'},
  {stt:'cartesia-ink',tts:'eleven-flash'},
  {stt:'deepgram-flux',tts:'cartesia-sonic'},
  {stt:'speechmatics',tts:'cartesia-sonic'},
  {stt:'cartesia-ink',tts:'cartesia-sonic'},
 ];
 const selected=process.env.SETUPS?setups.filter(x=>process.env.SETUPS.split(',').includes(x.stt+':'+x.tts)):setups;
 for(let rep=0;rep<Number(process.env.REPS||2);rep++)for(const item of items)for(let i=0;i<selected.length;i+=2)await Promise.all(selected.slice(i,i+2).map(async setup=>{
  try{const r=await pipeline(item,{...setup,policy:process.env.POLICY||'stable',savePath:path.join(OUT,`stream-${process.env.POLICY||'stable'}-${setup.stt}-${setup.tts}-${item.id}-${rep}.pcm`)});record('pipeline-stream',{rep,...r});console.log('stream',r.provider,item.id,r.status,Math.round(r.firstAudioMs),'ms');}
  catch(e){record('pipeline-stream',{rep,...setup,caseId:item.id,status:'failed',error:safeError(e)});console.log('stream',item.id,safeError(e));}
 }));
}

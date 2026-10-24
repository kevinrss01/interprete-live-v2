import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { FIXTURES, OUT, jsonFetch, record, safeError, delay } from './config.mjs';

export function words(s){return s.toLocaleLowerCase().normalize('NFKC').replace(/[’']/g,' ').replace(/[^\p{L}\p{N}\s]/gu,' ').trim().split(/\s+/).filter(Boolean);}
export function wer(reference,hypothesis){const a=words(reference),b=words(hypothesis);let last=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const row=[i];for(let j=1;j<=b.length;j++)row[j]=Math.min(row[j-1]+1,last[j]+1,last[j-1]+(a[i-1]===b[j-1]?0:1));last=row;}return {errors:last[b.length],referenceWords:a.length,wer:a.length?last[b.length]/a.length:null};}

export async function transcribe(provider, item, {onTranscript, onEvent, chunkMs, trailingMs=1200, timeoutMs=10000}={}){
 const started=performance.now();let audioStarted=null;let ready=false,closed=false;let lastText='',finalText='',fullText='';const finals=new Map();const events=[];let firstMs=null,finalMs=null,speechEnded=null;let ws,timer;let resolveDone,rejectDone;
 const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});done.catch(()=>{});
 let resolveReady,rejectReady;const readyPromise=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});readyPromise.catch(()=>{});
 const fail=e=>{clearTimeout(timer);closed=true;try{ws?.terminate();}catch{}rejectReady(e);rejectDone(e);};
 const finish=()=>{if(closed)return;closed=true;clearTimeout(timer);ws?.close();resolveDone();};
 const signalReady=()=>{if(ready)return;ready=true;resolveReady();};
 const event=(type,data={})=>{const e={type,atMs:audioStarted===null?null:performance.now()-audioStarted,...data};events.push(e);onEvent?.(e);return e;};
 const transcript=(text,isFinal,id='current',audioEndMs)=>{
  if(!text?.trim())return;
  if(isFinal)finals.set(id,text);
  finalText=[...finals.values()].join(' ');
  fullText=isFinal?finalText:[finalText,text].filter(Boolean).join(' ');
  const e=event(isFinal?'final':'partial',{text,id,audioEndMs});if(firstMs===null)firstMs=e.atMs;
  if(isFinal)finalMs=e.atMs;
  if(text!==lastText||isFinal){onTranscript?.(text,isFinal,e);lastText=text;}
 };
 let headers={},url,init,send,stop;
 if(provider==='gladia'){
  const session=await jsonFetch('https://api.gladia.io/v2/live?region=eu-west',{method:'POST',headers:{'x-gladia-key':process.env.GLADIA_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({encoding:'wav/pcm',sample_rate:16000,bit_depth:16,channels:1,model:'solaria-1',endpointing:0.2,maximum_duration_without_endpointing:5,language_config:{languages:[item.language],code_switching:false},messages_config:{receive_partial_transcripts:true,receive_final_transcripts:true,receive_speech_events:true,receive_lifecycle_events:true,receive_acknowledgments:false,receive_errors:true}})});
  url=session.url;send=b=>ws.send(b);stop=()=>ws.send(JSON.stringify({type:'stop_recording'}));
 }else if(provider==='eleven-scribe'){
  const q=new URLSearchParams({model_id:'scribe_v2_realtime',audio_format:'pcm_16000',language_code:item.language,commit_strategy:'vad',vad_silence_threshold_secs:'0.3',min_speech_duration_ms:'100',min_silence_duration_ms:'100'});
  url='wss://api.elevenlabs.io/v1/speech-to-text/realtime?'+q;headers={'xi-api-key':process.env.ELEVENLABS_API_KEY};
  send=b=>ws.send(JSON.stringify({message_type:'input_audio_chunk',audio_base_64:b.toString('base64'),sample_rate:16000,commit:false}));stop=()=>{ws.send(JSON.stringify({message_type:'input_audio_chunk',audio_base_64:Buffer.alloc(3200).toString('base64'),sample_rate:16000,commit:true}));setTimeout(finish,2200);};
 }else if(provider==='speechmatics'){
  const token=await jsonFetch('https://mp.speechmatics.com/v1/api_keys?type=rt',{method:'POST',headers:{Authorization:`Bearer ${process.env.SPEECHMATICS_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({ttl:60})});
  url='wss://eu2.rt.speechmatics.com/v2';headers={Authorization:`Bearer ${token.key_value}`};init={message:'StartRecognition',audio_format:{type:'raw',encoding:'pcm_s16le',sample_rate:16000},transcription_config:{language:item.language,enable_partials:true,max_delay:0.7,max_delay_mode:'fixed',operating_point:'enhanced'}};
  send=b=>ws.send(b);let seq=0;const raw=send;send=b=>{seq++;raw(b);};stop=()=>ws.send(JSON.stringify({message:'EndOfStream',last_seq_no:seq}));
 }else if(provider.startsWith('openai-live')){
  url='wss://api.openai.com/v1/realtime?intent=transcription';headers={Authorization:`Bearer ${process.env.OPENAI_API_KEY}`};
  init={type:'session.update',session:{type:'transcription',audio:{input:{format:{type:'audio/pcm',rate:24000},transcription:{model:'gpt-live-transcribe',languages:[item.language],delay:provider.endsWith('low')?'low':'minimal'},turn_detection:null}}}};
  send=b=>ws.send(JSON.stringify({type:'input_audio_buffer.append',audio:b.toString('base64')}));stop=()=>ws.send(JSON.stringify({type:'input_audio_buffer.commit'}));
 }else if(provider==='deepgram-flux'){
  const q=new URLSearchParams({model:'flux-general-multi',encoding:'linear16',sample_rate:'16000',language_hint:item.language,eot_threshold:'0.5',eot_timeout_ms:'1000'});
  url='wss://api.deepgram.com/v2/listen?'+q;headers={Authorization:`Token ${process.env.DEEPGRAM_API_KEY}`};send=b=>ws.send(b);stop=()=>ws.send(JSON.stringify({type:'CloseStream'}));
 }else if(provider==='cartesia-ink'){
  const q=new URLSearchParams({model:'ink-2',encoding:'pcm_s16le',sample_rate:'16000',cartesia_version:'2026-08-14',turn_end_timeout_ms:'1000'});
  url='wss://api.cartesia.ai/stt/turns/websocket?'+q;headers={'X-API-Key':process.env.CARTESIA_API_KEY};send=b=>ws.send(b);stop=()=>ws.send(JSON.stringify({type:'close'}));
 }else throw new Error('Unknown STT '+provider);
 ws=new WebSocket(url,{headers,handshakeTimeout:12000});
 timer=setTimeout(()=>fail(new Error(provider+' timeout waiting ready')),16000);
 ws.on('open',()=>{if(init)ws.send(JSON.stringify(init));if(provider==='deepgram-flux'||provider==='cartesia-ink')signalReady();});
 ws.on('error',fail);
 ws.on('close',code=>{if(!ready)return fail(new Error(provider+' closed before ready: '+code));if(!closed){closed=true;clearTimeout(timer);resolveDone();}});
 ws.on('message',raw=>{
  let e;try{e=JSON.parse(raw.toString());}catch{return;}
  if(e.error||e.type==='error'||e.message==='Error'||/error$/.test(e.message_type??'')){fail(new Error(`${provider}: ${safeError(e.error?.message??e.reason??e.message??e.error??e)}`));return;}
  if(provider==='gladia'){
   if(e.type==='start_session'||e.type==='start_recording')signalReady();
   if(e.type==='transcript')transcript(e.data.utterance?.text,e.data.is_final,e.data.id,e.data.utterance?.end*1000);
  }else if(provider==='eleven-scribe'){
   if(e.message_type==='session_started')signalReady();
   if(e.message_type==='partial_transcript')transcript(e.text,false,events.filter(e=>e.type==='final').length);
   if(e.message_type?.startsWith('committed_transcript'))transcript(e.text,true,events.filter(e=>e.type==='final').length);
  }else if(provider==='speechmatics'){
   if(e.message==='RecognitionStarted')signalReady();
   if(e.message==='AddPartialTranscript')transcript(e.metadata?.transcript??'',false, e.metadata?.start_time,e.metadata?.end_time*1000);
   if(e.message==='AddTranscript')transcript(e.metadata?.transcript??'',true,e.metadata?.start_time,e.metadata?.end_time*1000);
   if(e.message==='EndOfTranscript')finish();
  }else if(provider.startsWith('openai-live')){
   if(e.type==='session.updated')signalReady();
   if(e.type==='conversation.item.input_audio_transcription.delta'){fullText+=e.delta;transcript(fullText,false,e.item_id);}
   if(e.type==='conversation.item.input_audio_transcription.completed'){transcript(e.transcript,true,e.item_id);finish();}
  }else if(provider==='deepgram-flux'){
   if(e.type==='TurnInfo'){
    const final=e.event==='EndOfTurn';transcript(e.transcript,final,e.turn_index,e.end_of_turn_confidence);if(final)event('turn-end');
   }
  }else if(provider==='cartesia-ink'){
   if(e.type==='turn.update'||e.type==='turn.eager_end'||e.type==='turn.end')transcript(e.transcript,e.type==='turn.end',e.turn_id??events.filter(x=>x.type==='final').length);
  }
 });
 try{
  await readyPromise;clearTimeout(timer);const connectionMs=performance.now()-started;
  const rate=provider.startsWith('openai-live')?24000:16000;
  const pcm=fs.readFileSync(path.join(FIXTURES,item.id,`pcm${rate}.raw`));
  const ms=chunkMs??(provider==='deepgram-flux'?80:100);const size=Math.round(rate*2*ms/1000);audioStarted=performance.now();
  const count=Math.ceil((pcm.length+rate*2*trailingMs/1000)/size);
  for(let i=0;i<count&&!closed;i++){
   const target=audioStarted+i*ms;await delay(Math.max(0,target-performance.now()));
   if(closed||ws.readyState!==WebSocket.OPEN)break;
   const start=i*size;const chunk=start<pcm.length?pcm.subarray(start,Math.min(start+size,pcm.length)):Buffer.alloc(size);
   send(chunk);
  }
  speechEnded=audioStarted+item.speechEndMs;
  if(!closed){stop();timer=setTimeout(finish,timeoutMs);}
  await done;
  const transcriptText=finalText||fullText||lastText;
  const successful=transcriptText.trim().length>0;
  return {provider,status:successful?'ok':'empty',caseId:item.id,language:item.language,connectionMs,firstTranscriptMs:firstMs,firstTranscriptFromSpeechMs:firstMs===null?null:firstMs-item.speechStartMs,finalMs,finalLagMs:finalMs===null?null:finalMs-item.speechEndMs,transcript:transcriptText,events,chunkMs:ms,...wer(item.text,transcriptText)};
 }catch(e){fail(e);throw e;}finally{clearTimeout(timer);ws?.terminate();}
}

if(process.argv[1]===import.meta.filename){
 let corpus=JSON.parse(fs.readFileSync(path.join(FIXTURES,'manifest.json'),'utf8'));
 if(process.env.CASES)corpus=corpus.filter(x=>process.env.CASES.split(',').includes(x.id));
 const providers=(process.env.PROVIDERS||'gladia,eleven-scribe,speechmatics,openai-live-minimal,openai-live-low,deepgram-flux,cartesia-ink').split(',');
 const reps=Number(process.env.REPS||1);
 for(let rep=0;rep<reps;rep++)for(const item of corpus){
  // Two independent provider sessions per batch; identical samples and real-time pacing.
  const order=[...providers].sort(()=>Math.random()-.5);
  for(let i=0;i<order.length;i+=4)await Promise.all(order.slice(i,i+4).map(async provider=>{
   try{const result=await transcribe(provider,item);record('stt',{rep,...result});console.log(provider,item.id,result.status,Math.round(result.firstTranscriptMs),'ms',Math.round(result.wer*100)+'% WER');}
   catch(e){record('stt',{rep,provider,caseId:item.id,language:item.language,status:'failed',error:safeError(e)});console.log(provider,item.id,safeError(e));}
  }));
 }
}

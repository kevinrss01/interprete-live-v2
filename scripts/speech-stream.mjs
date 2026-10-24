import WebSocket from 'ws';
import {randomUUID} from 'node:crypto';
import {safeError} from './config.mjs';

export async function createSpeechStream(provider,language,onAudio){
 const context=randomUUID();let resolveDone,rejectDone,error,settled=false,closing=false;const done=new Promise((r,j)=>{resolveDone=r;rejectDone=j;});done.catch(()=>{});
 let url,headers;
 if(provider==='eleven-flash'){
  const q=new URLSearchParams({model_id:'eleven_flash_v2_5',output_format:'pcm_24000',language_code:language});
  url=`wss://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}/stream-input?${q}`;headers={'xi-api-key':process.env.ELEVENLABS_API_KEY};
 }else if(provider==='cartesia-sonic'){
  url='wss://api.cartesia.ai/tts/websocket?cartesia_version=2026-08-14';headers={'X-API-Key':process.env.CARTESIA_API_KEY};
 }else throw new Error('Unsupported streaming TTS');
 const ws=new WebSocket(url,{headers,handshakeTimeout:12000});
 const base={model_id:'sonic-3.6-2026-08-27',voice:{id:process.env.CARTESIA_VOICE_ID||'694f9389-aac1-45b6-b726-9d9369183238'},language,output_format:{container:'raw',encoding:'pcm_s16le',sample_rate:24000},context_id:context,max_buffer_delay_ms:100};
 const finish=()=>{settled=true;resolveDone();};
 ws.on('message',raw=>{let e;try{e=JSON.parse(raw.toString());}catch{return;}
  if(e.error||e.type==='error'){error=new Error(safeError(e.error??e.message));rejectDone(error);ws.close();return;}
  if(provider==='eleven-flash'&&e.audio)onAudio(Buffer.from(e.audio,'base64'));
  if(provider==='cartesia-sonic'&&e.type==='chunk'&&e.data)onAudio(Buffer.from(e.data,'base64'));
  if(closing&&(e.isFinal||e.is_final||(provider==='cartesia-sonic'&&e.type==='done')))finish();
 });
 ws.on('error',e=>{error=e;rejectDone(e);});ws.on('close',()=>{if(!settled&&!error){error=new Error('TTS socket closed before final acknowledgement');rejectDone(error);}});
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
 if(provider==='eleven-flash')ws.send(JSON.stringify({text:' ',voice_settings:{stability:0.5,similarity_boost:0.75,use_speaker_boost:false,speed:1},generation_config:{chunk_length_schedule:[50,80,120,160]}}));
 const send=message=>{if(error)throw error;if(ws.readyState!==WebSocket.OPEN)throw new Error('TTS socket is closed');ws.send(JSON.stringify(message));};
 return {
  sendText(text){if(!text)return;if(provider==='eleven-flash')send({text,try_trigger_generation:true});else send({...base,transcript:text,continue:true});},
  flush(){if(provider==='eleven-flash')send({text:' ',flush:true});else send({...base,transcript:'',continue:true,flush:true});},
  async close(){closing=true;if(provider==='eleven-flash')send({text:''});else send({...base,transcript:'',continue:false});let timeout;try{await Promise.race([done,new Promise((_,j)=>{timeout=setTimeout(()=>j(new Error('TTS drain timeout')),20000);})]);}finally{clearTimeout(timeout);ws.terminate();}},
  abort(){ws.terminate();}
 };
}

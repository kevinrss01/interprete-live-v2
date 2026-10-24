export function signalBounds(pcm,rate=24000){
 const frame=Math.round(rate*.02),values=[];
 for(let i=0;i<pcm.length/2;i+=frame){let sum=0,n=0;for(let j=i;j<Math.min(i+frame,pcm.length/2);j++){const x=pcm.readInt16LE(j*2)/32768;sum+=x*x;n++;}values.push(Math.sqrt(sum/Math.max(1,n)));}
 const threshold=Math.max(.015,Math.max(0,...values)*.05);let first=null,last=null;
 for(let i=0;i<values.length-4;i++){if(values[i]>threshold&&values.slice(i,i+5).filter(v=>v>threshold).length>=4){first=i;break;}}
 for(let i=values.length-1;i>=0;i--)if(values[i]>threshold){last=i;break;}
 return {speechOnsetMs:first===null?null:first*20,speechOffsetMs:last===null?null:(last+1)*20,threshold,rmsFrameMs:20};
}
export function scheduledTimeAt(sampleMs,timeline,rate=24000){
 if(sampleMs===null)return null;let bytes=sampleMs*rate*2/1000,clock=0;
 for(const chunk of timeline){clock=Math.max(clock,chunk.atMs);if(bytes<=chunk.bytes)return clock+bytes/(rate*2/1000);bytes-=chunk.bytes;clock+=chunk.bytes/(rate*2/1000);}
 return clock;
}

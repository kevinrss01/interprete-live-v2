import test from 'node:test';
import assert from 'node:assert/strict';
import {signalBounds,scheduledTimeAt} from '../scripts/audio-metrics.mjs';
import {wer} from '../scripts/stt.mjs';
test('silent packets do not count as translated speech',()=>{
 const pcm=Buffer.alloc(24000*2*2);
 for(let i=24000;i<36000;i++)pcm.writeInt16LE(Math.round(Math.sin(i*.3)*10000),i*2);
 const b=signalBounds(pcm);assert.equal(b.speechOnsetMs,1000);assert.equal(b.speechOffsetMs,1500);
 assert.equal(scheduledTimeAt(b.speechOnsetMs,[{atMs:500,bytes:48000},{atMs:900,bytes:48000}]),1500);
});
test('network gaps postpone scheduled speech',()=>{
 assert.equal(scheduledTimeAt(1100,[{atMs:500,bytes:48000},{atMs:2000,bytes:48000}]),2100);
});
test('silence remains a missing measurement, not zero',()=>{
 assert.equal(signalBounds(Buffer.alloc(48000)).speechOnsetMs,null);
 assert.equal(scheduledTimeAt(null,[]),null);
});
test('word error rate is lexical and counts omitted negation',()=>{
 assert.equal(wer('Je ne veux pas annuler.','Je ne veux pas annuler').errors,0);
 assert.equal(wer('Je ne veux pas annuler.','Je veux annuler').errors,2);
});

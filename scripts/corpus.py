"""Download only an initial portion of the public FLEURS test archives.
Human recordings and reference text; stop after four distinct utterances/language.
"""
from pathlib import Path
import urllib.request, csv, tarfile, io, json, subprocess, math, struct, hashlib
root = Path(__file__).resolve().parent.parent / 'benchmark-corpus'
root.mkdir(exist_ok=True)
manifest=[]
for locale,language,target in [('fr_fr','fr','en'),('en_us','en','fr'),('es_419','es','en')]:
    base='https://huggingface.co/datasets/google/fleurs/resolve/main/data/'+locale
    raw=urllib.request.urlopen(base+'/test.tsv',timeout=30).read().decode()
    rows={r[1]:r for r in csv.reader(io.StringIO(raw),delimiter='\t') if len(r)>=7}
    seen=set(); accepted=0
    req=urllib.request.urlopen(base+'/audio/test.tar.gz',timeout=60)
    with tarfile.open(fileobj=req,mode='r|gz') as archive:
        for member in archive:
            filename=Path(member.name).name
            row=rows.get(filename)
            if not row or row[0] in seen: continue
            duration=int(row[5])/16000
            if not 4<=duration<=15:continue
            folder=root/f'{language}-{accepted+1}'
            folder.mkdir(exist_ok=True)
            wav=folder/'source.wav'
            wav.write_bytes(archive.extractfile(member).read())
            floats=subprocess.check_output(['ffmpeg','-v','error','-i',str(wav),'-ac','1','-ar','16000','-f','f32le','-'])
            peaks=struct.unpack('<'+'f'*(len(floats)//4),floats)
            peak=max(abs(v) for v in peaks)
            if peak<0.000001: continue
            gain=0.7/peak
            pcm=subprocess.check_output(['ffmpeg','-v','error','-i',str(wav),'-af',f'volume={gain}','-ac','1','-ar','16000','-f','s16le','-'])
            samples=struct.unpack('<'+'h'*(len(pcm)//2),pcm)
            frames=[math.sqrt(sum(v*v for v in samples[i:i+160])/max(1,len(samples[i:i+160])))/32768 for i in range(0,len(samples),160)]
            threshold=max(0.004,max(frames)*0.025)
            speech=[i for i,v in enumerate(frames) if v>threshold]
            if not speech: continue
            start=max(0,speech[0]*160-1600); end=min(len(samples),(speech[-1]+1)*160+1600)
            trimmed=pcm[start*2:end*2]
            (folder/'pcm16000.raw').write_bytes(trimmed)
            subprocess.run(['ffmpeg','-v','error','-f','s16le','-ar','16000','-ac','1','-i',str(folder/'pcm16000.raw'),'-ar','24000','-f','s16le','-y',str(folder/'pcm24000.raw')],check=True)
            item={'id':folder.name,'language':language,'target':target,'text':row[2],'normalizedText':row[3],'gender':row[6],'durationMs':len(trimmed)/32,'speechStartMs':(speech[0]*160-start)/16,'speechEndMs':((speech[-1]+1)*160-start)/16,'source':'google/fleurs','sourceId':row[0],'sourceFilename':filename,'sourceUrl':base+'/audio/test.tar.gz','sha256':hashlib.sha256(trimmed).hexdigest(),'synthetic':False,'normalizationGain':gain,'speechBoundaryMethod':'linear peak normalization 0.7; 10ms RMS threshold max(0.004, 2.5% peak); approximate speech bounds'}
            manifest.append(item);seen.add(row[0]);accepted+=1
            print(json.dumps({k:item[k] for k in ['id','durationMs','text','gender']},ensure_ascii=False),flush=True)
            if accepted==4:break
    req.close()
    (root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
(root/'README.md').write_text('Human-read speech from Google FLEURS, test splits fr_fr, en_us, es_419. Dataset license: CC-BY 4.0. https://huggingface.co/datasets/google/fleurs\nSelected first four distinct utterances of 4–15 seconds per archive, not cherry-picked by model performance. Original audio retained; benchmark PCM trimmed only at energy-estimated outer silence, resampled once for each required sample rate.\n')

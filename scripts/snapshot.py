from pathlib import Path
import json,statistics,datetime,collections,re,random,difflib
root=Path(__file__).resolve().parent.parent
results=root/'benchmark-results'
def read(name):
 p=results/(name+'.jsonl')
 return [json.loads(x) for x in p.read_text().splitlines()] if p.exists() else []
def percentile(v,q):
 v=sorted(x for x in v if x is not None)
 if not v:return None
 p=(len(v)-1)*q;i=int(p)
 return round(v[i]+(v[min(i+1,len(v)-1)]-v[i])*(p-i),1)
def stat(rows,key,q=.5):return percentile([r.get(key) for r in rows],q)
def tokenize(s):return re.findall(r'[^\W_]+',s.lower().replace('’'," ").replace("'",' '),re.UNICODE)
def levenshtein(a,b):
 prev=list(range(len(b)+1))
 for i,x in enumerate(a):
  cur=[i+1]
  for j,y in enumerate(b):cur.append(min(cur[-1]+1,prev[j+1]+1,prev[j]+(x!=y)))
  prev=cur
 return prev[-1]
def groups(rows,field):
 d=collections.defaultdict(list)
 for r in rows:d[r.get(field,'unknown')].append(r)
 return d.items()
queries={}
def query(name,rows,label,definition,files):
 queries[name]={'columns':list(rows[0]) if rows else [],'rows':rows,'source':{'label':label,'files':[str(results/f) for f in files],'evidenceFlow':[{'title':'Reproduction','detail':'Run scripts under instant-translate/scripts with the private .env.local; JSONL contains actual provider responses and monotonic durations, without credentials.'}],'metricDefinitions':[{'label':name,'definition':definition,'componentIds':['report-'+name]}]}}

corpus=json.loads((root/'benchmark-corpus/manifest.json').read_text());corpusBy={x['id']:x for x in corpus}
def emission_map(row):
 if row.get('status')!='ok':return {}
 item=corpusBy[row['caseId']];alignment=json.loads((root/'benchmark-corpus'/item['id']/'alignment.json').read_text())
 ref=[];ends=[];starts=[]
 for word in alignment['words']:
  for t in tokenize(word['text']):ref.append(t);ends.append(word['end']*1000);starts.append(word['start']*1000)
 finals={};seen={}
 for e in row.get('events',[]):
  if e.get('type') not in ['partial','final'] or e.get('atMs') is None:continue
  key=str(e['id']);text=e.get('text','')
  if e['type']=='final':finals[key]=text;hyp=' '.join(finals.values())
  else:hyp=' '.join([v for k,v in finals.items() if k!=key]+[text])
  matcher=difflib.SequenceMatcher(None,ref,tokenize(hyp),autojunk=False)
  for block in matcher.get_matching_blocks():
   for n in range(block.size):
    idx=block.a+n;arrival=e['atMs']+row.get('chunkMs',100)
    if arrival>=starts[idx]:seen.setdefault(idx,arrival)
 return {i:v-ends[i] for i,v in seen.items()}
stt=read('stt')
# Keep the complete main run; setup smoke tests were written before that run.
cut=next((i for i,r in enumerate(stt) if r.get('provider')=='cartesia-ink' and r.get('caseId')=='fr-1' and i>8),0)
# The final three-repetition run is identified by the latest 36 trials/provider,
# preserving failures and excluding earlier API setup checks.
selected=[]
for model,rows in groups(stt,'provider'):
 for case,caseRows in groups(rows,'caseId'):
  valid=[r for r in caseRows if r.get('status') in ['ok','empty','failed']]
  selected+=valid[-3:]
maps={id(r):emission_map(r) for r in selected}
common={}
for key,rr in groups(selected,'caseId'):
 for rep in sorted(set(x['rep'] for x in rr)):
  same=[x for x in rr if x['rep']==rep]
  if len(set(x['provider'] for x in same))==7:
   common[(key,rep)]=set.intersection(*(set(maps[id(x)]) for x in same))
sttRows=[]
for model,rows in groups(selected,'provider'):
 ok=[r for r in rows if r['status']=='ok'];returned=[r for r in rows if r['status'] in ['ok','empty']];ref=sum(r.get('referenceWords',0) for r in returned);err=sum(r.get('errors',0) for r in returned)
 lags=[delay for r in ok for idx,delay in maps[id(r)].items() if idx in common.get((r['caseId'],r['rep']),set())]
 first=[r['firstTranscriptMs']+r.get('chunkMs',100) for r in ok if r.get('firstTranscriptMs') is not None]
 sttRows.append({'model':model,'trials':len(rows),'success':len(ok),'firstTextP50':percentile(first,.5),'firstTextP95':percentile(first,.95),'wordLagP50':percentile(lags,.5),'wordLagP95':percentile(lags,.95),'matchedWords':len(lags),'werPct':round(err/ref*100,1) if ref else None})
query('stt',sorted(sttRows,key=lambda x:x['wordLagP50'] or 1e9),'Live STT runs on human FLEURS recordings','Word emission delay = earliest appearance of exact-matched reference word minus its end in ElevenLabs forced alignment; model-estimated word timestamps, not hand annotations. First partial text measured separately from first input frame. Weighted lexical WER against source, punctuation ignored; number spelling differences remain.', ['stt.jsonl'])
tts=read('tts-final') or read('tts');ttsRows=[]
for model,rows in groups(tts,'provider'):
 ok=[r for r in rows if r['status']=='ok']
 for r in ok:r['packetFromStartMs']=r['firstByteMs']+r.get('connectionMs',0);r['speechFromStartMs']=None if r.get('firstSignalMs') is None else r['firstSignalMs']+r.get('connectionMs',0)
 ttsRows.append({'model':model,'trials':len(rows),'success':len(ok),'firstP50':stat(ok,'packetFromStartMs'),'firstP95':stat(ok,'packetFromStartMs',.95),'speechP50':stat(ok,'speechFromStartMs'),'speechP95':stat(ok,'speechFromStartMs',.95),'failures':len(rows)-len(ok)})
query('tts',sorted(ttsRows,key=lambda x:x['speechP50'] or 1e9),'Streaming TTS on identical EN/FR/ES text','First PCM packet and RMS-based speech start in a simulated continuous playback queue. From request initiation; OpenAI realtime session negotiation included. No browser/device playback. Each voice/model is part of the tested configuration.', ['tts-final.jsonl'])
tr=read('translation');trRows=[]
for model,rows in groups(tr,'model'):
 ok=[r for r in rows if r['status']=='ok'];trRows.append({'model':model,'trials':len(rows),'success':len(ok),'firstP50':stat(ok,'firstTokenMs'),'firstP95':stat(ok,'firstTokenMs',.95),'totalP50':stat(ok,'totalMs'),'costUsd':round(sum((r.get('usage') or {}).get('cost',0) for r in ok),5)})
query('translation',sorted(trRows,key=lambda x:x['firstP50'] or 1e9),'AI Gateway translation API responses','First translated token and completed translation wall time. 12 human-reference texts; all model calls use the same instruction and target language. Model-specific minimal supported reasoning settings.', ['translation.jsonl'])
dec=read('decision');decRows=[]
for model,rows in groups(dec,'model'):
 ok=[r for r in rows if r['status']=='ok'];decRows.append({'model':model,'trials':len(rows),'success':len(ok),'correctPct':round(100*sum(r['correct'] for r in ok)/len(ok),1) if ok else None,'latencyP50':stat(ok,'totalMs'),'latencyP95':stat(ok,'totalMs',.95),'premature':sum(r['expected']=='wait' and r['decision']=='ready' for r in ok)})
query('decision',sorted(decRows,key=lambda x:x['latencyP50'] or 1e9),'Controlled readiness classification','12 synthetic complete/incomplete clauses × 3 runs; 6 ready and 6 wait. Labels are explicit test assumptions, not proof of real conversational readiness. Premature=ready prediction on a wait-labelled case.', ['decision.jsonl'])
pred=read('prediction-final') or read('prediction');predRows=[]
for variant in [False,True]:
 rows=[r for r in pred if r['status']=='ok' and r['predicted']==variant]
 predRows.append({'variant':'Predicted Outputs' if variant else 'Control','trials':len(rows),'firstP50':stat(rows,'firstTokenMs'),'totalP50':stat(rows,'totalMs'),'totalP95':stat(rows,'totalMs',.95),'acceptedTokens':sum((r.get('usage') or {}).get('completion_tokens_details',{}).get('accepted_prediction_tokens',0) for r in rows),'rejectedTokens':sum((r.get('usage') or {}).get('completion_tokens_details',{}).get('rejected_prediction_tokens',0) for r in rows)})
query('prediction',predRows,'Paired direct OpenAI requests','6 translation revisions × 3 paired repetitions, alternating control and prediction order. Identical parameters, no completion-token cap on either arm. Same model and network path. Prediction is the previous translation.', ['prediction-final.jsonl'])
e2e=[]
native=[r for r in (read('native-reviewed') or read('native')) if r.get('rep',0)>=10];pipe=[]
rawPipes=read('pipeline-stream-reviewed') or read('pipeline-stream')
for r in rawPipes:
 if not r.get('provider'):r['provider']=r.get('stt','unknown')+' → '+r.get('llm','google/gemini-3.5-flash-lite')+' → '+r.get('tts','unknown')
for model,allRows in groups([r for r in rawPipes if 'audioTimeline' in r or r.get('status')=='failed'],'provider'):
 for case,caseRows in groups(allRows,'caseId'):
  pipe+=caseRows[-(1 if caseRows[-1].get('policy')=='final' else 2):]
allGroups=dict(groups(native+pipe,'provider'))
comparisonCases=sorted(set.intersection(*(set(r['caseId'] for r in rr) for rr in allGroups.values()))) if allGroups else []
# Compare native to the same source files as the modular arms, not a faster corpus subset.
native=[r for r in native if r['caseId'] in comparisonCases]
pipe=[r for r in pipe if r['caseId'] in comparisonCases]
for r in native+pipe:
 item=corpusBy[r['caseId']]
 offset=80 if r.get('stt')=='deepgram-flux' else 100
 r['packetDelayFromSourceMs']=None if r.get('firstAudioMs') is None else r['firstAudioMs']+offset-item['alignedSpeechStartMs']
 r['speechDelayFromSourceMs']=None if r.get('speechPlaybackStartMs') is None else r['speechPlaybackStartMs']+offset-item['alignedSpeechStartMs']
 r['alignedEndLagMs']=None if r.get('speechPlaybackEndMs') is None else r['speechPlaybackEndMs']+offset-item['alignedSpeechEndMs']
for model,rows in groups(native+pipe,'provider'):
 ok=[r for r in rows if r['status']=='ok'];e2e.append({'model':model,'trials':len(rows),'success':len(ok),'packetP50':stat(ok,'packetDelayFromSourceMs'),'speechP50':stat(ok,'speechDelayFromSourceMs'),'speechP95':stat(ok,'speechDelayFromSourceMs',.95),'endLagP50':stat(ok,'alignedEndLagMs'),'cases':len(set(r['caseId'] for r in rows)),'revisedPrefixes':sum(r.get('sourceRevisions',0) for r in ok)})
query('e2e',sorted(e2e,key=lambda x:x['speechP50'] or 1e9),'Instrumented native and modular audio runs','20ms RMS onset requires first frame active and 4/5 active frames above max(0.015,5% peak RMS). PCM timelines rechecked against saved audio. A frame duration is added to reference first-send times to capture-start. Actual reception timestamps determine a simulated continuous playback queue. Excludes physical device and browser.', ['native-reviewed.jsonl','pipeline-stream-reviewed.jsonl'])
routing=read('routing');routeRows=[]
for direct in [True,False]:
 rr=[r for r in routing if r.get('direct')==direct and r['status']=='ok']
 if rr:routeRows.append({'route':'OpenAI direct' if direct else 'AI Gateway','trials':len(rr),'firstP50':stat(rr,'firstTokenMs'),'firstP95':stat(rr,'firstTokenMs',.95),'totalP50':stat(rr,'totalMs')})
query('routing',routeRows,'Same-model routing comparison','Same three source texts, gpt-4.1-nano, four paired repetitions; alternating order. Direct API and Gateway may use different provider capacity; not a pure network-hop experiment.', ['routing.jsonl'])
qualityRows=[]
uniqueQuality=list({r['key']:r for r in read('quality')}.values())
for model,rr in groups(uniqueQuality,'model'):
 qualityRows.append({'model':model,'outputs':len(rr),'scoreMean':round(statistics.mean(r['score'] for r in rr),2),'criticalFlags':sum(r['critical'] for r in rr)})
query('quality',qualityRows,'Automated bilingual error screening','Unique output strings, not trial-weighted rates. GPT-6.1 Sol compares source and independent human translation; not a human review. Models have unequal case/output coverage; do not compare flag percentages as final quality ranks.', ['quality.jsonl'])
data={'title':'Traduction instantanée : résultats des essais','surface':'report','status':'measured','buildStatus':'creating','report':{'asOf':'2026-10-23'},'filters':[],'queries':queries,'summary':{'humanClips':len(corpus),'languages':sorted(set(x['language'] for x in corpus)),'allCalls':sum(len(read(n)) for n in ['stt','tts','tts-final','translation','decision','prediction','prediction-final','native','pipeline','pipeline-stream','routing'])}}
(results/'cohort-selection.json').write_text(json.dumps({'stt':[{'provider':r['provider'],'caseId':r['caseId'],'rep':r['rep'],'timestamp':r['timestamp'],'status':r['status']} for r in selected],'e2e':[{'provider':r['provider'],'caseId':r['caseId'],'rep':r['rep'],'timestamp':r['timestamp'],'status':r['status'],'policy':r.get('policy','native')} for r in native+pipe],'commonCases':comparisonCases,'sttCommonWordCount':sum(len(x) for x in common.values()),'selection':'STT: latest three per provider-case; E2E: latest two per explicit provider+policy-case, one for finals; initial setup attempts retained in raw logs.'},ensure_ascii=False,indent=2))
(results/'reviewed-snapshot.json').write_text(json.dumps(data,ensure_ascii=False,indent=2))
print(json.dumps({'counts':data['summary'],'tables':{k:len(v['rows']) for k,v in queries.items()}}))

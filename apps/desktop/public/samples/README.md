# Incoming call audio fixtures

## One voice · 23 seconds

`nasa-en.wav` is a 22.723-second English excerpt of **How Do We Do Research in Zero Gravity? We Asked a NASA Expert**, published by NASA on May 28, 2025.

- [YouTube video](https://www.youtube.com/watch?v=EU8dbEH25ak)
- [Official video and downloads](https://images.nasa.gov/details/How%20Do%20We%20Do%20Research%20in%20Zero%20Gravity)
- [NASA article and transcript](https://www.nasa.gov/missions/station/iss-research/how-do-we-do-research-in-zero-gravity-we-asked-a-nasa-expert-episode-62/)
- Credit: NASA. Producers: Scott Bednar, Pedro Cota, Jessie Wilde. Editor: James Lucas.
- Excerpt: 00:05.438–00:28.161. Mono, 24 kHz, signed 16-bit PCM WAV.
- Used only for the incoming English call sample. The conversation and outgoing call samples remain synthetic (`en.wav` and `fr.wav`). No voice cloning or microphone capture.

Reproduce from NASA's downloadable copy of the YouTube video (requires FFmpeg):

```sh
ffmpeg -ss 5.438 \
  -i 'https://images-assets.nasa.gov/video/How%20Do%20We%20Do%20Research%20in%20Zero%20Gravity/How%20Do%20We%20Do%20Research%20in%20Zero%20Gravity~small.mp4' \
  -t 22.723 -vn -ac 1 -ar 24000 -c:a pcm_s16le nasa-en.wav
```

## Three voices · 24 seconds

`nasa-three-speakers-en.wav` is a continuous 24-second English excerpt of **NASA Astronauts Discuss Life In Space With NASA Administrator, Deputy Administrator - Jan. 8, 2025**, published by NASA Video.

- [YouTube video](https://www.youtube.com/watch?v=_frvcTLLdaU)
- [Official downloadable recording](https://images.nasa.gov/details/iss072m260081831-Expedition72_Astronauts_talk_to_NASA_Leaders_BillNelson_PamMelroy_010825_2116772)
- [NASA event](https://plus.nasa.gov/scheduled-video/astronauts-talk-to-nasa-leaders/)
- Credit: NASA. The excerpt contains Suni Williams, Mission Control Houston and Bill Nelson taking turns during the opening voice check, with Williams speaking again at the end. No overlapping dialogue is introduced.
- Excerpt in the downloadable recording: 00:24.000–00:48.000. Mono, 24 kHz, signed 16-bit PCM WAV. The YouTube livestream and downloadable recording can have different time offsets.
- This fixture tests changing voices in the incoming translation stream. It does not add speaker diarization, per-person caption labels or multiple translated voices. All participants use the selected incoming language; the app still has profiles A/B and one incoming translated voice per session. No voice cloning or microphone capture.

Reproduce from NASA's downloadable copy:

```sh
ffmpeg -ss 24 \
  -i 'https://images-assets.nasa.gov/video/iss072m260081831-Expedition72_Astronauts_talk_to_NASA_Leaders_BillNelson_PamMelroy_010825_2116772/iss072m260081831-Expedition72_Astronauts_talk_to_NASA_Leaders_BillNelson_PamMelroy_010825_2116772~small.mp4' \
  -t 24 -vn -ac 1 -ar 24000 -c:a pcm_s16le nasa-three-speakers-en.wav
```

## Use in the app

Open **Online meeting → You speak: Français → They speak: English → Test without joining a call**. Under **Choose a recording**, select **One voice · 23 seconds** or **Three voices · 24 seconds**, then **Start the recording test**. The choice is locked while the test runs; stop it before switching recordings. The three-voice recording is only offered for English input; French keeps its existing synthetic sample.

Captions are always enabled for this test. Use **Play the original English audio** to switch the original sound on or off during the test without restarting playback or transcription. It is off by default. Leave both that option and **Also read the French translation aloud** unchecked for silent verification. Headphones are recommended for audible tests. Captions appear progressively without a word highlight. The samples exercise transcription, translation and caption publishing; they do not exercise the native system-audio tap. Provider-free previews and other tools are under **Other checks**, each with its own explanation.

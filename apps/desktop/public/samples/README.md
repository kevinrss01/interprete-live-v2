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

## Use in the app

Open **Benchmark → You speak: Français → They speak: English**, then **Start the recording test** to use the NASA solo recording. The Recording selector lists the fixtures available for the selected source language. Choose a different target language under You speak.

Captions are always enabled for this test. Use **Play the original English audio** to choose whether the original sound is audible. This setting is locked during a run to keep its recorded configuration consistent. It is off by default. Leave both that option and **Also read the French translation aloud** unchecked for silent verification. Headphones are recommended for audible tests. Captions appear progressively without a word highlight. The samples exercise transcription, translation and caption publishing; they do not exercise the native system-audio tap. Provider-free previews and other tools are under **Other checks**, each with its own explanation.

## Longer multilingual fixtures

Complete ESA educational videos published on YouTube, extracted from their official downloadable copies. Credit: ESA. Source pages carry ESA Standard Licence terms. Narration includes music; these are not spontaneous conversations. Converted without trimming or normalization to mono 24 kHz signed 16-bit PCM. Only used as demo input, never as a voice-cloning sample. Total additional uncompressed audio: approximately 52 MB.

### `esa-ice-en.wav` (en, 244.715 seconds)

- [YouTube](https://www.youtube.com/watch?v=ntI0n6zUNJE) · [Official source and credits](https://www.esa.int/esatv/Videos/2024/12/Paxi_explores_ice)
- SHA-256: `0e18068a9dfe6f4973a5c52cff1a5441053e144f30ea66734a7da94eb1de0796`

```sh
ffmpeg -i 'https://dlmultimedia.esa.int/download/public/videos/2024/12/024/2412_024_AR_EN.mp4' -vn -ac 1 -ar 24000 -c:a pcm_s16le esa-ice-en.wav
```

### `esa-agency-fr.wav` (fr, 218.964 seconds)

- [YouTube](https://www.youtube.com/watch?v=mASffpwnr60) · [Official source and credits](https://www.esa.int/esatv/Videos/2026/06/Paxi_and_the_European_Space_Agency/(lang)/fr)
- SHA-256: `c301d6fff083ac7040166913c924190662d4b0c632c59d1d19208a9dd7ab5b85`

```sh
ffmpeg -i 'https://dlmultimedia.esa.int/download/public/videos/2026/06/037/2606_037_AR_FR.mp4' -vn -ac 1 -ar 24000 -c:a pcm_s16le esa-agency-fr.wav
```

### `esa-greenhouse-de.wav` (de, 293.059 seconds)

- [YouTube](https://www.youtube.com/watch?v=7tEODAlOIZY) · [Official source and credits](https://www.esa.int/esatv/Videos/2018/05/Paxi_-_The_Greenhouse_Effect/(lang)/de)
- SHA-256: `217117bd8f97611fb9df6d29301ec4d1d238d74049eeaeda4f48a1cedf04eb7f`

```sh
ffmpeg -i 'https://dlmultimedia.esa.int/download/public/videos/2018/05/021/1805_021_AR_DE.mp4' -vn -ac 1 -ar 24000 -c:a pcm_s16le esa-greenhouse-de.wav
```

### `esa-solar-es.wav` (es, 318.346 seconds)

- [YouTube](https://www.youtube.com/watch?v=vQIsQK4m7Qk) · [Official source and credits](https://www.esa.int/esatv/Videos/2015/01/Paxi_-_The_Solar_System/(lang)/es)
- SHA-256: `ace0f69b2a41c28bbf16c84882bd74d2c93e35139296d86e1bb5e401d911d12f`

```sh
ffmpeg -i 'https://dlmultimedia.esa.int/download/public/videos/2015/01/014/1501_014_AR_ES.mp4' -vn -ac 1 -ar 24000 -c:a pcm_s16le esa-solar-es.wav
```

import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowUp, ArrowUpRight, Check, Languages, Mic, Pause, Play, Zap } from "lucide-react";
import { Button } from "./button";

const logo = new URL("../assets/logo.png", import.meta.url).href;
const clouds = new URL("../assets/hero-clouds-3840.jpg", import.meta.url).href;
const cloudsMedium = new URL("../assets/hero-clouds-1920.jpg", import.meta.url).href;
const cloudsSmall = new URL("../assets/hero-clouds-1280.jpg", import.meta.url).href;
const landscape = new URL("../assets/download-landscape.webp", import.meta.url).href;
const landscapeSmall = new URL("../assets/download-landscape-1280.webp", import.meta.url).href;
const DOWNLOAD_URL = "https://h7ddt3inb3wj86c7.public.blob.vercel-storage.com/Interprete-macOS-arm64.dmg?download=1";
const EXAMPLES = [
  { code: "en", language: "English", text: "Would you like to grab a coffee?" },
  { code: "es", language: "Spanish", text: "¿Te apetece tomar un café?" },
  { code: "ja", language: "Japanese", text: "一緒にコーヒーでもどうですか？" },
] as const;
const WAVE_HEIGHTS = [8, 14, 22, 12, 28, 18, 10, 24, 16, 30, 12, 20, 26, 10, 18, 8];
const TURN_STAGES = [
  { label: "Speak", icon: Mic, status: "Listening to you", message: "“There’s something I’d like to tell you…”", caption: "Translated speech can start while you are still speaking." },
  { label: "Pause", icon: Pause, status: "A pause. Still your turn.", message: "“Let me find the right words…”", caption: "Take a breath. Your turn stays open." },
  { label: "Keep going", icon: Play, status: "Picking up your thought", message: "“And one more thing…”", caption: "Pick up where you left off. It is still your turn." },
  { label: "End turn", icon: Check, status: "Ready for their reply", message: "“What do you think?”", caption: "You end your turn explicitly. Now there is room for their reply." },
] as const;

function MacDownloadButton({ className = "" }: { className?: string }) {
  return <a href={DOWNLOAD_URL} className={`landing-mac-download ${className}`} aria-label="Download for Mac (Apple Silicon)">
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
    <span>Download for Mac</span>
  </a>;
}

function useDemoCycle({ count, initialStep, intervalMs, ref }: { count: number; initialStep: number; intervalMs: number; ref: RefObject<HTMLElement | null> }) {
  const [step, setStep] = useState(initialStep);
  const [playing, setPlaying] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stopForReducedMotion = () => { if (motion.matches) setPlaying(false); };
    motion.addEventListener("change", stopForReducedMotion);
    return () => motion.removeEventListener("change", stopForReducedMotion);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const bounds = ref.current?.getBoundingClientRect();
      if (document.hidden || !bounds || bounds.bottom <= 0 || bounds.top >= window.innerHeight) return;
      setStep((current) => (current + 1) % count);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [count, intervalMs, playing, ref, step]);

  return { step, setStep, playing, setPlaying };
}

// Crop the existing brand asset with its viewBox; no new mark or palette.
function SpeechMark() {
  return <svg viewBox="50 130 500 450" aria-hidden="true" className="landing-speech-mark">
    <image href={logo} width="2172" height="724" />
  </svg>;
}

function Laurel() {
  return <svg viewBox="0 0 24 40" aria-hidden="true" className="landing-laurel">
    <path d="M21 2C8 10 4 25 13 38l1-1C6 24 10 11 22 3Z M18 4c-5-2-8 1-7 6 4 0 7-2 7-6Z M12 10c-6-1-8 3-6 7 5-1 7-3 6-7Z M8 18c-6 0-8 4-5 8 5-1 7-4 5-8Z M8 26c-5 2-5 7-1 10 4-3 4-6 1-10Z M15 9c5 0 5 4 1 7-3-2-3-5-1-7Z M11 17c5 0 7 4 3 8-4-1-5-4-3-8Z M11 26c5-1 8 2 6 7-4 0-7-3-6-7Z" fill="currentColor" />
  </svg>;
}

function ConversationScene() {
  const ref = useRef<HTMLElement>(null);
  const { step, setStep, playing, setPlaying } = useDemoCycle({ count: EXAMPLES.length, initialStep: 0, intervalMs: 3500, ref });
  const example = EXAMPLES[step];
  const words = example.code === "ja" ? Array.from(example.text) : example.text.split(" ");

  return <section ref={ref} className="landing-conversation" aria-label="Interactive translation example" data-playing="true">
    <div className="landing-demo-toolbar"><span><Languages aria-hidden="true" />Translation preview</span><Button variant="ghost" className="landing-demo-autoplay" aria-label={playing ? "Pause automatic translation" : "Play automatic translation"} title={playing ? "Pause automatic translation" : "Play automatic translation"} onClick={() => setPlaying((current) => !current)}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</Button></div>
    <div className="landing-translation-canvas">
      <div className="landing-speech landing-speech-source">
        <div className="landing-speech-meta">You</div>
        <p lang="fr">Tu veux prendre<br />un café ?</p>
        <div className="landing-speech-foot"><div className="landing-waveform" key={step} aria-hidden="true">{WAVE_HEIGHTS.map((height, index) => <span key={index} style={{ height, animationDelay: `${index * 35}ms` }} />)}</div></div>
      </div>
      <div className="landing-voice-bridge" key={`bridge-${step}`} aria-hidden="true"><span /><div><SpeechMark /></div><span /><p>Interprète</p></div>
      <div className="landing-speech landing-speech-translation">
        <div className="landing-speech-meta">Other people</div>
        <div className="landing-translation-text" aria-live={playing ? "off" : "polite"} aria-atomic="true"><p key={step} lang={example.code}>{words.map((word, index) => <span key={index} style={{ animationDelay: `${220 + index * 60}ms` }}>{word}{example.code !== "ja" && index < words.length - 1 ? " " : ""}</span>)}</p></div>
        <div className="landing-speech-foot"><span className="landing-translation-state"><Zap aria-hidden="true" />Low-latency translation</span></div>
      </div>
    </div>
    <div className="landing-demo-controls">
      <span className="landing-language-label">Translate into</span>
      <div className="landing-language-controls" role="group" aria-label="Translation language">
        <span className="landing-selection" aria-hidden="true" style={{ transform: `translateX(${step * 100}%)` }} />
        {EXAMPLES.map((item, index) => <button type="button" key={item.code} aria-pressed={step === index} onClick={() => { setPlaying(false); setStep(index); }}>{item.language}</button>)}
      </div>
    </div>
  </section>;
}

function TurnScene() {
  const ref = useRef<HTMLDivElement>(null);
  const { step: stage, setStep: setStage, playing, setPlaying } = useDemoCycle({ count: TURN_STAGES.length, initialStep: 1, intervalMs: 4500, ref });
  const current = TURN_STAGES[stage];
  const speaking = stage === 0 || stage === 2;
  const StatusIcon = current.icon;

  return <div ref={ref} className="landing-turn-scene">
    <Button variant="ghost" className="landing-demo-autoplay" aria-label={playing ? "Pause automatic turn demo" : "Play automatic turn demo"} title={playing ? "Pause automatic turn demo" : "Play automatic turn demo"} onClick={() => setPlaying((current) => !current)}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</Button>
    <div className="landing-turn-copy" aria-live={playing ? "off" : "polite"} aria-atomic="true">
      <div className="landing-turn-content" key={stage}>
        <p className="landing-turn-status"><StatusIcon aria-hidden="true" />{current.status}</p>
        <div className="landing-turn-waveform" data-speaking={speaking} data-stage={stage} aria-hidden="true">{[...WAVE_HEIGHTS, ...WAVE_HEIGHTS].map((height, index) => <span key={index} style={{ height: stage === 3 || (stage === 1 && index > 15) ? 4 : height * 2, animationDelay: `${index * 25}ms` }} />)}</div>
        <p className="landing-turn-message">{current.message}</p>
        <p className="landing-turn-caption">{current.caption}</p>
      </div>
    </div>
    <div className="landing-turn-controls" role="group" aria-label="Speaking turn stages">
      <span className="landing-selection" aria-hidden="true" style={{ transform: `translateX(${stage * 100}%)` }} />
      {TURN_STAGES.map((item, index) => <button key={item.label} type="button" className="landing-turn-step" aria-pressed={stage === index} onClick={() => { setPlaying(false); setStage(index); }}><item.icon aria-hidden="true" />{item.label}</button>)}
    </div>
  </div>;
}

export function LandingPage() {
  const [navigationHidden, setNavigationHidden] = useState(false);

  useEffect(() => {
    let previousScroll = Math.max(0, window.scrollY);
    const updateNavigation = () => {
      const scroll = Math.max(0, window.scrollY);
      const difference = scroll - previousScroll;
      if (scroll < 56) setNavigationHidden(false);
      else if (Math.abs(difference) > 4) setNavigationHidden(difference > 0);
      if (Math.abs(difference) > 4 || scroll === 0) previousScroll = scroll;
    };
    window.addEventListener("scroll", updateNavigation, { passive: true });
    return () => window.removeEventListener("scroll", updateNavigation);
  }, []);

  return <div className="landing-surface">
    <a className="landing-skip" href="#main">Skip to content</a>
    <header className="landing-header" data-hidden={navigationHidden}>
      <nav aria-label="Main navigation">
        <a href="#home">Home</a>
        <a href="#features">Features</a>
        <a href="#download">Download</a>
      </nav>
    </header>
    <main id="main" tabIndex={-1}>
      <section id="home" className="landing-hero" aria-labelledby="landing-title">
        <img className="landing-hero-background" src={clouds} srcSet={`${cloudsSmall} 1280w, ${cloudsMedium} 1920w, ${clouds} 3840w`} sizes="100vw" width="3840" height="2160" alt="" fetchPriority="high" />
        <div className="landing-intro">
          <p className="landing-hero-label"><Laurel /><span>Live translation.<br />Human connection.</span><Laurel /></p>
          <h1 id="landing-title">Your voice. <em className="landing-title-accent">In their language.</em></h1>
          <p className="landing-description">Speak your language. Connect in theirs.<br className="landing-desktop-break" /> Live translation, with a voice you choose.</p>
          <div className="landing-hero-actions">
            <MacDownloadButton />
            <p>macOS 14.2+ · Apple Silicon</p>
          </div>
        </div>
      </section>

      <section id="features" className="landing-chapter landing-paper" aria-labelledby="example-title">
        <div className="landing-frame">
          <div className="landing-section-heading">
            <div><h2 id="example-title">Two languages.<br /><em>One conversation.</em></h2></div>
            <p className="landing-body-copy">Speak in your language. Hear the reply in theirs. Two people, one shared device.</p>
          </div>
          <ConversationScene />
        </div>
      </section>
      <section id="how-it-works" className="landing-pause" aria-labelledby="pause-title">
        <div className="landing-frame landing-pause-grid">
          <div><h2 id="pause-title">Take a breath.<br /><em>Keep talking.</em></h2><p className="landing-body-copy">Find a word. Finish a thought. Your turn stays open until you decide it is over.</p></div>
          <TurnScene />
        </div>
      </section>

      <section id="download" className="landing-download landing-frame" aria-labelledby="download-title">
        <div className="landing-download-card">
          <img className="landing-download-landscape" src={landscape} srcSet={`${landscapeSmall} 1280w, ${landscape} 1983w`} sizes="(min-width: 1280px) 1184px, 100vw" width="1983" height="793" loading="lazy" alt="" />
          <div className="landing-download-content">
            <h2 id="download-title">Ready for your<br />next conversation?</h2>
            <div className="landing-download-actions">
              <MacDownloadButton className="landing-download-button" />
              <p className="landing-download-requirements">macOS 14.2+ · Apple Silicon</p>
            </div>
          </div>
        </div>
      </section>
    </main>
    <footer className="landing-footer">
      <div className="landing-frame">
        <div className="landing-footer-panel">
          <div><a href="#home" className="landing-wordmark"><img src={logo} alt="Interprète home" width="2172" height="724" loading="lazy" /></a><p className="landing-footer-copy">© {new Date().getFullYear()} Interprète</p></div>
          <nav aria-label="Footer navigation"><a href="#features">Features<ArrowUpRight aria-hidden="true" /></a><a href={DOWNLOAD_URL} aria-label="Download for macOS (Apple Silicon)">Download for macOS<ArrowUpRight aria-hidden="true" /></a></nav>
          <a href="#home" className="landing-footer-top" aria-label="Back to top"><ArrowUp aria-hidden="true" /></a>
        </div>
      </div>
    </footer>
  </div>;
}

import { useEffect, useRef } from "react";
import { LoaderCircle, Play, Trash2 } from "lucide-react";
import type { Profile, SpeakerId, Turn } from "@interprete/shared/contracts";
import { languageName } from "@interprete/shared/languages";
import { Button } from "@interprete/ui/components/button";

export function Conversation({
  turns,
  profiles,
  onPlay,
  onDemo,
  onClear,
  busy,
}: {
  turns: Turn[];
  profiles: Record<SpeakerId, Profile>;
  onPlay: (id: string) => void;
  onDemo: () => void;
  onClear: () => void;
  busy: boolean;
}) {
  // Keep the newest turn in view while the reader is at the end of the page.
  const followRef = useRef(true);
  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      followRef.current =
        window.innerHeight + window.scrollY >= doc.scrollHeight - 96;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!turns.length || !followRef.current) return;
    window.scrollTo({ top: document.documentElement.scrollHeight });
    followRef.current = true;
  }, [turns]);

  return (
    <section className="conversation" aria-labelledby="conversation-title">
      <h2 id="conversation-title" className="sr-only">
        Conversation
      </h2>
      {turns.length === 0 ? (
        <div className="empty">
          <p className="empty-title">
            Choisissez vos langues, puis activez le micro.
          </p>
          <p className="empty-text">
            La traduction s’affiche ici et se lit à voix haute. Gardez le son
            activé.
          </p>
          <Button className="btn" onClick={onDemo} disabled={busy}>
            <Play size={13} fill="currentColor" aria-hidden="true" />
            Essayer un exemple audio
          </Button>
        </div>
      ) : (
        <>
          <div className="conversation-tools">
            <Button
              variant="ghost"
              className="btn btn-quiet"
              disabled={busy}
              onClick={onDemo}
            >
              Exemple audio
            </Button>
            <Button
              variant="ghost"
              className="icon-btn"
              onClick={onClear}
              aria-label="Effacer la conversation"
              title="Effacer la conversation"
              disabled={busy}
            >
              <Trash2 size={16} aria-hidden="true" />
            </Button>
          </div>
          <ol
            className="turns"
            aria-live="polite"
            aria-relevant="additions text"
          >
            {turns.map((turn) => (
              <li className="turn" key={turn.id}>
                <span
                  className={`mark mark-${turn.speaker}`}
                  aria-hidden="true"
                >
                  {turn.speaker.toUpperCase()}
                </span>
                <div className="turn-body">
                  <p className="turn-meta">
                    <span className="turn-name">
                      {profiles[turn.speaker].name}
                    </span>
                    <span className="turn-lang">
                      <span aria-hidden="true">
                        {turn.sourceLanguage.toUpperCase()} →{" "}
                        {turn.targetLanguage.toUpperCase()}
                      </span>
                      <span className="sr-only">
                        {languageName(turn.sourceLanguage)} vers{" "}
                        {languageName(turn.targetLanguage)}
                      </span>
                    </span>
                    {turn.demo && <span className="tag">Exemple</span>}
                  </p>
                  {(turn.source || turn.status === "draft") && (
                    <p className="turn-source">
                      {turn.source || (
                        <span className="pending">À l’écoute…</span>
                      )}
                    </p>
                  )}
                  {(turn.translation ||
                    (turn.source && turn.status !== "error")) && (
                    <p className="turn-translation">
                      {turn.translation || (
                        <span className="pending">Traduction…</span>
                      )}
                      {turn.status === "working" && (
                        <LoaderCircle
                          size={15}
                          className="spin"
                          aria-label="Traduction en cours"
                        />
                      )}
                    </p>
                  )}
                  {turn.status === "error" && (
                    <p className="turn-error">{turn.error}</p>
                  )}
                  {turn.status === "done" && (
                    <div className="turn-actions">
                      {turn.audioUrl && (
                        <Button
                          variant="ghost"
                          className="btn btn-quiet btn-inline"
                          disabled={busy}
                          onClick={() => onPlay(turn.id)}
                        >
                          <Play
                            size={12}
                            fill="currentColor"
                            aria-hidden="true"
                          />
                          Réécouter
                        </Button>
                      )}
                      {(turn.metrics.firstAudioMs !== undefined ||
                        turn.metrics.playbackMs !== undefined) && (
                        <span className="tabular">
                          Premier audio à{" "}
                          {(
                            (turn.metrics.firstAudioMs ??
                              turn.metrics.playbackMs ??
                              0) / 1000
                          ).toLocaleString("fr-FR", {
                            maximumFractionDigits: 1,
                          })}{" "}
                          s
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

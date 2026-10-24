import { ArrowLeftRight, ArrowRight } from "lucide-react";
import type { Profile, SpeakerId } from "@interprete/shared/contracts";
import { languageName, languageNative } from "@interprete/shared/languages";

export type HomeChoice = "conversation" | "call";

export function Home({
  profiles,
  onChoose,
}: {
  profiles: Record<SpeakerId, Profile>;
  onChoose: (choice: HomeChoice) => void;
}) {
  const { a, b } = profiles;
  return (
    <section className="home" aria-labelledby="home-title">
      <h1 id="home-title" className="home-title">
        Que voulez-vous traduire&nbsp;?
      </h1>
      <ul className="home-choices">
        <li>
          <button
            type="button"
            className="home-choice"
            onClick={() => onChoose("conversation")}
          >
            <span className="home-choice-text">
              <span className="home-choice-title">Conversation</span>
              <span className="home-choice-detail">
                Deux personnes, un appareil. Chacun parle à son tour.
              </span>
            </span>
            <span className="home-choice-meta">
              <span className="home-choice-pair" aria-hidden="true">
                {languageNative(a.language)}
                <ArrowLeftRight size={13} />
                {languageNative(b.language)}
              </span>
              <span className="sr-only">
                {languageName(a.language)} et {languageName(b.language)}
              </span>
            </span>
            <ArrowRight
              size={18}
              className="home-choice-arrow"
              aria-hidden="true"
            />
          </button>
        </li>
        <li>
          <button
            type="button"
            className="home-choice"
            onClick={() => onChoose("call")}
          >
            <span className="home-choice-text">
              <span className="home-choice-title">Réunion en ligne</span>
              <span className="home-choice-detail">
                Sous-titres et voix traduites dans Meet, Zoom ou Teams.
              </span>
            </span>
            <span className="home-choice-meta" data-optional>
              Configurer
            </span>
            <ArrowRight
              size={18}
              className="home-choice-arrow"
              aria-hidden="true"
            />
          </button>
        </li>
      </ul>
    </section>
  );
}

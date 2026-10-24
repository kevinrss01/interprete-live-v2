import { languageName } from "@interprete/shared/languages";
import { Checkbox } from "@interprete/ui/components/checkbox";
import type { CallOptions } from "../lib/calls";

type Option = keyof CallOptions;
// The same choices in the call toast and the call panel, remembered between calls.
export function CallOptionChecks({
  options,
  include,
  disabled = false,
  mine,
  theirs,
  route,
  onChange,
}: {
  options: CallOptions;
  include: Option[];
  disabled?: boolean;
  mine: string;
  theirs: string;
  route?: string;
  onChange: (options: CallOptions) => void;
}) {
  const details: Record<Option, { title: string; detail: string }> = {
    captions: {
      title: "Sous-titres",
      detail: `Leur ${languageName(theirs).toLowerCase()} traduit en ${languageName(mine).toLowerCase()}, en bas de l’écran.`,
    },
    voice: {
      title: "Voix traduite",
      detail: "Leur traduction lue sur ce Mac, avec une voix proche. Casque conseillé.",
    },
    microphone: {
      title: "Ma voix dans l’appel",
      detail: route ?? "Votre micro traduit, envoyé par le micro virtuel.",
    },
  };
  return (
    <div className="call-options" role="group" aria-label="Traductions de l’appel">
      {include.map((key) => (
        <label className="check" key={key}>
          <Checkbox
            checked={options[key]}
            disabled={disabled}
            onCheckedChange={(checked) => onChange({ ...options, [key]: checked })}
          />
          <span>
            <strong>{details[key].title}</strong>
            <small>{details[key].detail}</small>
          </span>
        </label>
      ))}
    </div>
  );
}

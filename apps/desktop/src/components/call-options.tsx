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
      title: "Captions",
      detail: `Their ${languageName(theirs)} translated into ${languageName(mine)}, at the bottom of the screen.`,
    },
    voice: {
      title: "Translated voice",
      detail: "Their translation played on this Mac in a similar voice. Headphones recommended.",
    },
    microphone: {
      title: "My voice in the call",
      detail: route ?? "Your translated microphone, sent through the virtual microphone.",
    },
  };
  return (
    <div className="call-options" role="group" aria-label="Call translations">
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

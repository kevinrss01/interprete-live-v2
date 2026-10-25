import { AudioLines, Gauge, History, MessagesSquare, Phone } from "lucide-react";

export type View = "conversation" | "call" | "benchmark" | "history" | "voices" | "settings";

export const NAV: { view: View; label: string; icon: typeof Phone }[] = [
  { view: "conversation", label: "Conversation", icon: MessagesSquare },
  { view: "call", label: "Online meeting", icon: Phone },
  { view: "benchmark", label: "Benchmark", icon: Gauge },
  { view: "history", label: "History", icon: History },
  { view: "voices", label: "Voices", icon: AudioLines },
];

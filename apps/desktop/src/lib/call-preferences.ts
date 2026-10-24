import appConfiguration from "../../src-tauri/tauri.conf.json";
import type { OutputDevice } from "./calls";
export const APP_MICROPHONE_NAME = appConfiguration.productName;
// One microphone choice, shared by Settings, conversations, onboarding and calls.
export const MICROPHONE_KEY = "interprete-call-input";
export function savedMicrophone() {
  try {
    return localStorage.getItem(MICROPHONE_KEY) || undefined;
  } catch {
    return undefined;
  }
}
export function preferredOutput(outputs: OutputDevice[], saved: string) {
  const branded = outputs.find((device) => device.appMic);
  if (
    branded &&
    (!saved || /blackhole/i.test(saved) || saved === APP_MICROPHONE_NAME)
  )
    return branded.name;
  return outputs.some((device) => device.name === saved)
    ? saved
    : (branded?.name ?? outputs[0]?.name ?? APP_MICROPHONE_NAME);
}
export function savedRoute(value: string): "virtual" | "local" {
  return value === "local" ? "local" : "virtual";
}

export function displayedOutputs(outputs: OutputDevice[]) {
  const virtual = outputs.filter((device) => device.virtualMic);
  const branded = virtual.filter((device) => device.appMic);
  return branded.length ? branded : virtual;
}

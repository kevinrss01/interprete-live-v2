// Fixed local recordings keep repeated benchmarks on exactly the same audio.
export const BENCHMARK_RECORDINGS = [
  { file: "nasa-en.wav", language: "en", title: "NASA — Microgravity", duration: "0:23", source: "https://www.youtube.com/watch?v=EU8dbEH25ak" },
  { file: "esa-ice-en.wav", language: "en", title: "ESA — Ice and Earth's climate", duration: "4:05", source: "https://www.youtube.com/watch?v=ntI0n6zUNJE" },
  { file: "fr.wav", language: "fr", title: "Synthetic French sample", duration: "0:04", source: null },
  { file: "esa-agency-fr.wav", language: "fr", title: "ESA — Space in everyday life", duration: "3:39", source: "https://www.youtube.com/watch?v=mASffpwnr60" },
  { file: "esa-solar-es.wav", language: "es", title: "ESA — The Solar System", duration: "5:18", source: "https://www.youtube.com/watch?v=vQIsQK4m7Qk" },
  { file: "esa-greenhouse-de.wav", language: "de", title: "ESA — The greenhouse effect", duration: "4:53", source: "https://www.youtube.com/watch?v=7tEODAlOIZY" },
] as const;

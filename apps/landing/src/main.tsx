import { createRoot } from "react-dom/client";
import { LandingPage } from "@interprete/ui/components/landing-page";
import "@interprete/ui/landing.css";

createRoot(document.getElementById("root")!).render(
  <LandingPage />,
);

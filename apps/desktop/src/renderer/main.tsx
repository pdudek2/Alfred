import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { RendererErrorBoundary } from "./components/RendererErrorBoundary";
import "./styles.css";
import "./glass-probe.css";

if (new URLSearchParams(window.location.search).get("alfred-glass-probe") === "1") {
  document.documentElement.dataset.alfredGlassProbe = "true";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RendererErrorBoundary>
      <App />
    </RendererErrorBoundary>
  </StrictMode>,
);

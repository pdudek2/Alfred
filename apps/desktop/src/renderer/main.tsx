import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { RendererErrorBoundary } from "./components/RendererErrorBoundary";
import "./styles.css";

if (new URLSearchParams(window.location.search).get("alfred-window-material") === "native") {
  document.documentElement.dataset.alfredWindowMaterial = "native";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RendererErrorBoundary>
      <App />
    </RendererErrorBoundary>
  </StrictMode>,
);

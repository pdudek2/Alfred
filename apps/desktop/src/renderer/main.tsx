import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { RendererErrorBoundary } from "./components/RendererErrorBoundary";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RendererErrorBoundary>
      <App />
    </RendererErrorBoundary>
  </StrictMode>,
);

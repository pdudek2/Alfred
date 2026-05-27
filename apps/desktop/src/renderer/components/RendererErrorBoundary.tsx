import { Component, type ErrorInfo, type ReactNode } from "react";

type RendererErrorBoundaryProps = {
  children: ReactNode;
};

type RendererErrorBoundaryState = {
  error: Error | null;
  componentStack: string;
};

export class RendererErrorBoundary extends Component<RendererErrorBoundaryProps, RendererErrorBoundaryState> {
  state: RendererErrorBoundaryState = { componentStack: "", error: null };

  static getDerivedStateFromError(error: Error): RendererErrorBoundaryState {
    return { componentStack: "", error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? "" });
    console.error("[alfred-renderer]", error, info.componentStack);
  }

  render() {
    const { error } = this.state;

    if (!error) return this.props.children;

    return (
      <main className="renderer-crash-shell" role="alert">
        <section className="renderer-crash-card">
          <span>Renderer crashed</span>
          <strong>Alfred hit a UI error.</strong>
          <p>{error.message || "The renderer stopped while drawing the workspace."}</p>
          {this.state.componentStack && <pre>{this.state.componentStack}</pre>}
          <button type="button" onClick={() => window.location.reload()}>
            Reload Alfred
          </button>
        </section>
      </main>
    );
  }
}

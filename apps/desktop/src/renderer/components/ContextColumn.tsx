import { useEffect, useRef } from "react";
import { AgentTimelinePanel, type AgentTimelinePanelProps } from "./AgentTimelinePanel";
import { SideColumnHeader } from "./SideColumnHeader";

export type ContextColumnProps = {
  contextOpen: boolean;
  dismissalSuspended?: boolean;
  focusRequestKey: number;
  shortcutModifier: "Cmd" | "Ctrl";
  timelineProps: AgentTimelinePanelProps;
};

/**
 * Details holds the column the session stack had. It is a column, not a drawer: ⌘I hides and shows it, and Escape
 * stays with whatever has focus (a confirmation, the plan line, a menu).
 */
export function ContextColumn({
  contextOpen,
  dismissalSuspended = false,
  focusRequestKey,
  shortcutModifier,
  timelineProps,
}: ContextColumnProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const handledFocusRequestKeyRef = useRef(0);

  useEffect(() => {
    if (!contextOpen || focusRequestKey === handledFocusRequestKeyRef.current) return;
    handledFocusRequestKeyRef.current = focusRequestKey;
    if (dismissalSuspended) return;
    const frame = requestAnimationFrame(() => headingRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [contextOpen, dismissalSuspended, focusRequestKey]);

  return (
    <aside
      aria-label="Details"
      className={`context-column ${contextOpen ? "open" : "closed"}`}
      data-testid="context-column"
    >
      <div
        className={`context-drawer ${contextOpen ? "open" : "closed"}`}
        data-testid="context-drawer"
        aria-hidden={contextOpen ? "false" : "true"}
        inert={!contextOpen || undefined}
      >
        <SideColumnHeader headingRef={headingRef} shortcutModifier={shortcutModifier} />
        <AgentTimelinePanel {...timelineProps} />
      </div>
    </aside>
  );
}

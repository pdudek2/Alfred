import type { KeyboardEvent } from "react";

/**
 * Keys for a row of tabs: Left and Right move focus to the previous or next tab, wrapping around,
 * Home and End to the first and last. Enter or Space selects the focused tab, as on any button.
 * Focus alone never selects: selecting Terminal hands focus to the terminal, and Details reshapes the window.
 */
export function moveTabFocus(event: KeyboardEvent<HTMLElement>): void {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not(:disabled)'));
  const current = tabs.indexOf(event.target as HTMLElement);
  if (current < 0) return;
  const next = event.key === "ArrowRight"
    ? (current + 1) % tabs.length
    : event.key === "ArrowLeft"
      ? (current - 1 + tabs.length) % tabs.length
      : event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : undefined;
  if (next === undefined) return;
  event.preventDefault();
  tabs[next]?.focus();
}

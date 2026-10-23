import type { Ref } from "react";
import "./side-column-header.css";

type SideColumnHeaderProps = {
  /** Where focus lands when Details opens from the keyboard. */
  headingRef?: Ref<HTMLHeadingElement>;
  shortcutModifier: "Cmd" | "Ctrl";
};

/** The side column's heading. Sessions moved to the rail's tree, so the column holds Details alone; ⌘I hides it. */
export function SideColumnHeader({ headingRef, shortcutModifier }: SideColumnHeaderProps) {
  return (
    <div className="side-column-header">
      <h2 ref={headingRef} tabIndex={-1}>Details</h2>
      <kbd>{shortcutModifier === "Cmd" ? "⌘I" : "Ctrl I"}</kbd>
    </div>
  );
}

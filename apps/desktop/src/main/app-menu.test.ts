import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it } from "vitest";
import { applicationMenuTemplate } from "./app-menu.js";

function items(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return template.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? items(item.submenu) : [])]);
}

describe("application menu", () => {
  it("names Alfred and keeps editing, the developer tools and the window, without Reload or Close Window", () => {
    const template = applicationMenuTemplate();
    expect(template.map((item) => item.label ?? item.role)).toEqual(["Alfred", "editMenu", "View", "Window"]);

    const all = items(template);
    expect(all.find((item) => item.role === "quit")).toMatchObject({ label: "Quit Alfred" });
    expect(all.find((item) => item.role === "hide")).toMatchObject({ label: "Hide Alfred" });
    // Copy and paste in text fields need the Edit menu's roles.
    expect(all.some((item) => item.role === "editMenu")).toBe(true);
    expect(all.some((item) => item.role === "toggleDevTools")).toBe(true);
    // Reload remounts every terminal; Command W closes the focused session in the Deck, not the window.
    for (const role of ["reload", "forceReload", "close", "fileMenu", "viewMenu"]) {
      expect(all.some((item) => item.role === role)).toBe(false);
    }
  });
});

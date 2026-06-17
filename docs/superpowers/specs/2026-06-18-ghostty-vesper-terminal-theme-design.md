# Ghostty Vesper Terminal Theme Design

## Context

Alfred renders live terminal tiles with `@xterm/xterm`. The current terminal visual settings are inline inside `TerminalDesk.tsx`: font stack, cursor behavior, line height, and the xterm color palette live beside runtime/session logic.

Patryk wants Alfred's embedded terminal to feel closer to his Ghostty setup shown in screenshots: Ghostty using `theme = Vesper`, Geist/JetBrains mono fonts, 13px text, a bar cursor, tuned selection colors, and compact glass-like padding. This change is visual only. It must keep xterm as the renderer and must not alter PTY, shell, session lifecycle, external Ghostty launching, or persistence behavior.

## Goals

- Make Alfred's embedded terminal visually closer to Patryk's Ghostty Vesper setup.
- Keep the terminal styling testable and isolated from terminal runtime logic.
- Preserve the existing Alfred desktop shell, Review, Observatory, and right dock visual direction.
- Keep xterm intact; do not replace it with a plain text renderer or an external terminal embed.

## Non-Goals

- Do not parse the local Ghostty config at runtime.
- Do not implement a theme picker.
- Do not change Ghostty keybindings, shell integration, clipboard policy, splits, or macOS window blur behavior.
- Do not change terminal process creation, PTY environment, cwd handling, session restoration, or Codex/Claude resume behavior.

## Chosen Approach

Use a static renderer preset named `ghosttyVesperTerminalProfile`.

The preset will be the source of truth for Alfred's embedded xterm visuals:

- `fontFamily`: Geist Mono / GeistMono Nerd Font first, JetBrains Mono fallback, then system monospace fallbacks.
- `fontSize`: `13`.
- `lineHeight`: close to the current readable height while reflecting Ghostty's `adjust-cell-height = 5%`.
- `cursorBlink`: `true`.
- `cursorStyle`: `bar`.
- `theme`: Vesper-like dark palette with Ghostty config selection colors and cursor color.

`TerminalDesk.tsx` will import this profile and pass the relevant values into `new Terminal(...)`. This keeps the component focused on terminal lifecycle and rendering, not theme definitions.

## Visual Mapping

The Ghostty config values map to xterm as follows:

- `theme = Vesper`: represented by a curated Vesper-like xterm color palette.
- `selection-background = #3a2a38`: maps to `selectionBackground`.
- `selection-foreground = #ffffff`: maps to `selectionForeground`.
- `font-family = GeistMono Nerd Font`, `Geist Mono`, `JetBrainsMono Nerd Font`: maps to the xterm `fontFamily` stack.
- `font-size = 13`: maps to xterm `fontSize`.
- `cursor-style = bar`: maps to xterm `cursorStyle`.
- `cursor-color = #b9aeda`: maps to xterm `cursor`.
- `background-opacity`, `background-blur`, and Ghostty window padding: approximated in CSS around `.xterm-host`, not in xterm itself.

## Components And Files

- Add `apps/desktop/src/renderer/terminal-visual-profile.ts`
  - Exports `ghosttyVesperTerminalProfile`.
  - Exports a narrow `TerminalVisualProfile` type if useful for tests.
- Update `apps/desktop/src/renderer/components/TerminalDesk.tsx`
  - Imports the profile.
  - Uses it for xterm font, cursor, line-height, and theme options.
- Update `apps/desktop/src/renderer/styles.css`
  - Tunes `.xterm-host` padding/background to better match Ghostty spacing and dark glass.
  - Keeps xterm host stable inside existing terminal tile chrome.
- Add `apps/desktop/src/renderer/terminal-visual-profile.test.ts`
  - Asserts Ghostty/Vesper values are present in the preset.
- Update existing TerminalDesk/App tests only if the imported profile changes observable behavior under the current mocks.

## Data Flow

There is no runtime data fetch and no local file read.

```text
terminal-visual-profile.ts
  -> TerminalDesk.tsx
  -> new Terminal(profile-derived options)
  -> xterm renders with Ghostty Vesper-like visuals
```

## Error Handling

The profile is a static module, so there is no user-facing error path. If a preferred font is unavailable on a machine, browser font fallback proceeds through the stack to system monospace fonts.

## Accessibility And Usability

- Maintain high contrast for foreground/background and selection text.
- Keep cursor blinking consistent with the Ghostty config.
- Preserve terminal keyboard input and focus behavior.
- Do not let visual chrome reduce terminal viewport usability.

## Testing

Use TDD for implementation:

1. Add a failing unit test for `ghosttyVesperTerminalProfile`.
2. Add the profile module and make that test pass.
3. Update `TerminalDesk.tsx` to consume the profile.
4. Run focused tests, then full desktop verification:
   - `pnpm --filter @alfred/desktop typecheck`
   - `pnpm --filter @alfred/desktop test`
   - `pnpm --filter @alfred/desktop build`
   - `git diff --check`

## Open Decisions

None. The approved scope is the static Ghostty/Vesper preset.

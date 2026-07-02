## Podsumowanie

- `History` pozostało kanoniczną pełną przeglądarką sesji i project memory, z dodatkową linijką copy doprecyzowującą tę rolę.
- Akcja `Sessions` w nagłówku została przemianowana semantycznie na quick switch przez nowe aria-label i uproszczony modal.
- `SessionObservatoryPanel` zachowuje wyszukiwanie, filtrowanie, focus trap i `onOpenSession(workspaceId, sessionId)`, ale nie duplikuje już pełnego browsera.
- Zmiany kodu objęły: `WorkbenchHeader.tsx`, `SessionObservatoryPanel.tsx`, `SessionObservatoryPanel.test.tsx`, `ObservatorySurface.tsx`, `app.test.tsx`, `styles.css`.
- `app.tsx` nie wymagał zmiany logiki stanu, bo istniejące spięcie otwierania modala i przejścia do sesji pozostało poprawne.

## Testy

- `cd apps/desktop && node_modules/.bin/vitest run src/renderer/components/SessionObservatoryPanel.test.tsx`
- `cd apps/desktop && node_modules/.bin/vitest run src/renderer/components/ObservatorySurface.test.tsx`
- `cd apps/desktop && node_modules/.bin/vitest run src/renderer/app.test.tsx -t "History as the full session browser|session quick switch to command palette"`
- `cd apps/desktop && node_modules/.bin/vitest run src/renderer/app.test.tsx`

## Obawy

- Nie było potrzeby zmieniać przepływu external Codex/trust/privacy; bezpieczeństwo tej ścieżki opiera się na istniejącej logice `ObservatorySurface` oraz jej testach regresyjnych.
- Największe ryzyko integracyjne to wyłącznie odbiór wizualny kompaktowego modala przy bardzo długich tytułach sesji; zachowanie funkcjonalne i dostępnościowe jest pokryte testami.

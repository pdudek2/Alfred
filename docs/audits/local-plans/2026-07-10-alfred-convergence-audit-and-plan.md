# Alfred Convergence: audyt i plan dojścia do pierwszej używalnej wersji

> **Status dokumentu od 2026-08-01:** historyczny i zastąpiony przez
> `docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md`.
> Dokument pozostaje pod pierwotną ścieżką wyłącznie dlatego, że cytuje go
> pamięć projektu v2. Nie jest aktywną roadmapą ani źródłem nowych zadań.
> Wskazane niżej lokalne plany, mockupy i diagnostyka mogą być już wycofane;
> istotne wyniki oraz decyzje pozostają zapisane w tym dokumencie i w Git.
>
> **Dla agentów wykonawczych:** nie realizuj całego dokumentu jako jednego zadania. Przed wejściem w każdą fazę przygotuj osobny, mały plan implementacji. Do wykonania użyj `superpowers:subagent-driven-development` albo `superpowers:executing-plans`, z przeglądem po każdym zadaniu.

**Cel:** doprowadzić Alfreda do pierwszej wersji, w której Patryk faktycznie pracuje z agentami, zamiast prowadzić kolejne losowe iteracje nad samą aplikacją.

**Architektura kierunkowa:** Electron jest głównym i jedynym wspieranym klientem oraz centrum pracy. Terminal jest powierzchnią dominującą. Inbox obsługuje prawdziwe decyzje, a obserwatorium pozostaje osobną, drugorzędną powierzchnią w Electronie. Dawny osobny frontend został usunięty w Fazie D; Vercel pozostaje powierzchnią API-only.

**Stack:** TypeScript, React, Electron, Vite, Vitest, xterm, plain CSS, pnpm/Turborepo; Hono, Zod, Drizzle/Postgres i SQLite w warstwach API, schema, db i runner.

**Stan repo podczas audytu:**

- branch: `ui-onebar-inbox`
- merge base z `main`: `e2df5c5`
- sprawdzany HEAD: `a507fc3`
- zakres diffu: 10 commitów, 15 plików renderer, `+673/-804`
- `git diff --check main...HEAD`: PASS
- pełne testy, build i Electron smoke nie były świeżo uruchamiane w ramach samego audytu

**Wersje narzędzi rozpoznane podczas audytu:** Node `22.23.1`, pnpm `10.0.0`, React `19.2.6`, Electron `42`, Vite `8.0.11`, Vitest `4.1.5`, TypeScript `6.0.3`. Repo nie deklaruje wersji Node. Szerokie użycie `latest` jest częściowo stabilizowane przez lockfile.

**Brakujące bramki i dokumenty:** nie znaleziono `CONTRIBUTING`, workflow CI, ESLint ani stylelint.

## Aktualny checkpoint

- **Faza A:** zakończona i zaakceptowana 2026-07-10.
- **Faza B:** zakończona; `ui-onebar-inbox` został zaakceptowany jako baseline strukturalny, scalony fast-forwardem i wypchnięty na `main` w `3e5362f`.
- **Faza C:** zakończona; `main` jest jedynym czystym baseline'em, pełna walidacja przeszła, a sześć stanów Electron ma zapisane screenshoty.
- **Faza D:** zakończona, scalona fast-forwardem i wypchnięta na `main` w `72b828c`; branch i worktree wykonawcze zostały usunięte.
- **Faza E:** zakończona; PR #46 scalony squashem do `main` w `24fac82`, a test-only hotfix hydracji terminala z PR #47 scalony w `0a3e188`.
- **Faza F:** zakończona, scalona fast-forwardem i wypchnięta do `main` w `c8aec57`; post-push GitHub Actions run `29167398204` przeszedł.
- **Faza G:** zakończona na `3bb2e66`; pełna bramka merged-main przeszła.
- **Faza H:** zakończona i ponownie zaakceptowana 2026-07-13. Kierunek „Scena + konstytucja”, skorygowany kontrakt runtime, komplet ramek R4b/R4c/R8b/R8c i finalny manifest przeszły closeout.
- **Faza J:** complete and published at `3242fc7` (accepted product result at `22bf219`); post-closeout native-glass calibration `0.30/0.36` jest zaakceptowana i opublikowana na `3544486`, z zielonym CI. J0 Slice 1–4, dogfooding, product-wide consistency/accessibility i bounded native glass pozostają zamknięte.
- **Faza Z:** zakończona, zaakceptowana przez Patryka i opublikowana na `main` w `2a020a0`; GitHub Actions run `30432394289` przeszedł (`quality`, `electron-smoke`).
- **Następna faza:** brak zatwierdzonej fazy. Pierwsza używalna wersja jest zamknięta; dalsza praca wymaga osobnego convergence/spec, a właściwe Observatory pozostaje kandydatem post-v1.
- **Czego teraz nie zaczynamy:** ponownego discovery kierunku wizualnego, glass na powierzchniach treści, ustawień intensywności/materialu, spekulatywnych funkcji Context/aux, pełnotekstowego indeksu wszystkich transkryptów ani właściwego Observatory.

### Wynik bramki Fazy B — 2026-07-10

- sprawdzany HEAD: `3e5362f` na branchu `ui-onebar-inbox`;
- zakres względem `main`: 16 commitów, 18 plików renderera, `+1268/-2026`; bez zmian w `apps/web`, main/preload, README i lockfile;
- usunięto aktywny no-op dla `waiting`, ujednolicono routing i semantykę akcji Inboxa oraz usunięto drugi globalny review modal;
- unsafe restored/relaunch ma jawne uzbrojenie przed wykonaniem, hard-block pozostaje zablokowany, a Inbox pokazuje pełną tożsamość workspace'u;
- Activity nie obcina już starszych zdarzeń przed `Show raw`; regresję pokrywa test z więcej niż dziewięcioma zdarzeniami;
- Inbox ma jednego właściciela scrolla, a normalny Work i Arrange mają jawnie rozdzielone stany DOM;
- targeted tests: 229/229 PASS; pełny desktop suite: 46 plików, 598/598 PASS; typecheck PASS; build PASS; `git diff --check` PASS;
- realny Electron smoke na izolowanym profilu potwierdził geometrię, input terminala, zachowanie bufora i tożsamości sesji przy Focus/Split/Grid, przełączaniu workspace'ów i powierzchni;
- długa kolejka Inboxa była przewijalna do końca, full workspace identity pozostała widoczna, a pierwszy unsafe click tylko uzbroił akcję i nie uruchomił procesu;
- po otwarciu recovery focus trafia do Inboxa; wcześniejsze ostrzeżenie `aria-hidden` zniknęło;
- konsola po smoke nie zawierała błędów runtime; pozostało standardowe ostrzeżenie CSP dla developerskiego Electrona. Build nadal emituje znane ostrzeżenie o rozmiarze chunka;
- rzeczywisty zapis użytkownika nie został użyty ani zmieniony — smoke działał na tymczasowym `--user-data-dir` i fixture'ach w `/tmp`.

**Decyzja techniczna:** branch przeszedł bramkę Fazy B i jest kandydatem do merge. Nie oznacza to akceptacji finalnego wyglądu — one-bar jest wyłącznie baseline'em strukturalnym. Faza C nie rozpoczyna się bez jawnej decyzji Patryka.

### Wynik bramki Fazy C — 2026-07-10

- `main` i `origin/main` wskazują `3e5362f`; lokalnie istnieje wyłącznie `main`, zdalnie wyłącznie `origin/main`, bez unmerged branchy;
- root `pnpm test` przeszedł: 20 testów skryptów i 7/7 pakietów Turbo; deterministyczny desktop suite przeszedł osobno: 46 plików, 598/598 testów;
- root `pnpm typecheck`, `pnpm lint` i `pnpm build` przeszły we wszystkich zadaniach;
- `lint` nadal jest wyłącznie drugim TypeScript checkiem, nie niezależnym lintem; to potwierdzone F10/P2 dla Fazy E;
- pooled desktop run w root gate emituje liczne ostrzeżenia React `act(...)`, podczas gdy serializowany run nie emituje ich; to dodatkowy dowód F10/P2, nie ukryty green check;
- realny renderer Electron 42 został uruchomiony na izolowanym `/tmp/alfred-phase-c-profile`; rzeczywisty zapis użytkownika i istniejące okno Alfreda nie zostały zmienione;
- zapisano baseline'y Work, Inbox, Observatory, Context, Split i narrow w `docs/audits/local-artifacts/2026-07-10-phase-c-baseline/`;
- szerokie baseline'y mają viewport 1440×920, narrow 1120×720; w narrow `scrollWidth === 1120`, bez poziomego overflow;
- świeży reload renderera nie zgłosił page errors ani runtime console errors; pozostało standardowe developerskie ostrzeżenie CSP Electrona;
- build nadal emituje znane, nieblokujące ostrzeżenie Vite o chunku powyżej 500 kB;
- w sześciu stanach bazowych nie zaobserwowano nowego P0/P1;
- tracked worktree pozostał czysty, a plan, manifest i screenshoty są ignorowane przez Git.

**Decyzja techniczna:** Faza C przeszła bramkę i kończy się na clean baseline. Nie jest to zgoda na dalszy redesign ani automatyczne rozpoczęcie Fazy D.

### Preflight Fazy D — 2026-07-10

- Patryk potwierdził, że nie korzysta z osobnego klienta webowego i jawnie polecił rozpocząć Fazę D;
- `apps/web` ma 58 tracked files i około 9536 linii; nie powstanie `apps/web-legacy`;
- klient jest liściem zależności: importuje `@alfred/schema`, ale Electron, API, runner, schema, db i adaptery nie importują `apps/web` ani `@alfred/web`;
- `pnpm-workspace.yaml` używa generycznego `apps/*`, a `turbo.json` generycznych tasków — oba zostają bez cargo-cult zmian;
- lokalny projekt Vercel `alfred` jest podłączony i nadal jest potrzebny root `api/**` shim dla runnera;
- Vercel zostanie przestawiony ze static Vite + API na API-only; projekt, env, runner auth i protection bypass nie są usuwane;
- webowe residue wymagające zmiany znaleziono w dev launcherze/doctorze, cloud smoke, env defaults, Vercel config, starym parallel-agent launcherze, README, AGENTS, test fixtures i lockfile;
- pełny plan wykonawczy był lokalnym artefaktem roboczym i został usunięty po wykonaniu Fazy D;
- deletion code nie został rozpoczęty przed zakończeniem tego audytu.

**Decyzja techniczna:** bramka wejścia Fazy D przeszła. Usuwamy kanał użytkowy, zachowujemy backend i chmurę API.

### Wynik bramki Fazy D — 2026-07-10

- branch `phase-d-web-decommission`, zakres `3e5362f..72b828c`: 8 małych commitów, 74 pliki, `+620/-9189`;
- usunięto wszystkie 58 tracked files dawnego klienta oraz jego importer z lockfile'a; nie powstał katalog legacy ani compatibility layer;
- zachowano Electron, API, runner, schema, db, adaptery, Drizzle i root `api/**` generated-function shim;
- Vercel jest API-only; public smoke sprawdza health/login, a authenticated smoke prawdziwe wersjonowane endpointy system/runs z wymaganym cookie;
- launcher lokalny, dev-doctor, env defaults i narzędzia worktree traktują desktop renderer na 4310 jako klienta, a API pozostaje na 4301;
- README opisuje faktyczny produkt desktopowy, granice main/preload/renderer, bezpieczny fixture-backed runner, API-only cloud oraz zweryfikowane komendy;
- tracked residue scan dla usuniętego pakietu, nazw, portu i env vars: zero trafień; poza dozwolonym testowym rename'em nie zmieniono produkcji renderera, runnera, packages, Drizzle ani root API;
- root `test`: PASS dla 6/6 package tasks oraz 6/6 suite'ów i 28/28 testów skryptów; `typecheck`: 9/9 Turbo tasks; `lint`: 9/9 Turbo tasks; `build`: 6/6 package tasks;
- testy pakietowe: 769/769 łącznie, w tym desktop 598/598, API 64/64, runner 73/73, schema 31/31, adapters 2/2 i db 1/1; deterministyczny desktop: 46/46 plików i 598/598 testów;
- wygenerowany artefakt Vercel API ma 1 071 606 B, SHA-256 `2d991ac42acc26982035e0ffafc4361afb8d70c2e0ac07dd72cfa7b881a0ec86` i jest niepusty;
- realny Electron smoke na tymczasowym profilu potwierdził Work, Inbox, Observatory/History, prawdziwy PTY oraz tę samą tożsamość xterm przy nawigacji; renderer/main runtime errors: 0/0;
- cleanup smoke pozostawił 0 procesów, 0 listenerów CDP i usunął stan tymczasowy; przy aktywnym PTY bounded SIGTERM nie zamknął aplikacji w 5 s, dlatego izolowany harness użył SIGKILL fallbacku zgodnego z istniejącym quit guardem;
- 122 znane warnings React `act(...)`, duży chunk Vite, developerski CSP oraz nie-graceful cleanup aktywnego PTY pozostają jawnym, nieblokującym materiałem dla Fazy E;
- wszystkie zadania przeszły niezależne review. Krytyczny błąd pierwotnego planu (`/api/system`, `/api/runs`) został zastąpiony za zgodą Patryka realnym kontraktem runtime: `/api/v1/system/status` i `/api/v1/runs?limit=1`.
- final whole-branch review wykrył ryzyko osierocenia Electron/PTY przez launcher oraz zbyt słaby test kontraktu Vercela; oba findingi naprawiono w `75b1c38` i `72b828c`;
- syntetyczny test procesu odtworzył RED z trzema żywymi potomkami, a GREEN potwierdził bounded SIGKILL dla stubborn groups i szybki normalny cleanup; exact deep-equality chroni cały zatwierdzony `vercel.json`; ponowny final review: Ready to merge — Yes.

**Decyzja techniczna:** Faza D jest `complete` i znajduje się na lokalnym oraz zdalnym `main` w `72b828c`. Branch/worktree Fazy D usunięto. Faza E jest `not started` i nie została rozpoczęta w tym diffie.

---

## 1. Jak używać tego dokumentu

Ten dokument zawiera pięć rzeczy, których wcześniej brakowało w jednym miejscu:

1. stałą definicję produktu;
2. diagnozę frustracji i błędnego procesu iteracji;
3. pełny Agent Sanity Review;
4. decyzje o obserwatorium i `apps/web`;
5. program prac z bramkami wejścia i wyjścia.

Obowiązują następujące zasady:

- Każde nowe zadanie musi wskazać konkretną fazę i finding z tego dokumentu albo problem zapisany podczas dogfoodingu.
- W danym momencie aktywna jest jedna faza programu.
- Nowy pomysł trafia do backlogu. Nie rozszerza trwającego diffu.
- Jeśli kod, dokument i aktualna decyzja się rozjeżdżają, praca zostaje zatrzymana. Najpierw aktualizowany jest rejestr decyzji.
- Starszy plan agenta nie jest źródłem prawdy tylko dlatego, że jest długi lub zawiera gotowy kod.
- Finding nie znika po cichu. Otrzymuje status: naprawiony, świadomie odłożony albo odrzucony z dowodem.

### Dokumenty historyczne, nieaktywne

Wykonane plany Faz B–D oraz wcześniejsze plany/specy UI zostały usunięte po integracji Fazy D. Ich kodowa historia pozostaje w Git, a decyzje i dowody potrzebne do dalszej pracy są skonsolidowane w tym dokumencie. Nie należy odtwarzać usuniętych planów jako źródła wymagań.

---

## 2. Definicja produktu do pierwszej wersji

### Product charter

> Alfred jest desktopowym centrum pracy i orkiestracji agentów. Główną powierzchnią jest terminal. Przełączanie projektów ma być natychmiastowe i nie może niszczyć stanu terminala. Inbox pojawia się wtedy, gdy potrzebna jest prawdziwa decyzja. Obserwatorium pomaga zrozumieć stan agentów, ale nie dominuje miejsca pracy.

### Główny przepływ

1. Otwieram Alfreda.
2. Wybieram projekt.
3. Uruchamiam albo wznawiam agenta.
4. Pracuję w pełnowymiarowym terminalu.
5. Przełączam projekt bez utraty stanu sesji.
6. Obsługuję realną decyzję w Inboxie.
7. Otwieram obserwatorium, gdy chcę sprawdzić historię lub stan agentów.

### Hierarchia produktu

1. **Terminal i aktywna praca.** Zawsze pierwszy priorytet.
2. **Projekt, sesja i szybkie przełączanie.** Muszą być dostępne bez szukania.
3. **Inbox.** Tylko sprawy wymagające decyzji lub recovery.
4. **Obserwatorium.** Pełnoprawna powierzchnia, lecz otwierana świadomie.
5. **Kontekst i diagnostyka.** Na żądanie.
6. **Rozszerzenia i nowe funkcje.** Dopiero po pierwszej używalnej wersji.

### Non-goals pierwszej wersji

- osobny klient webowy;
- zdalny dostęp przez przeglądarkę;
- kolejne powierzchnie nawigacyjne;
- nowe kategorie statusów bez aktualnego konsumenta runtime;
- szeroki redesign niezwiązany z zatwierdzonym przepływem;
- przepisywanie backendu, main/preload lub modelu danych bez nowego dowodu;
- rozbudowa funkcji tylko dlatego, że technicznie można ją dodać.

---

## 3. Co naprawdę powodowało frustrację

Frustracja nie wynika wyłącznie z nietrafionego stylu. Wynika z procesu, który produkował ukończone zmiany, ale nie prowadził do konwergencji produktu.

### 3.1. Dwa modele Alfreda żyły równolegle

W repo i interfejsie nadal współistnieją:

- webowe obserwatorium i dashboard systemowy;
- desktopowy cockpit do codziennej pracy z agentami.

Patryk wybrał drugi model jako główny. Obserwatorium zostaje funkcją Alfreda, ale nie definiuje już głównej powierzchni ani osobnego klienta pierwszej wersji.

### 3.2. Lokalne poprawki nie zmniejszały ciężaru całości

Kolejne loopy usuwały pojedyncze nagłówki, przenosiły kontrolki, spłaszczały karty i przepisywały Inbox. Jednocześnie pozostawały cztery kolumny, wiele ramek, podobna waga statusów i funkcji pobocznych oraz kilka równoległych ścieżek do tego samego zachowania.

Efekt: dużo pracy w diffie, mała zmiana odczuwalnej prostoty.

### 3.3. Powstało completion theater

Długie plany, odhaczone zadania, setki testów i smoke checki dawały mocne wrażenie ukończenia. Nie odpowiadały jednak na pytanie: „czy można spokojnie pracować w Alfredzie?”.

Najlepszy dowód to regresja terminala. Test dodany po błędzie sprawdza tekst CSS, a nie realną wysokość terminala. Może pozostać zielony po ponownym wprowadzeniu konfliktującej reguły.

### 3.4. Agenci dodawali widoczne dowody swojej pracy

W kolejnych iteracjach przybywały statusy, fallbacki, objaśnienia, kontrakty CSS, dodatkowe wejścia i warstwy bezpieczeństwa. Każdy element osobno bywa uzasadniony. Razem tworzą produkt, który nadmiernie pokazuje własną mechanikę.

### 3.5. Brakowało definicji końca

Nie było stałego kryterium „pierwsza finalna wersja jest gotowa”. Każdy loop mógł więc płynnie przejść w następny. Produkt rozszerzał się poziomo, zanim stał się miejscem normalnej pracy.

### 3.6. Dokumentacja kierowała agentów do poprzedniej architektury

README nadal opisuje repo jako `web-first refoundation`, pomija `apps/desktop` i wskazuje web observatory jako kolejny krok. Lokalny plan UI jawnie opiera się na `last-block-wins`. Agenci wykonywali technicznie spójne instrukcje, które nie odpowiadały już aktualnej wizji produktu.

### 3.7. Pętla używania była odwrócona

Alfred nie był jeszcze głównym miejscem pracy. Był oglądany i poprawiany z Codex App. Następne zmiany wynikały więc głównie z oglądania interfejsu, a nie z tarcia napotkanego podczas rzeczywistego kodowania.

### Wniosek procesowy

Nie jest potrzebny kolejny „redesign loop”. Potrzebna jest pętla konwergencji:

1. zamrozić nowe funkcje;
2. ustalić jeden runtime path;
3. oczyścić warstwę, która ten path renderuje;
4. zatwierdzić kierunek wizualny przed kodowaniem;
5. rozpocząć realny dogfooding;
6. poprawiać wyłącznie zaobserwowane tarcie.

---

## 4. Ocena stanu projektu

Projekt nie jest do wyrzucenia.

- Backend, Electron main/preload, runner, API i podstawowy model sesji nie wyglądają na wymagające przepisywania.
- React renderer jest messy, ale możliwy do uporządkowania bez pełnego rewrite’u.
- Największe nagromadzenie residue znajduje się w CSS, chrome aplikacji, Inboxie i równoległych ścieżkach UI.
- Problemem nie jest sama ilość kodu. Problemem jest brak pewności, która warstwa i które zachowanie są obecnie kanoniczne.
- Dalszy visual polish przed sanitation pass prawdopodobnie odtworzy poprzednią pętlę.

Nie znaleziono plagi generycznych komentarzy, promptowych nazw typu `Enhanced`/`Robust`/`Smart`, placeholderów ani `TODO/FIXME/HACK` w sprawdzanym diffie. Slop ma charakter strukturalny, nie leksykalny.

---

# Agent Sanity Review

## Scope

- **Reviewed:** `main...ui-onebar-inbox`, sąsiednie runtime paths, dokumentacja i konfiguracja repo.
- **Mode:** read-only report; bez zmian w plikach podczas audytu.
- **Languages/frameworks inferred:** TypeScript, React, Electron, Vite, Vitest/jsdom, xterm, plain CSS, pnpm/Turborepo; Hono, Drizzle, Postgres, SQLite i Zod poza rendererem.
- **Validation inspected:** skrypty root/package, Turbo, Vite/Vitest, TypeScript, README, AGENTS i lokalne plany.
- **Validation run:** `git diff --check`, status/diff/log, statyczne wyszukiwania, `pnpm list --depth 0`, `tsc --showConfig` i niedestrukcyjny proof testu CSS.
- **Limits:** bez pełnego test suite, builda, sieci, realnych danych `~/.codex` i świeżego Electron smoke.

## Executive summary

Nie znaleziono P0. Branch i projekt wymagają cleanupu przed dalszym redesignem. Największe ryzyka to half-wired akcje Inboxa, dwa rozjechane modele tej samej kolejki, testy layoutu nieużywające prawdziwego layout engine oraz CSS działający jako stos późnych override’ów.

**Severity:**

- **P0:** prawdopodobny runtime bug z utratą danych, security/privacy risk albo złamana ścieżka releasu.
- **P1:** mocne ryzyko runtime lub maintainability, broken integration albo test dający istotnie fałszywe poczucie bezpieczeństwa.
- **P2:** cleanup-worthy problem, podejrzana złożoność, duplikacja lub migration residue.
- **P3:** niski priorytet: naming, dokumentacja albo polish bez istotnego wpływu na core flow.

## Top findings

| ID | Severity | Category | Location | Finding | Suggested action | Confidence | Auto-fix safe? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | P1 | Half-wired code | `ReviewSurfaceItem` | `waiting` dostaje aktywny `Launch`, ale handler nie ma tej gałęzi | Wyczerpujący resolver akcji | high | no |
| F2 | P1 | Duplicate source of truth | `ReviewSurface` / `ReviewQueuePanel` | Dwa Inboxy mają różne zachowanie unsafe recovery | Jeden widok lub jeden model akcji | high | no |
| F3 | P1 | Test theater | `app.test.tsx` | Regresja wysokości terminala testuje regex CSS, nie layout | Electron/browser geometry test | high | no |
| F4 | P2 | Data correctness | `ReviewSurfaceItem` | Globalny Inbox ukrywa pełną nazwę workspace’u | Przywrócić jednoznaczną identyfikację | high | yes |
| F5 | P2 | Misleading diagnostics | `AgentTimelinePanel` | Activity i Show raw pracują na wcześniej obciętych 8 eventach | Limitować dopiero w panelu | high | yes, z testem |
| F6 | P2 | Dead paths | `isLaunchBlocked`, `handleApproveTile` | Soft-review staged sessions jest logicznie niemożliwy | Ustalić jeden model safety | high | no |
| F7 | P2 | Migration residue | `styles.css` | Last-block-wins pozostawia sprzeczne implementacje selektorów | Scalić reguły właścicielskie | high | no |
| F8 | P2 | Ghost implementation | `TerminalDesk` | Drugi zestaw Focus/Split/Grid nadal istnieje i jest domyślny | Usunąć albo jawnie wydzielić wariant | high | no |
| F9 | P2 | Layout correctness | Inbox CSS | Kolejka nie ma pewnego właściciela scrolla | Scroll na stosie sekcji | medium | no |
| F10 | P2 | Validation theater | package/Vitest config | `lint` to drugi `typecheck`; brak CI i browser tests | Niezależne bramki jakości | high | no |
| F11 | P2 | Documentation drift | `README.md` | README opisuje poprzedni produkt i pomija desktop | Przepisać architekturę i status | high | no |
| F12 | P2 | Dead CSS | `styles.css` | Legacy selektory są martwe, ale testy nadal je chronią | Selektorowy orphan sweep | high | warunkowo |
| F13 | P3 | Cascade bug | `.review-surface-waiting` | Nowe font/color przegrywają przez specyficzność | Doprecyzować selektor | high | yes |
| F14 | P1 | Lost runtime event | terminal main/preload/renderer boundary | Exit może wystąpić po `terminal.list()`, ale przed rejestracją niebuforowanego listenera renderera | Atomowe subscribe/reconcile z zachowaniem exit code i restored-session semantics | high | no |

## Detailed findings

### F1. Aktywny `Launch` dla `waiting` jest no-opem

- **Location:** `apps/desktop/src/renderer/workspace-attention.ts:25-33`, `apps/desktop/src/renderer/components/ReviewSurface.tsx:158-177,203-211,258-271`
- **Evidence:** `waiting` jest jawnie dodany do `ATTENTION_PRIORITY`. `reviewSurfaceAction()` zwraca fallback `Launch`, przycisk nie jest disabled, ale `runAction()` nie ma gałęzi `waiting`.
- **Why suspicious:** niewyczerpujący switch zamienia nieobsłużony stan w silną akcję produktową.
- **Why it matters:** główna akcja centrum decyzyjnego wygląda na działającą, ale kliknięcie nie robi nic.
- **Suggested fix:** jeden wyczerpujący resolver `{ label, disabled, execute }`; dla `waiting` akcja prowadząca do sesji albo brak primary action. Dodać test kliknięcia.
- **Safe to auto-fix:** nie; semantyka wymaga decyzji produktowej.
- **Origin:** problem istniał na `main`, ale pozostaje w przepisanej głównej powierzchni Inboxa.

### F2. Dwa globalne Inboxy mają różne state machine’y

- **Location:** `apps/desktop/src/renderer/app.tsx:2078-2090,2250-2262`, `ReviewQueuePanel.tsx:193-219,319-334`, `ReviewSurface.tsx:158-177`
- **Evidence:** oba widoki dostają te same `globalReviewItems` i callbacki. Modal nie pokazuje akcji dla `waiting` i zatrzymuje unsafe recovery przed focusem. `ReviewSurface` pokazuje `Launch`, a po unsafe restart/relaunch zawsze wywołuje focus. Pierwszy klik handlera recovery może jedynie uzbroić potwierdzenie.
- **Why suspicious:** osobne klasyfikatory, label resolvery i handlery dla tej samej domeny.
- **Why it matters:** zachowanie zależy od wejścia przez rail albo command palette; UI może zasugerować restart bez uruchomienia procesu.
- **Suggested fix:** uczynić nowy Inbox jedynym widokiem, a command palette powinna go otwierać; alternatywnie współdzielić jeden resolver/state machine.
- **Safe to auto-fix:** nie.

### F3. Test regresji terminala nie sprawdza terminala

- **Location:** `apps/desktop/src/renderer/app.test.tsx:1137-1147`, `apps/desktop/vite.config.ts:9-11`
- **Evidence:** test działa w jsdom i sprawdza klasę, brak headera oraz regex w surowym CSS. Proof pokazał, że po dopisaniu późniejszej konfliktującej reguły regex nadal przechodzi.
- **Why suspicious:** test zatwierdza obecność deklaracji, nie efektywną wartość ani geometrię.
- **Why it matters:** dokładnie ten błąd ograniczył już terminal do jednego wiersza i może wrócić przy zielonym teście.
- **Suggested fix:** mały Electron/browser test mierzący stage, body i xterm host oraz sprawdzający focus.
- **Safe to auto-fix:** nie; potrzebny harness.
- **Origin:** test został dodany na branchu w commicie `a507fc3` razem z poprawką.

### F4. Globalny Inbox utracił jednoznaczną tożsamość projektu

- **Location:** `ReviewSurface.tsx:179-218`, `shared/workspace-label.ts:1-4`, `ReviewSurface.test.tsx:102-125`
- **Evidence:** widoczny `workspaceLabel` został usunięty. Został trzyznakowy skrót bez gwarancji unikalności, a pełna nazwa siedzi tylko w `title`. Discard nie ma workspace’u w aria-label. Test wymaga braku nazwy projektu w metadanych.
- **Why suspicious:** estetyczny cleanup usunął discriminator z globalnej kolejki.
- **Why it matters:** podobnie nazwane sesje mogą być wizualnie i dostępnościowo nierozróżnialne przy destrukcyjnej akcji.
- **Suggested fix:** widoczna pełna nazwa albo gwarantowany unikalny label; workspace w etykietach wszystkich akcji.
- **Safe to auto-fix:** tak.
- **Origin:** regresja brancha.

### F5. `Show raw` może nie pokazać deklarowanych raw eventów

- **Location:** `AgentTimelinePanel.tsx:73-80,203-219,402-430`, `activity-presentation.ts:11-32`
- **Evidence:** `presentActivityEvents()` najpierw obcina wynik do 8. Panel dopiero później stosuje preview limit 4. Przy 8 nowszych non-raw eventach przycisk może pokazać `Show raw (N)`, lecz raw mode nadal zwróci pierwsze 8 bez raw eventów.
- **Why suspicious:** dwa limity nakładają się, a liczniki opisują różne zbiory.
- **Why it matters:** panel diagnostyczny ukrywa dane, które użytkownik próbuje odsłonić.
- **Suggested fix:** przekazać `limit: activityEvents.length`; preview slicing wykonywać tylko w panelu. Bufor i tak ma limit 40.
- **Safe to auto-fix:** tak, z testem ponad 8 mieszanych eventów.

### F6. Flow `unsafe staged` jest logicznie martwy

- **Location:** `session-state.ts:401-408`, `app.tsx:255-260,1351-1372`, `ReviewSurface.tsx:148-166`
- **Evidence:** `isLaunchBlocked` zwraca true dla każdego `safetyNote`. Warunek `safetyNote && !isLaunchBlocked(s)` jest niemożliwy. Drugi `if (tile?.safetyNote)` w `handleApproveTile` jest nieosiągalny. Status `blocked` powoduje disabled/early return przed arm/approve.
- **Why suspicious:** UI, liczniki i `armedUnsafeSessionIds` sugerują workflow, którego staged runtime nie może wykonać.
- **Why it matters:** kod produkuje martwe stany i zaciemnia prawdziwy model bezpieczeństwa.
- **Suggested fix:** zdecydować, czy `safetyNote` jest hard blockiem z Edit, czy soft warningiem z prawdziwym confirm.
- **Safe to auto-fix:** nie.

### F7. Arkusz działa jako stos późnych override’ów

- **Location:** `styles.css:224,5402,7350,8408,9786`, `styles-contract.test.ts:16-47,330-403`
- **Evidence:** arkusz ma 10 013 linii i pięć bloków `.mission-bar`: grid, warstwę wyglądu, `height: 0`, `height: 52px` oraz końcowy flex. `.inbox-section > header` jest wcześniej gridem, a na końcu flexem. `blockFor()` sprawdza tylko ostatni blok. Lokalny plan jawnie narzucał `last-block-wins`.
- **Why suspicious:** branch wykonał realny cleanup (`-490/+231` CSS), ale finalny komponent nadal nie ma jednej czytelnej definicji.
- **Why it matters:** wynik zależy od specyficzności i deklaracji z odległych warstw. Regresja terminala jest konkretnym skutkiem tego modelu.
- **Suggested fix:** etapami scalić reguły zmienionych komponentów; kontrakty powinny sprawdzać unikalność albo computed styles.
- **Safe to auto-fix:** nie.

### F8. Stary zestaw Focus/Split/Grid pozostaje domyślną ścieżką

- **Location:** `WorkbenchHeader.tsx:64-79`, `TerminalDesk.tsx:49,92,143,273-314`, `app.tsx:2074`
- **Evidence:** nowy header renderuje Focus/Split/Grid/Arrange. `TerminalDesk` nadal ma drugi zestaw i domyślne `showHeaderControls = true`; App wyłącza go jednym propem. Kontrakt CSS wymaga braku `.work-mode-control` w arkuszu.
- **Why suspicious:** stara ścieżka pozostała domyślna, ale nie ma już stylowania.
- **Why it matters:** nowy caller albo zgubiony prop przywróci nieostylowany header i zdublowane sterowanie.
- **Suggested fix:** usunąć `showHeaderControls` i zostawić lokalny header wyłącznie dla Arrange albo nazwać wariant jawnie.
- **Safe to auto-fix:** nie; najpierw potwierdzić brak standalone use case.

### F9. Inbox nie ma pewnego właściciela scrolla

- **Location:** `styles.css:6574-6577,6618-6627,7661-7667,8200-8203`
- **Evidence:** `.review-surface` ma ograniczony drugi track i `overflow: hidden`. `.inbox-section-stack` używa `max-content`, ale nie ma `overflow` ani `min-height: 0`. Wewnętrzne listy mają `overflow: auto`, lecz nie mają ograniczonej wysokości.
- **Why suspicious:** scrollbar jest stylowany, ale geometria nie daje mu pewnego scroll-containera.
- **Why it matters:** przy długiej kolejce dolne sekcje mogą zostać obcięte.
- **Suggested fix:** jeden scroll owner na `.inbox-section-stack`; potwierdzić browser testem `scrollHeight > clientHeight`.
- **Safe to auto-fix:** nie; potrzebna walidacja w prawdziwym layout engine.

### F10. Walidacja wygląda na wielowarstwową, ale bramki nie są niezależne

- **Location:** root `package.json:20-25`, `apps/desktop/package.json:7-14`, `vite.config.ts:9-11`, `tsconfig.base.json:1-15`
- **Evidence:** we wszystkich siedmiu pakietach `lint` jest identyczny z `typecheck`. Brak ESLint/stylelint i CI workflows. Vitest działa wyłącznie w jsdom. CSS contract suite ma 699 linii i bazuje głównie na regexach.
- **Why suspicious:** `test + lint + typecheck + build` wygląda jak kilka barier, choć część jest duplikatem, a layout nie jest testowany.
- **Why it matters:** liczba green checks nie odpowiada ryzyku Electron/CSS.
- **Suggested fix:** minimalne CI, prawdziwy lint, kilka Electron/browser smoke tests i jeden udokumentowany release gate.
- **Safe to auto-fix:** nie.

### F11. README opisuje poprzedni produkt

- **Location:** `README.md:3-70,340-355`
- **Evidence:** README nazywa repo `web-first refoundation`, architektura pomija `apps/desktop`, ostatnia walidacja wskazuje `web-observatory`, a Current Next Step nadal dotyczy web observatory.
- **Why suspicious:** dokument wejściowy prowadzi agentów do nieaktualnego modelu systemu.
- **Why it matters:** kolejne sesje mogą tworzyć poprawnie wyglądające zmiany w niewłaściwej architekturze.
- **Suggested fix:** opisać Electron jako główny produkt oraz aktualne granice main/preload/renderer i workspace/session.
- **Safe to auto-fix:** nie; wymaga prawdy produktowej. Prawda produktowa jest zdefiniowana w tym dokumencie.

### F12. Legacy CSS jest martwy, lecz kontrakty nadal go chronią

- **Location:** `styles.css`, `styles-contract.test.ts:231-242,504-513,591-595`
- **Evidence:** arkusz zawiera 42 użycia `.mission-actions`, 20 `.context-toggle-button` i `.agent-launch-buttons`. Produkcyjny TS/TSX nie emituje tych klas; aktualny DOM używa `.workbench-actions`, `.workbench-panel-group` i `.workbench-launch-group`. Testy nadal wyszukują legacy grupy.
- **Why suspicious:** testy utrudniają usunięcie kodu, którego runtime nie używa.
- **Why it matters:** rośnie szum arkusza i ryzyko pomylenia aktywnej warstwy z historyczną.
- **Suggested fix:** selector-aware orphan sweep, potem uproszczenie kontraktów.
- **Safe to auto-fix:** warunkowo; po analizie selektorów, nie masowym regexowym usunięciem.

### F13. Nowa reguła licznika Inbox jest częściowo martwa

- **Location:** `styles.css:9767-9777,9925-9930`
- **Evidence:** wcześniejsze `.review-surface-header span` ma większą specyficzność niż późniejsze `.review-surface-waiting`. Jego `font` shorthand i `color` wygrywają, więc nowe `font-size` i `color` nie działają.
- **Why suspicious:** finalna klasa wygląda jak źródło prawdy, ale jej główne deklaracje są bez efektu.
- **Why it matters:** runtime nie odpowiada intencji zapisanej w diffie.
- **Suggested fix:** `.review-surface-header .review-surface-waiting` albo usunięcie generycznego `span` z wcześniejszej grupy.
- **Safe to auto-fix:** tak.

### F14. Wczesny terminal exit może zniknąć między listą i subskrypcją

- **Status:** resolved in Phase Z at `1fc9d2e`.
- **Location:** `src/main/terminal-manager.ts` (`list`, `snapshot`, `pty.onExit`), `src/main/preload.cts` (`terminal.onExit`), `src/renderer/components/TerminalDesk.tsx` (listener i snapshot handshake).
- **Evidence:** preload przekazuje jednorazowy `ipcRenderer.on` bez bufora. Main usuwa live session przed wysłaniem exit. Jeśli proces kończy się po odpowiedzi `terminal.list()`, lecz przed efektem `TerminalDesk` rejestrującym listener, zdarzenie przepada; późniejszy `snapshot()` zwraca `null` i nie rekoncyliuje kafla do exited/error. Flaky test ujawnił to samo okno na niebuforowanym zestawie listenerów; jego precondition poprawnie stabilizuje test dostarczenia eventu, ale nie naprawia produktu.
- **Why suspicious:** renderer pokazuje live tile przed ustanowieniem kanału, który jest jedynym źródłem exit code.
- **Why it matters:** krótkotrwały proces może pozostać wizualnie aktywny albo nie ogłosić statusu, mimo że main już go zakończył.
- **Suggested fix:** zaprojektować atomowe subscribe-then-list albo subscribe/reconcile API, które po rejestracji zwraca aktualny stan i exit metadata; zachować restored-session oraz buffer semantics.
- **Safe to auto-fix:** nie; wymaga osobnego speca lifecycle i testu kontrolowanego okna czasowego.

## Dodatkowe obserwacje do rewalidacji

Poniższe rzeczy są podejrzane, ale nie mają jeszcze wystarczającego dowodu, aby automatycznie stać się findingiem do usunięcia:

- możliwość zduplikowanych external Codex session IDs i React keys;
- lokalne, zdublowane aliasy `WorkMode` i `PrimarySurface`;
- markup-only testy `ReviewSurface`, które nie klikają callbacków;
- brak pełnego testu odwrotnego stanu Arrange layoutu;
- brak wersji Node i szerokie użycie zależności `latest`;
- przygotowane, lecz niewłączone edytowanie staged Codex/Claude sessions;
- generyczne `missing` po błędach copy/open/reveal.

## Suspicious but probably keep

- **xterm keep-alive:** uzasadniona złożoność. Chroni bufor, instancję terminala i przełączanie Split/Grid/projektów.
- **`workspaceSwitcher: ReactNode`:** pozwala przenieść działający popover bez kopiowania jego stanu.
- **`.terminal-stage.headerless`:** jest aktywnie używana; Arrange świadomie zachowuje lokalny header.
- **Dokładne testy ARIA i copy:** zachować, gdy reprezentują prawdziwy kontrakt dostępności.
- **Worktree compatibility paths:** nie usuwać bez dowodu, że persisted-state i safety scenarios są martwe.
- **Zależności `latest`:** lockfile częściowo stabilizuje instalacje; nie wykonywać mechanicznego masowego pinowania.
- **Brak dedupe external sessions:** nie usuwać transkryptów bez reguły wyboru kanonicznego źródła.

---

## 5. Obserwatorium i `apps/web`

### Decyzja

Obserwatorium zostaje. Osobny frontend `apps/web` nie jest obserwatorium samym w sobie; jest tylko nieużywanym kanałem dostarczenia.

Do pierwszej wersji:

- Electron jest jedynym klientem użytkowym.
- Obserwatorium działa w Electronie.
- Zdalny dostęp przez przeglądarkę jest świadomie odłożony poza pierwszą wersję.
- `apps/web` zostanie usunięte po audycie zależności i wdrożeń.
- Nie powstanie `apps/web-legacy`; Git jest archiwum.
- `apps/api`, runner, schema, db i adaptery zostają, o ile audyt zależności nie wykaże, że konkretny element jest zbędny.

### Bramka usunięcia `apps/web`

Przed przygotowaniem diffu usuwającego aplikację należy potwierdzić:

1. brak aktywnego użytkownika i potrzebnego deploymentu webowego;
2. brak importów Electrona, API, runnera i pakietów z `apps/web`;
3. wpływ na root scripts, Turbo, lockfile, Vercel i dokumentację;
4. pełny zakres należących wyłącznie do weba testów i konfiguracji;
5. działanie Electron/API/runner po usunięciu.

Jeśli kiedyś wróci potrzeba remote web access, będzie to nowe przedsięwzięcie oparte na stabilnych kontraktach, a nie powód do utrzymywania obecnego frontendu.

---

## 6. Rejestr decyzji

### Locked

| Data | Decyzja | Uzasadnienie |
| --- | --- | --- |
| 2026-07-10 | Electron jest główną aplikacją | To w nim odbywa się realna praca z agentami |
| 2026-07-10 | Terminal jest główną powierzchnią | Alfred ma być miejscem pracy, nie panelem administracyjnym |
| 2026-07-10 | Szybkie przełączanie projektów jest wymaganiem podstawowym | Patryk koduje kilka projektów równolegle |
| 2026-07-10 | Obserwatorium zostaje | Jest potrzebną funkcją produktu |
| 2026-07-10 | Osobny web client jest poza pierwszą wersją | Nie jest używany i rozmywa tożsamość produktu |
| 2026-07-10 | `apps/web` ma zostać wycofane po audycie zależności | Usuwamy kanał, nie obserwatorium |
| 2026-07-10 | Nowe funkcje są zamrożone do gate’u pierwszej wersji | Najpierw konwergencja i dogfooding |
| 2026-07-10 | xterm keep-alive pozostaje twardym invariantem | Stan terminala nie może ginąć przy zmianie layoutu/projektu |
| 2026-07-10 | Nie wykonujemy pełnego rewrite’u | Brak dowodu, że core tego wymaga |
| 2026-07-10 | Nie zaczynamy kolejnego visual loopu przed sanitation | Obecna kaskada i duplikaty uniemożliwiają przewidywalne zmiany |

### Decyzje kontrolowane przez bramki

- **Obecny branch:** `ui-onebar-inbox` nie może zostać mergowany ani rozwijany w kolejny redesign przed naprawą P1 i realnym Electron smoke. Po bramce otrzyma decyzję `merge` albo `drop`; nie pozostaje długowieczną warstwą pośrednią.
- **Dokładny layout obserwatorium:** zostanie zatwierdzony w statycznym visual contract. Nie jest ustalany podczas cleanupu runtime.
- **Odblokowanie nowych funkcji:** dopiero po dogfoodingu i release gate pierwszej wersji.
- **Push/PR:** każdorazowo zgodnie z bieżącą zgodą Patryka. Ten dokument nie daje automatycznego pozwolenia.

### Świadomie odłożone

- zdalny klient webowy;
- mobilny monitoring;
- nowe funkcje obserwatorium wykraczające poza historię i stan agentów potrzebny do pracy;
- szeroki design-system rewrite;
- masowe przepisywanie dużych plików tylko w celu poprawy estetyki kodu.

### Odrzucone podejścia

- utrzymywanie `apps/web` „na wszelki wypadek” bez aktualnego użytkownika;
- pełny rewrite projektu jako odpowiedź na problemy renderera;
- dokładanie kolejnej końcowej warstwy CSS zamiast usuwania zastępowanej reguły;
- równoległe implementowanie kilku wariantów finalnego UI w kodzie produkcyjnym;
- traktowanie liczby testów albo długości planu jako dowodu jakości produktu;
- zaczynanie nowej funkcji przed przejściem dogfooding i release gate.

---

## 7. Roadmap A-Z

To jest program, nie jeden implementation plan. Każda faza kończy się działającym, testowalnym rezultatem i osobnym review. Nie wolno rozpoczynać następnej fazy przed przejściem bramki.

Przed rozpoczęciem fazy powstaje osobny plan wykonawczy zawierający:

- dowód wejścia i aktualny stan brancha;
- dokładny zakres oraz pliki należące do zadania;
- małe kroki z osobnym cyklem test–implementacja–review;
- konkretne komendy walidacyjne i oczekiwany rezultat;
- bezpieczny sposób wycofania zmiany bez tworzenia stałej compatibility layer;
- granice commitów i PR;
- bramkę wyjścia przepisaną z tego dokumentu.

Jeden plan wykonawczy i jeden PR obejmują jeden subsystem lub jedną spójną zmianę zachowania. Jeżeli reviewer może sensownie zaakceptować połowę i odrzucić połowę, zakres należy rozdzielić przed implementacją.

### Mapa odpowiedzialności i głównych plików

Ta mapa wyznacza granice przyszłych małych planów. Nie upoważnia do szerokiego refaktoru całych plików.

| Obszar | Główne pliki | Odpowiedzialność |
| --- | --- | --- |
| Orkiestracja renderera | `apps/desktop/src/renderer/app.tsx` | Składanie powierzchni, stan globalny, handlery i nawigacja |
| Top bar i nawigacja | `components/WorkbenchHeader.tsx`, `components/PrimaryNavigationRail.tsx`, workspace navigation w `app.tsx` | Jedno wejście do Work, Inbox, obserwatorium i projektów |
| Terminal | `components/TerminalDesk.tsx`, `terminal-desk-types.ts`, terminal IPC | Layout, xterm keep-alive, Focus/Split/Grid/Arrange |
| Inbox | `workspace-attention.ts`, `components/ReviewSurface.tsx`, `components/ReviewQueuePanel.tsx` | Selekcja elementów, grupowanie, label i akcja |
| Safety/recovery | `session-state.ts`, `relaunch-safety.ts`, `restored-session-action.ts`, handlery w `app.tsx` | Hard block, confirm, restart i relaunch |
| Activity/context | `activity-presentation.ts`, `components/AgentTimelinePanel.tsx`, session activity w `session-state.ts` | Filtrowanie, liczenie i prezentacja zdarzeń |
| Sessions — legacy runtime nadal nazwany Observatory do Slice 4 | `components/ObservatorySurface.tsx`, `main/session-index-ipc.ts`, shared session index IPC | Obecna lista metadanych managed/external sessions; Slice 4 zastępuje ją wyszukiwarką i czytnikiem Sessions bez compatibility UI |
| Styling/layout | `styles.css`, `styles-contract.test.ts` | Kanoniczne reguły, scroll ownership, responsive states |
| Test harness | `vite.config.ts`, `app.test.tsx`, testy komponentów, package scripts | jsdom, Electron/browser geometry, release gate |
| Zakończony web decommission | Git history, deploy config, `README.md` | Dowód usunięcia nieużywanego klienta bez naruszenia zachowanej infrastruktury |
| Źródło prawdy | ten dokument, następnie `README.md` | Charter, decyzje, fazy i rzeczywista architektura |

### Tracker

| Faza | Cel | Status |
| --- | --- | --- |
| A | Zamrożenie kierunku i dokument kanoniczny | complete — zaakceptowane 2026-07-10 |
| B | Rozstrzygnięcie `ui-onebar-inbox` | complete — merged and pushed at `3e5362f` |
| C | Jeden czysty baseline na `main` | complete — clean baseline at `3e5362f` |
| D | Decommission osobnego klienta i aktualizacja architektury | complete — merged and pushed to `main` at `72b828c` |
| E | Wiarygodna bramka jakości | complete — merged via PR #46 at `24fac82`; hydration test hotfix merged via PR #47 at `0a3e188` |
| F | Konwergencja zachowania i usunięcie duplikatów | complete — merged and pushed to `main` at `c8aec57` |
| G | Sanitation CSS i własność layoutu | complete — merged at `3bb2e66`, full merged-main gate PASS; subsequently published on `main` |
| H | Zatwierdzenie finalnego kierunku wizualnego | complete — corrected contract reapproved 2026-07-13; final frames and manifest verified |
| I | Implementacja wyglądu w zamkniętych przekrojach | complete — Slice 0–5 published; final post-push gate PASS at `728c4f8` |
| J | J0 Visual Alignment, następnie obowiązkowy dogfooding | complete — published at `3242fc7`; accepted glass calibration published at `3544486` |
| Z | Stabilizacja i pierwsza używalna wersja | complete — accepted and published at `2a020a0`; CI `30432394289` PASS |

### Faza A — Zamrożenie kierunku

**Cel:** zatrzymać losowe iteracje.

**Zakres:**

- zaakceptować ten dokument jako źródło prawdy;
- zamrozić nowe funkcje;
- oznaczyć wcześniejsze lokalne plany UI jako historyczne, nieaktywne;
- utrzymać jedną listę findings i decyzji;
- zakazać równoległych branchy zmieniających główny shell.

**Brama wyjścia:**

- Patryk akceptuje charter, locked decisions i kolejność faz;
- nie istnieje drugi aktywny plan produktu;
- każde F1-F13 ma przypisaną fazę;
- nowe pomysły trafiają do backlogu po pierwszej wersji.

### Faza B — Rozstrzygnięcie `ui-onebar-inbox`

**Cel:** nie budować kolejnych warstw na niepewnym branchu.

**Zakres wymagany przed decyzją merge/drop:**

- naprawić F1: `waiting` nie może mieć aktywnego no-opa;
- naprawić unsafe restart/relaunch z F2;
- zapewnić jeden model akcji Inboxa, nawet jeśli drugi widok zostanie fizycznie usunięty dopiero w Fazie F;
- naprawić F4: globalny Inbox jednoznacznie pokazuje projekt;
- naprawić F5: Activity/Show raw nie obcina danych wprowadzająco w błąd;
- naprawić F13;
- potwierdzić terminal geometry w Electronie, nie regexem;
- potwierdzić xterm keep-alive i bufor przy Focus/Split/Grid oraz przełączaniu powierzchni;
- potwierdzić scroll długiej kolejki albo jawnie przenieść F9 do blokującej części Fazy G.

**Walidacja:**

- targeted interaction tests dla Inboxa i timeline;
- pełny desktop test suite serializowany;
- desktop typecheck i build;
- realny Electron smoke bez błędów konsoli;
- geometria terminala i Inboxa zmierzona w runtime;
- `git diff --check`.

**Brama wyjścia:**

- zero P1 w core flow;
- Patryk akceptuje one-bar jako strukturalny baseline, nie jako finalny design;
- branch dostaje decyzję `merge` albo `drop`;
- branch nie przyjmuje decommissioningu weba ani nowego redesignu.

### Faza C — Jeden czysty baseline

**Cel:** ustanowić pojedynczy punkt startowy.

**Zakres:**

- zmergować tylko branch, który przeszedł Fazę B, albo zachować z niego wyłącznie jawnie wskazane zmiany;
- uruchomić pełną walidację zbliżoną do release;
- wykonać screenshoty bazowe Work, Inbox, Observatory, Context, Split i narrow state;
- zapisać odłożone P2 wraz z fazą docelową;
- zakończyć stacked UI branches.

**Brama wyjścia:**

- `main` jest jedynym punktem startowym;
- worktree jest czysty;
- baseline screenshotów i wyników walidacji jest zapisany;
- nie ma ukrytego „jeszcze jednego” brancha z równoległym shellem.

### Faza D — Decommission `apps/web`

**Cel:** usunąć konkurencyjną tożsamość produktu.

**Zakres:**

- przeprowadzić dependency/deployment audit opisany w sekcji 5;
- usunąć `apps/web` oraz wyłącznie należące do niego testy, skrypty i konfiguracje;
- zachować API, runner, schema, db i adaptery;
- usunąć martwe referencje z workspace, Turbo, deployu i lockfile;
- przepisać README wokół produktu desktopowego;
- opisać granice Electron main/preload/renderer oraz rolę obserwatorium.

**Zakazy:**

- bez redesignu desktopu w tym samym diffie;
- bez `apps/web-legacy`;
- bez compatibility layer na wszelki wypadek;
- bez usuwania infrastruktury tylko dlatego, że była opisana obok weba.

**Brama wyjścia:**

- Electron, API i runner przechodzą testy, typecheck i build;
- repo nie ma runtime ani dokumentacyjnych referencji do `apps/web`;
- README opisuje faktyczny produkt;
- Git pozostaje jedynym archiwum usuniętej aplikacji.

### Faza E — Wiarygodna bramka jakości

**Cel:** sprawić, żeby `green` oznaczało działający produkt.

**Zakres:**

- wprowadzić prawdziwy lint zamiast drugiej nazwy dla typechecku;
- dodać minimalne CI dla test/typecheck/lint/build;
- dodać mały Electron/browser suite dla geometrii i zachowania;
- zastąpić krytyczne regexowe kontrakty zachowaniem albo computed styles;
- utrzymać deterministyczne fixtures zamiast realnych `~/.codex`;
- udokumentować jeden release gate.

**Krytyczne scenariusze:**

- pełna wysokość terminala;
- zachowanie xterm node identity i bufora;
- przełączenie projektu;
- rzeczywista akcja Inboxa;
- scroll długiej kolejki;
- wejście i wyjście z obserwatorium;
- brak duplicate key warnings i błędów konsoli.

**Brama wyjścia:** regresja terminala, no-op Inboxa albo obcięty layout nie mogą przejść jako green.

### Faza F — Konwergencja zachowania

**Cel:** jedna implementacja każdego kluczowego pojęcia. Bez redesignu.

**Zakres:**

- usunąć jeden z globalnych Inboxów albo sprowadzić oba do jednego komponentu/modelu;
- command palette ma otwierać kanoniczną powierzchnię;
- ustalić jeden model safety: hard block albo reviewable confirm;
- usunąć niemożliwe liczniki i arm paths z F6;
- usunąć drugi zestaw Focus/Split/Grid z F8;
- potwierdzić jednoznaczną identyfikację projektu i sesji;
- objąć interaction tests każdą widoczną akcję;
- rozstrzygnąć dodatkowe obserwacje tylko po runtime proof.

**Brama wyjścia:**

- każdy widoczny przycisk ma osiągalne, przetestowane zachowanie;
- nie ma dwóch osiągalnych widoków tej samej globalnej kolejki;
- nie ma statusów ani liczników opisujących niemożliwe stany;
- podstawowy flow nie zależy od fallbacku lub komentarza.

### Faza G — Sanitation CSS i własność layoutu

**Cel:** uzyskać przewidywalną podstawę przed finalnym wyglądem.

To nie jest redesign. Obraz powinien pozostać możliwie stabilny przy usuwaniu konfliktujących źródeł prawdy.

**Powierzchnie objęte sanitation:**

1. desktop frame i top bar;
2. project/workspace navigation;
3. orchestrator surface i terminal stage;
4. context panel;
5. Inbox;
6. composer;
7. obserwatorium.

**Zasady:**

- jeden właścicielski blok stylów na komponent;
- jeden właściciel scrolla na region;
- responsive i state overrides blisko bazowej reguły;
- brak nowych końcowych bloków `v12`, `final` albo `last wins`;
- orphan selectors usuwane tylko po dowodzie;
- kontrakty nie chronią selektorów bez runtime consumerów;
- bez hurtowego formatowania i przepisywania całego arkusza;
- każdy krok zachowuje baseline screenshotów i geometrii.

**Brama wyjścia:**

- core shell nie zależy od kilku historycznych definicji tego samego selektora;
- każdy region ma jawnego właściciela scrolla;
- F7, F9 i F12 są zamknięte albo odłożone z dowodem;
- zmiana wysokości terminala nie wymaga zgadywania kolejności kaskady;
- testy geometrii i screenshot baseline przechodzą.

**Zatwierdzony design 2026-07-11:**

- zero celowych zmian wizualnych; polish należy do Fazy H;
- świeży baseline aktualnego `main` dla Work/Grid, Focus, Split, Arrange, Inbox, Observatory, Context i narrow;
- sekwencyjne owner slices w istniejącym `styles.css`, z jednym edytorem pliku naraz;
- najpierw frame/chrome/navigation, potem terminal/Context/composer, następnie Inbox/Observatory/overlays, na końcu evidence-based orphan sweep;
- porównanie screenshotów, geometrii i computed styles po każdym slice;
- brak celu redukcji linii i brak migracji do CSS Modules lub wielu plików;
- F12 usuwany wyłącznie po static, dynamic, Electron oraz test/fixture proof;
- wykonawczy spec i plan zostały zrealizowane, rozliczone w `.superpowers/sdd/task-6-report.md` i usunięte z aktywnych lokalnych planów.

**Closeout 2026-07-12:**

- F7 resolved: kanoniczne top-level i responsive owner regions mają occurrence/region contracts bez core last-match semantics;
- F9 resolved: `.inbox-section-stack` jest jednym scroll ownerem i przechodzi realny long-queue Electron flow;
- F12 resolved dla udowodnionego zbioru: 11 sierot usunięto po czterech dowodach, 74 niepewne selektory zachowano z nazwaną brakującą przesłanką;
- zero intentional visual change potwierdzone provenance-locked base/final extended evidence dla 11 stanów; JSON byte-identical SHA `5038f9dd93894f452c870ae039790c0e100046c1968bfacbc3fc5dd98e9c3fd1`;
- final `pnpm verify` PASS: 857/857 testów, Electron 4/4, build PASS; strict DPR2 PASS;
- whole-branch review: Ready, bez Critical/Important/Minor;
- F14 dodany jako osobny pre-existing lifecycle follow-up; nie blokuje zamkniętej Fazy G.

### Faza H — Zatwierdzenie finalnego kierunku wizualnego

**Cel:** zaakceptować wynik przed kolejnym kodowaniem UI.

**Wymagane stany referencyjne:**

- normalna praca w terminalu;
- szybkie przełączanie projektu;
- Inbox z realną decyzją;
- obserwatorium;
- Split;
- narrow state.

**Kontrakt hierarchii:**

- terminal dominuje;
- projekt i agent są szybko dostępne;
- Inbox pokazuje tylko decyzje;
- obserwatorium jest osobną powierzchnią, nie stale otaczającym dashboardem;
- kontekst i diagnostyka są na żądanie;
- status techniczny jest widoczny tylko wtedy, gdy pomaga podjąć decyzję;
- interfejs nie objaśnia stale własnej mechaniki.

**Proces:**

- przygotować 2-3 statyczne podejścia, nie trzy działające implementacje;
- wybrać jeden kierunek;
- zapisać kontrakt wizualny i konkretne kryteria geometrii;
- uzyskać akceptację Patryka przed zmianą kodu.

**Korekta po audycie 2026-07-13:** kierunek wizualny pozostaje wybrany, ale handoff nie spełniał jeszcze bramy wykonawczej. Skorygowany spec:

- ustanawia jeden kanoniczny `AttentionProjection` zamiast obiecywać niezawodne pytania/approval z surowego PTY;
- dodaje Slice 0 dla prawdziwego xterm keep-alive między projektami oraz bezpiecznej projekcji tailu;
- zastępuje nieaktualną tabelę v2 pełną destination map istniejących funkcji;
- dodaje kontrast, fokus, recovery safety i narrow stress states;
- degraduje v1/v2 do artefaktów historycznych i wymaga lokalnego manifestu integralności;
- utrzymuje Fazę I jako `not started` do review Claude'a i ponownej akceptacji Patryka.

**Brama wyjścia:** jeden zatwierdzony zestaw referencyjnych ekranów, jeden kontrakt wizualny i jedna hierarchia informacji, bez sprzeczności z realnymi runtime paths. Aktualnie: **complete**.

### Faza I — Implementacja wyglądu w zamkniętych przekrojach

**Cel:** zrealizować zatwierdzony kierunek bez ponownego rozlewania zakresu.

**Stan:** **complete — Slice 0–5 published; final post-push gate PASS at `728c4f8`.** Slice 0 został zaakceptowany na `137f2d3`, Slice 1 na `9262b65`, Slice 1.1 scalony przez PR #48 do `main` w `d5b3d31`, Slice 2 opublikowany fast-forwardem w `d314b16`, a Slice 3 wraz z hotfixem narrow terminal actions scalony przez PR #49 i #50 w `53abdab` oraz `a463d28`. Slice 4 wraz z post-push test hotfixem jest na `main` w `02447bb`. Slice 5 przeszedł pełny lokalny gate, bezpośrednią obserwację 1120×720, ponowny `pnpm verify` po fast-forwardzie i końcowy GitHub Actions run `29916883083`; następna jest Faza J.

**Korekta produktu 2026-07-20:** wcześniejsze dokumenty używały `Observatory` jako nazwy historii sesji. Nowsza, jawna decyzja rozdziela te pojęcia: **Sessions** służy wyszukiwaniu, czytaniu i ponownemu otwieraniu pracy, natomiast **Observatory** zostaje nazwą przyszłej powierzchni graficznej i analitycznej dla stanu agentów, relacji, tokenów i trendów. Historyczne wzmianki w zamkniętych specach i dowodach nie są przepisywane; ten dokument oraz spec Slice 4 mają pierwszeństwo dla dalszej implementacji. Właściwe Observatory nie należy do Fazy I ani pierwszej stabilnej wersji i wymaga po Fazie Z osobnego convergence/spec.

**Checkpoint Slice 0 — runtime foundations:**

- jeden długowieczny `TerminalDesk` zachowuje dokładnie ten sam węzeł `.xterm-screen` podczas A → B → A, a ukryte workspace'y pozostają podłączone, nieinteraktywne i odbierają dane w tle;
- `TerminalTailProjection` czyta przetworzony `terminal.buffer.active`, publikuje maksymalnie osiem niepustych linii i nie dodaje pollingu, drugiego emulatora ani persystencji;
- proces main jest jedynym klasyfikatorem surowych chunków PTY, zachowuje niedokończone linie i materializuje stabilne `SessionActivityEvent` używane bez ponownego tworzenia przez IPC, renderer i snapshoty;
- review wykrył i zamknął dwa realne błędy kontraktu: podwójną tożsamość live/snapshot oraz kolizję ID po limicie 40 zdarzeń; sekwencja jest teraz monotoniczna względem zachowanego ogona;
- finalny focused gate: 252/252; pełne `pnpm verify`: 870/870 testów poza Electronem i Electron 4/4; niezależny final review: Ready to merge YES, bez Critical/Important/Minor;
- Slice 0 nie implementuje wizualnego shella, `AttentionProjection`, Inboxa ani `failed`; F14 pozostaje osobnym późniejszym lifecycle workiem.

**Checkpoint Slice 1 — shell i terminal:**

- top chrome ma kanoniczne 40 px w stanie compact i 74 px z drugim rzędem 34 px; Focus ma jedną reprezentację sesji bez tile headera, a Split/Grid zachowują 30-px headery kafli;
- usunięto stary primary rail, stały composer oraz nieużywany Session Observatory; Prepare Work i istniejące miejsca docelowe są osiągalne z zamrożonego chrome;
- shell i terminal używają płaskiego achromatycznego materiału, zatwierdzonej skali `--ink-*`, jednego sygnału waiting oraz technicznego stosu mono; terminal zachowuje własną paletę ANSI;
- finalny sanity sweep usunął osierocone selektory i no-op klasy, zamknął fałszywe akcje live session przy staged/restored Focus oraz wzmocnił testy prywatności i focus trapu, które wcześniej mogły przechodzić z niewłaściwego powodu;
- focused gate przeszedł 315/315; autorytatywny `pnpm verify` przeszedł 893/893 testów jakości i Electron 5/5, a wymagane shell/terminal-core/workspace-switch przeszły 3/3; lint, typecheck, build i diff-check są zielone;
- dwa niezależne finalne review zakończyły się `APPROVED`; dowody R0/R1/R6/narrow i runtime proof są zachowane w `docs/audits/local-artifacts/2026-07-13-phase-i-slice-1-shell-terminal/`;
- workspace navigation pozostaje świadomie przejściowa do Slice 2; compatibility alias profilu terminala i legacy token aliases pozostają wyłącznie dla nietkniętych późniejszych powierzchni.

**Checkpoint Slice 1.1 — correctness cleanup, complete and published:**

- zakres implementacji: `9262b65..bfcf9f2` (9 commitów, od `c5fac91` do `bfcf9f2`) na `phase-i-slice-1-1-correctness-cleanup`;
- focused gate: 7/7 plików i 269/269 testów; pełne `pnpm verify`: lint PASS, typecheck 9/9, testy repo 893/893, build 6/6 i Electron 5/5;
- dodatkowy fixture-backed dogfood w realnym Electronie przeszedł 2/2: Focus ma 1 widoczny kafel, `scrollHeight = clientHeight = 826`, `scrollTop = 0`, a przecięcie aktywnego kafla z viewportem wynosi `1173 × 742` px;
- tożsamość `.xterm-screen` została zachowana dla Focus → Split → Grid → Focus oraz Workspace A → B → A; ukryty runtime pozostał podłączony i dane wysłane w tle były widoczne po powrocie;
- dowody geometry/node identity i zrzuty diagnostyczne: `docs/audits/local-artifacts/2026-07-13-phase-i-slice-1-1-correctness-cleanup/real-electron-audit.json`, `mixed-title-parity.json`, `focus-six-sessions.png`, `workspace-return.png`, `narrow-1120x720.png`;
- przejściowy panel pokazuje 6/6 fixture-backed sesji i 0 fałszywych pól search; Surfaces realizuje ArrowUp/ArrowDown/Home/End, Escape z odtworzeniem focusu i Tab exit do ⌘K; Inbox, Observatory, Context, Privacy i ⌘K pozostają osiągalne;
- w 1120×720 `documentHorizontalOverflow = 0`, `activeControlHorizontalOverflow = 0` dla 50 aktywnych kontrolek;
- `TerminalTailProjection` i cały niekonsumowany pipeline projekcji tailu zostały usunięte; nie wracają, dopóki realny konsument nie zostanie dostarczony w tym samym slice;
- screenshoty i ich hashe pozostają wyłącznie diagnostyczne; o PASS decydują pomiary DOM/geometrii i asercje runtime;
- oba final review zakończyły się bez findings, Patryk zaakceptował wynik, a squash merge PR #48 opublikował Slice 1.1 na `main` w `d5b3d31`.

**Checkpoint Slice 2 — complete and published at `d314b16`:**

- zatwierdzony aneks `2026-07-14-phase-i-slice-2-visual-contract-annex.md` zastępuje sprzeczne reguły Phase H wyłącznie dla Slice 2;
- project-first navigator ma stabilną kolejność, aktywne sesje projektu, osobną sekcję Free Chats oraz collapsed rail 46 px przy `≤1180 px`;
- navigator, tile, topbar i Context konsumują jeden wybór sesji; Focus nie dubluje tile headera;
- Context pozostaje floating i on demand; topbar/navigator są solid-first, a blur dotyczy wyłącznie rzeczywistych overlayów;
- stały dispatch został odrzucony; Prepare Work pozostaje akcją na żądanie przez `+`, Surfaces lub ⌘K;
- mechanicznie skorygowany mockup przeszedł sprawdzenie Grid/Focus/narrow 1120×720 bez błędów konsoli;
- stary `WorkspaceRail`, `SessionChromeRow` i `AlfredControlRail` zostały usunięte razem z osieroconym CSS i testami, bez równoległego compatibility shella;
- finalny `pnpm verify:quality` przeszedł lint, typecheck, 53 pliki i 722 testy desktopowe oraz build; kluczowy zestaw real-Electron przeszedł 8/8 po integracji;
- `main` i `origin/main` są zsynchronizowane na `d314b16`; następny właściciel produktu to Slice 3.

**Checkpoint Slice 3 — complete and published at `a463d28`:**

- jeden `AttentionProjection` zasila badge, sygnały projektów, kolejkę decyzji i Recovery; stary `workspace-attention`, lokalne mapy priorytetu oraz dekoracyjne dots/awatary zostały usunięte bez compatibility renderera;
- expanding docket B4 rozdziela inferred waiting, owned staged launch, hard block i Recovery: inferred otwiera Work bez zapisu do PTY, hard block nie ma bypassu, a Recovery nie zwiększa `Needs You`;
- selection, disclosure, status bar, Enter/Escape i scroll długiej kolejki mają jeden model zachowania; ten sam `.xterm-screen` pozostaje podłączony podczas Work ↔ Inbox ↔ Work;
- PR #49 opublikował Slice 3 w `53abdab`; jego macOS smoke ujawnił overflow drugorzędnych akcji nagłówka terminala przy 1120×720, mimo że wszystkie testy specyficzne dla Inboxa przeszły;
- PR #50 zamknął tę lukę w `a463d28`: status i Restart/Resume pozostają bezpośrednie, a akcje drugorzędne przechodzą do istniejącego `ChromeMenu` zależnie od szerokości kafla, bez drugiego store'u lub modelu akcji;
- świeże lokalne `pnpm verify` przeszło lint, typecheck, pełne testy (781 desktop), build i Electron 9/9; post-merge GitHub `quality`, `electron-smoke` i Vercel są zielone;
- wąski agent sanity review nie znalazł nierozstrzygniętego P0/P1, dead code, migration residue ani test theater w hotfixie; następny właściciel produktu to Slice 4 Sessions.

**Checkpoint Slice 4 — original closeout at `35b6dc7`, superseded by the approved correction at `54a4bf0`:**

- legacy Observatory history browser, jego IPC, komponenty, selektory i testy strukturalne zostały zastąpione jednym Sessions navigator/reader bez compatibility UI i bez drugiego navigatora projektów;
- pełna treść transkryptu ładuje się dopiero po wyborze; summary pages, transcript pages, DOM i cache mają jawne limity, a wyszukiwanie metadanych obejmuje pełny discovery universe przed utworzeniem bounded snapshotu;
- absolutne ścieżki źródłowe pozostają w Electron main, resume używa autorytatywnych canonical workspace roots, a dot-segment/symlink escape oraz nadmiarowe id/cwd nie mogą opublikować fałszywego Resume ani zablokować paginacji;
- Work/xterm pozostaje zamontowany podczas Work → Sessions → Work, odbiera dane w tle i zachowuje ten sam `.xterm-screen`; Sessions nie utrzymuje transcript DOM po wyjściu;
- recovery ma jawne Review → Confirm z command/cwd/reason, Escape i przejście do innej powierzchni rozbraja stan, a Free Chats zachowują stabilne grupowanie niezależnie od lifecycle;
- końcowy correction loop usunął duplicate navigator, stale CSS/runtime evidence, README Observatory residue, duplicate Refresh scan i trzy flaky 5-second resource tests bez sleeps/retries lub osłabiania asercji;
- świeże `pnpm verify` na scalonym lokalnym `main` przeszło lint, typecheck, 34/34 root tests, 59/59 desktop files i 869/869 desktop tests, build oraz real-Electron 11/11; final re-review: Ready YES, bez Important/Minor;
- branch i worktree wykonawcze usunięto; lokalny `main` jest czysty i 46 commitów przed `origin/main`;
- post-integration Computer Use ujawnił implicit drugą kolumnę powyżej 1180 px. Native Direct fix `35b6dc7` dodał jednego top-level ownera `grid-column: 1`, a CSS contract i Electron geometry zamieniły tę klasę regresji w twardą bramkę;
- przed poprawką Electron zmierzył `534.203125 px` przesunięcia przy 1440×900; po poprawce `surfaceOffsetLeft = 0` i `surfaceWidthDelta = 0` zarówno przy 1440×900, jak i 1120×720;
- świeże `pnpm verify` po poprawce ponownie przeszło 869/869 desktop tests i Electron 11/11, a Computer Use w prawdziwym Alfredzie potwierdził pełne wykorzystanie sceny;
- publikacja oczekuje wyłącznie na jawną zgodę Patryka.

**Checkpoint Slice 4 correction — complete and published at `54a4bf0`:**

- główna hierarchia to Projects → Conversations → Reader: projekty wyznaczają stabilny scope, Conversations nie powtarza nagłówków projektów, a Reader zachowuje otwarty dokument przy zmianie scope;
- external Codex parent/child lineage jest przenoszony przez wspólny kontrakt; delegated runs nie są peer conversations, znane dzieci składają się pod parentem, a orphan technical runs trafiają wyłącznie do cichego maintenance disclosure;
- jeden współdzielony sanitizer zasila main i renderer, więc plugin manifests, AGENTS/bootstrap i runtime envelopes nie wracają bokiem przez managed titles lub external snippets; Raw transcript pozostaje jawnym trybem evidence;
- project counts są stabilne względem filtrów czasu/source, Free Chats pozostaje osobnym scope, a puste scratch workspaces nie zalewają nawigacji;
- usunięto martwy grouped projection output, grupujące selektory CSS i testy starego modelu; nie pozostała compatibility UI ani równoległa ścieżka danych;
- fresh focused Sessions 133/133, full desktop 879/879, lint, typecheck, build i diff-check PASS; Electron pagination/runtime 2/2 PASS przy 1440×900 i 1120×720, z zero overflow, bounded resource diagnostics i `sameXtermScreen: true`;
- plan korekty został zużyty i usunięty; spec oraz roadmapa są ponownie zsynchronizowane, a `main == origin/main == 54a4bf0`.

**Checkpoint Slice 4 single-column correction — complete and published; final closeout at `02447bb`:**

- usunięto drugi rail Projects, jego komponent, view state i cały CSS residue; jedynym ownerem scope jest kompaktowy selector w Conversations;
- zmiana projektu/filtra zachowuje nadal pasującą rozmowę, wybiera pierwszy wynik dopiero po wykluczeniu poprzedniej, a zero wyników czyści Reader i pokazuje neutralny stan kontraktowy;
- Reader zachowuje bounded recent conversation i lifecycle action, natomiast provenance, model/branch/location, delegated-run count i Raw transcript są dostępne dopiero w `Run details`;
- `pnpm verify:quality` PASS: lint, typecheck, 59/59 desktop files, 884/884 desktop tests i build; focused renderer/style tests oraz diff-check PASS;
- real-Electron Sessions smoke PASS przy 1280×720 i 1120×720: zero document/control overflow, bounded diagnostics i `sameXtermScreen: true`;
- `main == origin/main == a2d9cad`; zużyty plan wykonawczy i scalony branch zostały usunięte;
- post-push GitHub `quality` PASS ujawnił dwa przestarzałe testy: globalny `getByRole("option")` obejmował natywne opcje project scope, a assertion nadal oczekiwał dawnego tekstu `120 conversations` zamiast zatwierdzonego kompaktowego `120`;
- hotfix scope'uje rozmowy do listboxa `Conversation results` i synchronizuje privacy screenshot selectors z breadcrumbem; lokalnie przeszedł focused 2/2, helper unit 4/4, lint oraz pełny Electron smoke 11/11;
- hotfix opublikowano na `main` w `02447bb`; post-push GitHub Actions run `29826498256` PASS (`quality` 4m10s, `electron-smoke` 54s). Slice 4 jest formalnie zamknięty, bez dalszego planu naprawczego.

**Checkpoint Slice 5 Preview dock — complete and published at `728c4f8`:**

- wykrycie obsługiwanego loopback URL wyłącznie aktywuje `Preview`; dock pozostaje domyślnie zamknięty i otwiera się jawnie jako prawa, resizable powierzchnia Work;
- stan otwarcia i szerokość 420–620 px są przechowywane per workspace, a zamknięcie/ponowne otwarcie, resize i offline nie remountują pierwszego węzła xterm;
- Layout zachowuje jedno menu `Focus/Split/Grid/Arrange`; pełny kontrakt Vitest/Electron został przeniesiony z usuniętych bezpośrednich przycisków na rzeczywisty `ChromeMenu`;
- offline usuwa iframe z fokusu/DOM, zachowuje Retry/Open externally i pokazuje prawdziwe `Earlier`/`Not yet`; błędy Copy URL trafiają do istniejącego shell alertu;
- Preview ma jednego właściciela CSS w `workspace-preview-dock.css`; globalny `styles.css` nie zawiera selektorów Preview ani relacji Context/Preview;
- focused gate: 8/8 plików, 65/65 matched; pełne `pnpm verify` PASS: lint, typecheck 9/9, root 34/34, desktop 60/60 plików i 894/894 testów, build 6/6 oraz Electron 12/12; `git diff --check` PASS;
- real-Electron Preview 1/1 korzysta z natywnego loopback servera i rzeczywistego Chromium `ERR_CONNECTION_REFUSED`, zachowuje xterm identity, mierzy resize 500→516 px i przechodzi w 1120×720 bez ucięcia sceny;
- finalny screenshot został odczytany przez `view_image`: równocześnie widoczne i używalne są terminal, separator 516 px, pełny offline fallback oraz akcje Preview;
- fast-forward do lokalnego `main` zakończony, feature branch usunięty, ponowny `pnpm verify` na scalonym wyniku PASS (desktop 894/894, Electron 12/12), a `.impeccable/` i `.tmp/` zachowane;
- zużyty plan wykonawczy i Slice-owned SDD residue usunięto po integracji; kanoniczny spec, roadmapa i final closeout pozostają;
- pierwszy post-push smoke ujawnił przenośny błąd testu: prawdziwy renderer `ERR_CONNECTION_REFUSED` występuje zawsze, ale odpowiadający log Electron main jest opcjonalny; `728c4f8` wymaga renderera, dopuszcza najwyżej jeden zgodny main log i nadal odrzuca duplikaty oraz wszystkie niezwiązane błędy;
- `main == origin/main == 728c4f8`; finalny GitHub Actions run `29916883083` PASS (`quality` 4m0s, `electron-smoke` 53s). Slice 5 i Faza I są zamknięte.

**Dziedziczenie po Slice 2:**

- nowy navigator, topbar, selected-session state i kontener Contextu są trwałym shellem dla Slice 3–5, nie wariantem ograniczonym do jednego przekroju;
- Slice 3 jest właścicielem utworzenia i migracji `AttentionProjection`; zasila licznik i czteroramienny sygnał Alfreda w istniejącym navigatorze bez jego redesignu;
- Slice 4 umieszcza Sessions w scenie tego samego shella jako własną bibliotekę Projects → Conversations → Reader; projektowy scope Sessions nie kopiuje aktywnego drzewa sesji z Work i nie tworzy drugiego ownera stanu workspace;
- Slice 5 przenosi Preview do jawnego, on-demand docka w scenie Work, usuwa jego dawną własność z Contextu i nie dodaje spekulatywnego drugiego inspektora ani nowych funkcji Context/aux;
- F14 pozostaje warunkiem wiarygodnego typu `failed`, ale nie blokuje pozostałych typów attention w Slice 3; `failed` pozostaje jawnie poza jego zakresem do zamknięcia F14.

**Kolejność:**

0. runtime foundations — **complete**;
1. shell i terminal — **complete**;
1.1. correctness cleanup — **complete and published at `d5b3d31`**;
2. przełączanie projektów i sesji + podstawowy Context shell — **complete and published at `d314b16`**;
3. Inbox + kanoniczny `AttentionProjection` — **complete and published at `a463d28`; `failed` excluded until F14**;
4. Sessions: wyszukiwanie i czytanie wcześniejszej pracy w odziedziczonym shellu — **single-column correction complete and published at `a2d9cad`**;
5. on-demand Preview dock i cleanup dawnej własności Contextu — **complete and published at `728c4f8`; post-push gate PASS**.

**Po każdym przekroju:**

- porównanie z kontraktem wizualnym;
- manualny Electron check;
- smoke test geometrii;
- testy zakresowe;
- usunięcie zastępowanej implementacji i CSS w tym samym diffie;
- brak niezwiązanych funkcji;
- osobna akceptacja przed kolejnym przekrojem.

**Zakazy:**

- dwa agenty nie zmieniają równolegle globalnego CSS lub tego samego shellu;
- nie powstaje tymczasowa druga implementacja;
- nie dopisujemy override’u zamiast usunięcia zastępowanej reguły;
- nie uznajemy testów za zamiennik oceny realnego okna.

### Faza J0 — Visual Alignment

**Cel:** przed rozpoczęciem real-use gate wdrożyć nowszy, jawnie zaakceptowany kontrakt wizualny bez ponownego otwierania discovery i bez zmiany terminal-first architektury.

**Źródła wykonawcze:**

- kontrakt: `docs/audits/local-plans/2026-07-23-phase-j0-visual-alignment-spec.md`;
- dowód zamknięcia Slice 1: `docs/audits/local-artifacts/2026-07-23-phase-j0-slice-1-work-shell/OBSERVATION.md`;
- zachowany spec Slice 2: `docs/audits/local-plans/2026-07-23-phase-j0-slice-2-sessions-run-details-spec.md`;
- dowód zamknięcia Slice 2: `docs/audits/local-artifacts/2026-07-23-phase-j0-slice-2-sessions-run-details/OBSERVATION.md`;
- zaakceptowany spec Slice 3: `docs/audits/local-plans/2026-07-23-phase-j0-slice-3-inbox-spec.md`;
- dowód zamknięcia Slice 3: `docs/audits/local-artifacts/2026-07-23-phase-j0-slice-3-inbox/OBSERVATION.md`;
- zachowany spec Slice 4: `docs/audits/local-plans/2026-07-23-phase-j0-slice-4-context-privacy-spec.md`;
- receipt Slice 4: `docs/audits/local-artifacts/2026-07-23-phase-j0-slice-4-context-privacy/OBSERVATION.md`;
- plan product-wide consistency/accessibility: `docs/audits/local-plans/2026-07-28-phase-j0-product-wide-consistency-accessibility-plan.md`;
- plan bounded native-glass rollout: `docs/audits/local-plans/2026-07-28-phase-j0-native-glass-rollout-plan.md`;
- zaakceptowany mockup: `.tmp/alfred-visual-language-mockup/index.html`;
- final critique: `.impeccable/critique/2026-07-23T10-01-05Z__tmp-alfred-visual-language-mockup-index-html.md`.

**Kolejność:**

1. Slice 1 — Work shell i Preview — **complete, accepted and integrated locally at `28f9d2a`**;
2. Sessions i zintegrowane Run details — **complete and published at `e136ad0`**;
3. Inbox — **complete and integrated locally at `de50789`**;
4. Context i Privacy — **complete, integrated locally at `750cb93`, final post-integration native receipt PASS**;
5. product-wide consistency i accessibility pass — **complete at `786d21e`; focused/full quality and Electron `14/14` PASS; direct native receipt preserved**;
6. bounded native glass po osobnej obserwacji w realnym Electronie — **accepted and planned on 2026-07-28; produkcyjne wdrożenie i direct native gate pending**;
7. obowiązkowy dogfooding Fazy J — **gate PASS at `d8042c7`; trzy realne sesje w trzech projektach i dwie kolejne sesje bez blokera**.

Po każdym slice obowiązuje osobna akceptacja. Jeden diff nie może obejmować dwóch niezależnych powierzchni. Zmiana nie może remountować xterm, zmieniać state ownership ani dopisywać kolejnej warstwy override CSS.

**Brama wyjścia J0:**

- wszystkie zaakceptowane powierzchnie są zaimplementowane w produkcji;
- pełne quality i Electron smoke przechodzą;
- bezpośrednia obserwacja realnego okna potwierdza szeroki i wąski layout;
- nie istnieje drugi aktywny kontrakt wizualny ani niewycofana zastępowana warstwa CSS;
- Patryk akceptuje wynik przed zamknięciem J0; obowiązkowy dogfooding został już
  wykonany i pozostaje ważnym wcześniejszym dowodem.

### Faza J — Obowiązkowy dogfooding

**Cel:** przerwać pętlę „iteruję, ale nie używam”.

**Minimalny protokół:**

- co najmniej trzy rzeczywiste sesje kodowania;
- minimum dwa projekty;
- start i resume agenta;
- przełączenie projektu w trakcie pracy;
- Focus, Split i Grid bez utraty terminala;
- obsłużenie realnej decyzji w Inboxie;
- użycie Sessions do znalezienia wcześniejszej pracy w innym projekcie, przeczytania fragmentu i poprawnego Reveal/Resume/Open Project bez utraty bieżącego terminala.

Problemy są zapisywane podczas sesji, ale nie naprawiane impulsywnie w tym samym momencie. Po zakończeniu batcha następuje triage.

**Brama wyjścia:**

- dwie kolejne sesje bez blokera core flow;
- Alfred może pozostać głównym miejscem pracy przez pełną sesję;
- poprawki wynikają z zaobserwowanego tarcia;
- hipotetyczne ulepszenia i nowe funkcje trafiają do backlogu.

### Faza Z — Stabilizacja i pierwsza używalna wersja

**Stan:** **complete — accepted and published at `2a020a0`; GitHub Actions
`30432394289` PASS.** F14 ma atomowy reconcile, brakujący folder workspace'u
pozostaje odzyskiwalny bez uruchamiania PTY, pełny lokalny `pnpm verify`,
bezpośrednia obserwacja natywnej aplikacji i post-push CI przeszły. Patryk
zaakceptował wynik jako pierwszą codzienną wersję Alfreda. Nie ma zatwierdzonej
następnej fazy.

**Release gate:**

- zero otwartych P0/P1;
- każdy odłożony P2 ma zapisane uzasadnienie;
- full tests, typecheck, prawdziwy lint, build i Electron smoke przechodzą;
- brak błędów konsoli i duplicate key warnings;
- świeże uruchomienie przechodzi pełny core flow;
- xterm zachowuje stan przy zmianie projektu i layoutu;
- Inbox pokazuje tylko prawdziwe decyzje, a każda akcja działa;
- obserwatorium istnieje, ale nie dominuje Work;
- widoczny shell ma jedną aktywną warstwę CSS;
- README i architektura odpowiadają runtime;
- dogfooding gate jest spełniony;
- Patryk potwierdza, że Alfred nadaje się do codziennej pracy;
- nie istnieje niezatwierdzony „jeszcze jeden redesign loop”.

Po przejściu gate’u feature freeze może zostać zdjęty dla jednego eksperymentu naraz.

---

## 8. Mapa findings do faz

| Finding | Faza blokująca | Oczekiwany rezultat |
| --- | --- | --- |
| F1 waiting no-op | B | Każdy `waiting` ma prawdziwą akcję albo nie ma primary action |
| F2 dwa Inboxy | B/F | Jeden model akcji, docelowo jedna kanoniczna powierzchnia |
| F3 test terminala | B/E | Geometria sprawdzana w Electronie/browserze |
| F4 workspace identity | B | Globalne akcje jednoznacznie pokazują projekt |
| F5 Activity truncation | B | Raw i count odnoszą się do prawdziwego zbioru |
| F6 martwy safety flow | F | Jeden osiągalny model hard block/confirm |
| F7 last-block-wins | G | Kanoniczne reguły dla core shellu |
| F8 dwa zestawy layout controls | F | Jeden zestaw Focus/Split/Grid |
| F9 scroll Inboxa | B/G | Jeden scroll owner zweryfikowany w runtime |
| F10 validation theater | E | Niezależne test/typecheck/lint/build/Electron gates |
| F11 README drift | D | Dokumentacja opisuje desktopowy produkt |
| F12 dead CSS | G | Potwierdzone sieroty usunięte wraz z kontraktami |
| F13 specificity | B | Dedykowana reguła rzeczywiście działa |
| F14 lost terminal exit | Z | Atomowe subscribe/reconcile zachowuje exit code, buffer i restored-session semantics |

### Aktualny status findings po Fazie Z

| Finding | Status aktualny | Dowód / następna faza |
| --- | --- | --- |
| F1 | resolved | `waiting` ma prawdziwe focus-only `Open`; test kliknięcia i Electron Inbox smoke |
| F2 | resolved | usunięty drugi globalny `ReviewQueuePanel`; wszystkie wejścia prowadzą do `ReviewSurface` |
| F3 | resolved | fałszywy regex geometry test usunięty; geometria i keep-alive zweryfikowane w Electronie |
| F4 | resolved | Inbox pokazuje pełny workspace w copy i accessible names |
| F5 | resolved | Activity pracuje na pełnym zbiorze; regresja powyżej dziewięciu eventów |
| F6 | resolved | Faza F — `safetyNote` jest hard-block, a drugie potwierdzenie dotyczy wyłącznie recovery |
| F7 | resolved | Faza G — kanoniczne top-level/responsive owner regions, occurrence contracts i provenance-locked evidence |
| F8 | resolved | Faza F — `WorkbenchHeader` jest jedynym widocznym markupiem Focus/Split/Grid |
| F9 | resolved | `.inbox-section-stack` jest jednym scroll ownerem; runtime smoke długiej kolejki |
| F10 | resolved | Faza E — independent ESLint/typecheck/test/build gates, isolated Electron smoke 3/3, clean-checkout proof oraz zielone GitHub Actions `quality` i `electron-smoke` na PR #46 run `29132631804` |
| F11 | resolved | Faza D — README opisuje desktopowy produkt i zweryfikowane runtime/deploy commands |
| F12 | resolved | Faza G — 11 selektorów usuniętych po czterech dowodach; 74 KEEP z nazwaną brakującą przesłanką |
| F13 | resolved | dedykowany selektor ma właściwą specyficzność i kontrakt testowy |
| F14 | resolved | Faza Z — atomowy reconcile zwraca exit metadata po rejestracji renderera; test kontrolowanego race i natywna obserwacja szybkiego procesu PASS |

Faza Z zamyka ostatni pre-existing P1. Końcowy release receipt zapisuje zero
otwartych P0/P1 i zero nadal reprodukowalnych odłożonych P2.

---

## 9. Zasady anty-drift

1. Jedna aktywna faza i jeden aktywny cel produktowy.
2. Jedna gałąź zmieniająca główny shell w danym momencie.
3. Każda zmiana wskazuje finding albo wpis z dogfoodingu.
4. Nowy pomysł nie zatrzymuje fazy, chyba że jest P0/P1 dla core flow.
5. Feature, redesign i infrastrukturalny refactor nie trafiają do jednego PR.
6. Cleanup, behavior change i styling mają osobne, czytelne commity.
7. Nie dodajemy abstrakcji, propsów, statusów ani fallbacków bez aktualnego runtime consumera.
8. Nie tworzymy drugiej implementacji „tymczasowo”.
9. Layoutu nie zatwierdzamy testem sprawdzającym tekst CSS.
10. Nie dopisujemy globalnych override’ów na końcu arkusza.
11. Nie rozszerzamy zakresu dlatego, że agent już pracuje w danym pliku.
12. Nie formatujemy całych dużych plików przy małej zmianie logiki.
13. Test jednostkowy nie zastępuje manualnego Electron smoke.
14. Nie sprzątamy compatibility code tylko dlatego, że wygląda historycznie.
15. Nie usuwamy fallbacku bez dowodu, że jego stan jest nieosiągalny.
16. Plan nie może zawierać wielkich bloków produkcyjnego CSS/kodu tylko po to, aby implementacja była „verbatim”.
17. Test nie może po prostu odtwarzać kodu wklejonego w tym samym planie.
18. Po spełnieniu bramki faza się kończy; dalszy polish trafia do backlogu.
19. Jeśli faza nie przejdzie bramki, następna nie startuje.
20. Patryk ocenia realne okno i realną sesję pracy, nie tylko statystyki diffu i testów.

---

## 10. Definicja sukcesu

Pierwsza wersja jest zakończona, gdy:

- istnieje jeden oczywisty workflow `projekt → agent → terminal`;
- przełączanie projektów jest szybkie i nie traci terminala;
- Inbox pokazuje tylko realne decyzje i każda jego akcja działa;
- obserwatorium pomaga odpowiedzieć, co dzieje się z agentami, lecz nie dominuje Work;
- kontekst i diagnostyka są dostępne na żądanie;
- nie ma zdublowanych globalnych powierzchni i kontrolek;
- widoczny shell ma jedną aktywną warstwę CSS;
- layout i scroll są zweryfikowane w prawdziwym Electronie;
- dokumentacja opisuje faktyczny produkt;
- Patryk odbył realne sesje pracy i przestał używać Alfreda wyłącznie jako obiektu kolejnych iteracji.

Najważniejsza zależność całego programu:

> Najpierw jedna tożsamość produktu i jeden runtime path. Potem wiarygodna walidacja i przewidywalny CSS. Następnie zatwierdzony wygląd. Na końcu realne użycie i stabilizacja.

Odwrócenie tej kolejności odtworzy poprzednią pętlę.

---

## 11. Historia zmian dokumentu

| Data | Zmiana | Status |
| --- | --- | --- |
| 2026-07-10 | Pierwsza wersja: charter, pełny audyt, decyzja o webie, roadmap A-Z i anti-drift | zaakceptowane przez Patryka; Faza A complete |
| 2026-07-10 | Faza B: ujednolicenie Inboxa, naprawa semantyki akcji i Activity, prawdziwy scroll/layout oraz pełna walidacja w Electronie | verified; rekomendacja `merge`, oczekuje na decyzję Patryka |
| 2026-07-10 | Patryk zaakceptował merge Fazy B; `ui-onebar-inbox` scalony fast-forwardem i wypchnięty na `main` | Faza B complete at `3e5362f`; Faza C active |
| 2026-07-10 | Faza C: root release gate, branch audit, sześć baseline screenshotów i jawne rozliczenie findings | complete — clean baseline at `3e5362f`; Faza D not started |
| 2026-07-10 | Faza D preflight: dependency/deployment audit, leaf proof i decyzja o zachowaniu Vercel API-only | gate passed; Faza D active, code deletion not yet started |
| 2026-07-10 | Faza D: usunięcie osobnego klienta, desktop-first workflow i README, Vercel API-only, residue proof, fix shutdownu launchera oraz pełny Electron/release gate | complete; merged and pushed to `main` at `72b828c`; branch/worktree removed; Faza E not started |
| 2026-07-10 | Faza E: zaakceptowany kierunek ESLint + Playwright Electron + GitHub Actions i zapisany lokalny spec bramki jakości | spec ready for review; Faza E not started |
| 2026-07-10 | Faza E: zaakceptowany spec rozpisany na implementation plan z lint preflightem, test hygiene, trzema Electron scenarios, lokalnymi gate'ami i CI | implementation plan ready; Faza E not started |
| 2026-07-11 | Faza E: niezależny ESLint, oczyszczony Vitest, izolowany Electron harness z trzema runtime scenarios, lokalne release gates, GitHub Actions i clean-checkout proof | locally verified at `001a52b`; `pnpm verify` PASS, Electron 3/3, F10 awaiting first remote run; Phase F not started |
| 2026-07-11 | Faza E: pierwszy remote run ujawnił macOS XPC noise oraz false-green testu ikony; oba naprawiono i drugi run GitHub Actions przeszedł | F10 resolved at `4d3ab0b`; `quality` + `electron-smoke` green in run `29132631804`; PR #46 nadal blokuje historyczny Vercel Vite/`apps/web` project config; Phase F not started |
| 2026-07-11 | Faza E: usunięto zdalny profil Vite/`apps/web`, dodano jawny bezpieczny marker outputu API-only i zweryfikowano finalny PR | complete at `852124b`; PR #46 checks green (`quality`, `electron-smoke`, Vercel), production `/health` i `/api/health` healthy; branch-scoped Preview env residue świadomie odłożone bez rozszerzania tokenów; Phase F not started |
| 2026-07-11 | Faza E scalona squashem; post-merge CI ujawniło timing-sensitive renderer assertion, naprawione test-only w PR #47; ponowny run na `main` przeszedł | complete at `0a3e188`; `quality` + `electron-smoke` green in run `29150039477`; branche i worktree Fazy E usunięte |
| 2026-07-11 | Faza F runtime audit i design: jeden actionable Inbox, Context diagnostyczny, hard-block dla `safetyNote`, usunięcie ghost layout controls | design approved by Patryk; spec pending review; implementation not started |
| 2026-07-11 | Faza F: zaakceptowany spec rozpisany na trzy zadania TDD — hard-block safety, canonical Inbox/Context oraz ghost layout removal z pełnym Electron gate | implementation plan ready; implementation not started |
| 2026-07-11 | Faza F: hard-block staged safety, recovery-only confirm, jeden aggregate Inbox, diagnostyczny Alfred rail i jeden markup Focus/Split/Grid | complete at `c8aec57`; four commits; all task reviews clean; final review Ready to merge YES; fresh merged-main `pnpm verify` PASS, Electron 3/3; local `main` ahead of origin by 4, not pushed |
| 2026-07-11 | Faza F wypchnięta do `origin/main`; post-push CI potwierdziło pełną integrację | complete at `c8aec57`; GitHub Actions run `29167398204` PASS; branch/worktree wykonawcze usunięte |
| 2026-07-11 | Faza G: zatwierdzony design sanitation bez zmian wizualnych, osiem stanów baseline'u, trzy owner slices i evidence-based orphan sweep | spec zapisany lokalnie i oczekuje na końcową akceptację; implementation not started |
| 2026-07-11 | Faza G: zaakceptowany spec rozpisany na evidence harness, trzy sekwencyjne owner slices, orphan sweep i finalny gate; dodano supplemental overlay proof bez rozszerzania produktu | implementation plan ready for approval; implementation not started |
| 2026-07-12 | Faza G: kanoniczne owner regions, responsive contracts, 11-state provenance-locked evidence, xterm invariants i evidence-based orphan sweep | complete at `3bb2e66`; F7/F9/F12 resolved; 857/857 tests and Electron 4/4 PASS on merged local `main`; branch/worktree removed; not pushed; Phase H next |
| 2026-07-13 | Faza H: po wyborze „Scena + konstytucja” audyt handoffu ujawnił zbyt mocne obietnice keep-alive/Inbox tail, nieaktualną mapę v2 oraz braki kontrastu, safety i narrow evidence; spec skorygowano bez otwierania nowego redesignu | in review; oczekuje na review Claude'a, brakujące ramki albo jawny waiver i ponowną akceptację Patryka; Phase I not started |
| 2026-07-13 | Faza H closeout: Claude zweryfikował findings w kodzie, dodał R4b/R4c/R8b/R8c i doprecyzował AttentionProjection; Codex niezależnie zweryfikował artefakty, a Patryk ponownie zaakceptował kontrakt | complete; final manifest PASS; roadmap/context/memory synchronized; Phase I not started and requires a separate plan approval |
| 2026-07-13 | Faza I Slice 0: stateful main-owned PTY activity, xterm-derived tail, persistent cross-workspace xterm ownership oraz real-Electron identity/background-delivery proof; dwa błędy identity wykryte przez final review poprawiono przed akceptacją | accepted at `137f2d3`; focused 252/252, `pnpm verify` 870/870 + Electron 4/4, final review clean; Phase I active, Slice 1 not planned, branch not merged or pushed |
| 2026-07-13 | Faza I Slice 1: frozen 40/74 px shell, adaptive session chrome, jedna reprezentacja sesji, on-demand Prepare Work, kanoniczny materiał terminala oraz real-Electron proof R0/R1/R6; końcowy sanity sweep usunął residue i false-green tests | accepted at `9262b65`; focused 315/315, `pnpm verify` 893/893 + Electron 5/5, required Electron 3/3, two final reviews APPROVED; fast-forwarded locally into `phase-i-slice-0-runtime-foundations`, Slice 2 not planned |
| 2026-07-13 | Zaakceptowane Slice 0 i Slice 1 scalono fast-forwardem do `main` oraz wypchnięto do `origin/main`; przed publikacją powtórzono pełną bramkę na docelowym branchu | published at `9262b65`; `main == origin/main`; `pnpm verify` PASS, 893/893 quality + Electron 5/5; wykonawczy branch i worktree Phase I usunięte; Slice 2 not planned |
| 2026-07-13 | Faza I Slice 1.1 correctness cleanup: zgodność selected chrome/tile, Focus bez ukrytych siblingów w flow, pełna transitional navigation, kompletna klawiatura Surfaces, usunięty niekonsumowany terminal-tail pipeline i orphan CSS; świeże bramki oraz ośmiopunktowy real-Electron dogfood | locally verified at `2a457e5`; focused 269/269, `pnpm verify` 893/893 + Electron 5/5, additional dogfood 2/2; post-review token closeout verified 91/91 + build; final hydration-race test fix verified desktop 688/688 + Electron 5/5; oba final review APPROVED bez findings; akceptacja Patryka pending; Slice 2 not started |
| 2026-07-13 | Faza I Slice 1.1 po akceptacji Patryka scalona squashem przez PR #48 i opublikowana na `main` | complete and published at `d5b3d31`; `main == origin/main`; Slice 2 implementation not started |
| 2026-07-14 | Faza I Slice 2: niezależny design review skorygował sprzeczności Phase H, permanent dispatch, kontrast, material, motion i selected-session identity; Patryk zatwierdził aneks oraz finalny project-first mockup | visual contract frozen; mock Grid/Focus/1120×720 PASS, console clean; implementation spec and plan not started |
| 2026-07-14 | Faza I Slice 2: implementation spec zmapował zatwierdzony shell na aktualny kod, rozdzielił odpowiedzialności Slice 2–5 i zapisał migrację bez równoległych ownerów oraz obowiązkowy orphan sweep | implementation spec pending Patryk approval; implementation plan and production changes not started |
| 2026-07-14 | Patryk zatwierdził implementation spec Fazy I Slice 2 bez rozszerzania zakresu | implementation plan pending; production changes not started |
| 2026-07-14 | Plan wykonawczy Slice 2 rozpisał pięć sekwencyjnych zadań TDD: navigator, chrome Work, floating Context, CSS/orphan sweep i real-Electron proof | implementation plan pending Patryk approval; production changes not started |
| 2026-07-15 | Faza I Slice 2 została ukończona, zweryfikowana po finalnym review, scalona fast-forwardem i wypchnięta do `origin/main`; closeout usunął zużyte plany i pozostawił aneks/spec jako kontrakt dziedziczony przez Slice 3–5 | complete and published at `d314b16`; `main == origin/main`; `pnpm verify:quality` PASS, desktop 722/722, focused Electron 8/8; Slice 3 next, spec not started |
| 2026-07-15 | Faza I Slice 3: po porównaniu Source List, Expanding Docket i Focus Deck wybrano oraz iteracyjnie skorygowano B4; spec rozdziela inferred waiting, owned staged, hard block i recovery oraz usuwa dots/avatars i fałszywe akcje | visual direction approved; canonical mockup retained; written spec in review; implementation plan and production changes not started |
| 2026-07-15 | Patryk zatwierdził pisemny kontrakt Slice 3 z jednym `AttentionProjection`, modelem akcji B4, recovery poza licznikiem i wykluczeniem `failed` do F14 | implementation plan next; production changes not started |
| 2026-07-15 | Plan wykonawczy Slice 3 rozpisał pięć sekwencyjnych zadań TDD: kanoniczną projekcję, expanding docket, Recovery/safety, kontrakt B4 z orphan sweepem i real-Electron proof | implementation plan ready for approval; production changes not started |
| 2026-07-16 | Faza I Slice 3 została zaimplementowana bez równoległego Inboxa/modelu uwagi i scalona przez PR #49; post-merge analiza nieudanego macOS smoke zawęziła problem do overflow drugorzędnych akcji terminal tile przy 1120×720 | Slice 3 product behavior published at `53abdab`; Inbox-specific Electron flows PASS; narrow shell hotfix required before closeout |
| 2026-07-16 | Hotfix terminal tile actions wykorzystał istniejący `ChromeMenu` i container query kafla, zachował bezpośrednie Restart/Resume oraz xterm node identity; PR #50 scalony do `main` | Slice 3 complete and published at `a463d28`; local `pnpm verify` PASS (desktop 781/781, Electron 9/9); post-merge GitHub quality/electron-smoke/Vercel PASS; Slice 4 Sessions convergence/spec next |
| 2026-07-20 | Product convergence rozdzieliło Sessions od przyszłego Observatory; spec został zatwierdzony, a implementation plan zapisany | Sessions został wybrany jako następna powierzchnia Fazy I; zużyty plan wykonawczy wycofano podczas closeoutu Slice 4, a kontrakt zachowuje spec |
| 2026-07-20 | Faza I Slice 4 Sessions zastąpił legacy Observatory browser jednym bounded navigator/reader; whole-branch review domknął integrację, recovery, canonical trust, resource caps i test flakiness, a merged-main gate przeszedł | complete on local `main` at `2337e70`; `pnpm verify` PASS, desktop 869/869, Electron 11/11, final review Ready YES; branch/worktree removed; remote publication pending, Slice 5 unplanned |
| 2026-07-20 | Post-integration Computer Use pokazał szeroki Sessions przypięty do implicit drugiej kolumny mimo zielonego smoke; inspekcja CSS potwierdziła brak `grid-column: 1` poza narrow media query | visual closeout reopened; publikacja wstrzymana; następny krok to mały Native Direct fix z testem pokrycia sceny i ponowną obserwacją, bez nowego speca/planu |
| 2026-07-20 | Native Direct fix ustanowił jednego szerokiego ownera kolumny Sessions, dodał CSS/runtime coverage przy 1440×900 i 1120×720 oraz przeszedł ponowny Computer Use | Slice 4 complete and visually closed locally at `35b6dc7`; `pnpm verify` PASS (869/869 desktop, Electron 11/11); publication pending explicit authorization |
| 2026-07-21 | Zatwierdzona korekta Sessions zastąpiła płaski, zanieczyszczony strumień biblioteką Projects → Conversations → Reader, naprawiła parent/delegated lineage, współdzielone czyszczenie runtime envelopes i jawny Raw transcript oraz usunęła residue starego grupowania | Slice 4 complete and published at `54a4bf0`; focused 133/133, desktop 879/879, lint/typecheck/build/diff-check PASS, Electron pagination/runtime 2/2 PASS at 1440×900 and 1120×720; `main == origin/main`, Slice 5 convergence next |
| 2026-07-21 | Końcowa zatwierdzona korekta Sessions upraszcza hierarchię do Conversations → Reader, integruje project scope w nagłówku, dodaje prawdziwe selection reconciliation i przenosi provenance/raw/delegated metadata do on-demand Run details | complete and published at `a2d9cad`; `main == origin/main`; `pnpm verify:quality` PASS (desktop 884/884), Sessions Electron PASS at 1280×720 and 1120×720 with zero overflow and preserved xterm identity; Slice 5 convergence next |
| 2026-07-21 | Post-push closeout Slice 4 naprawił dwa przestarzałe Electron smoke assertions bez zmian w runtime: scoping rozmów do listboxa, kompaktowy licznik i aktualne privacy screenshot selectors | final closeout at `02447bb`; GitHub Actions run `29826498256` PASS (`quality`, `electron-smoke`); Slice 4 closed, Slice 5 convergence next |
| 2026-07-22 | Product convergence zawęziło Slice 5 do zatwierdzonego, on-demand resizable Preview docka i cleanupu dawnej własności Contextu; nowe funkcje Context/aux odłożono bez konkretnego problemu | written contract approved; partial implementation exists; remediation plan and fresh full gate required before closeout |
| 2026-07-22 | Faza I Slice 5: default-closed per-workspace Preview dock, jeden owner CSS, Layout przez ChromeMenu, realny Electron loopback/offline i zachowana tożsamość xterm; review poprawił sztuczny offline na prawdziwe Chromium `ERR_CONNECTION_REFUSED` | locally complete at `76b3a68`; focused 65/65, desktop 894/894, Electron 12/12, full `pnpm verify` and visual gate PASS; branch not pushed, Phase I remains open pending integration |
| 2026-07-22 | Zweryfikowany Slice 5 scalono fast-forwardem do lokalnego `main`, ponowiono pełną bramkę na wyniku i usunięto feature branch | local `main` at `76b3a68`, 7 commits ahead of `origin/main`; post-merge `pnpm verify` PASS, desktop 894/894, Electron 12/12; not pushed, Phase I remains open pending post-push gate |
| 2026-07-22 | Publikacja Slice 5 ujawniła opcjonalny, zależny od środowiska log Electron main przy realnym `ERR_CONNECTION_REFUSED`; poprawiono wyłącznie kontrakt harnessu i ponowiono CI | complete and published at `728c4f8`; `main == origin/main`; GitHub Actions run `29916883083` PASS (`quality` 4m0s, `electron-smoke` 53s); Phase I closed, Phase J next |
| 2026-07-23 | Patryk zatwierdził nowszy kontrakt wizualny jako J0, etap wejściowy Fazy J; kierunek pozostaje zamknięty, a implementation plan obejmuje wyłącznie Work shell + Preview | J0 Slice 1 plan ready; production implementation and runtime evidence not started; native-glass probe remains outside the slice |
| 2026-07-23 | J0 Slice 1 wdrożył zaakceptowany język wizualny dla Work shell i Preview bez zmiany lifecycle xterm ani state ownership; po final review Patryk zaakceptował wynik, branch scalono fast-forwardem do lokalnego `main`, a plan wykonawczy wycofano | complete and integrated locally at `28f9d2a`; focused/full quality, typecheck, build i Electron 12/12 PASS; bezpośrednia obserwacja 1440×900 i 1120×720 PASS; brak push; J0 Slice 2 Sessions + Run details jest następnym etapem |
| 2026-07-23 | J0 Slice 2 został zawężony do wizualnej korekty istniejących Sessions i zastąpienia modalnego Run details zintegrowanym inspektorem Reader; Patryk polecił od razu zaakceptować spec i przygotować plan | spec approved; five-task TDD implementation plan ready; projection, IPC, privacy, resource limits, lifecycle i xterm ownership pozostają bez zmian; production implementation not started |
| 2026-07-23 | J0 Slice 2 wdrożył kompaktowe filtry Sessions i zintegrowany Run details bez zmiany projection, IPC, lifecycle ani xterm ownership; Patryk wybrał lokalny fast-forward, a zużyty plan wykonawczy wycofano | complete and published at `e136ad0`; merged-main `pnpm verify:quality` PASS (desktop 900/900), Electron 12/12 i bezpośrednia obserwacja 1440×900/1120×720 PASS; `main == origin/main`; Slice 3 Inbox jest następny |
| 2026-07-23 | J0 Slice 3 został zawężony do jednej globalnej powierzchni Inbox, usunięcia zdublowanej nawigacji/Project raila i dostosowania prezentacji do J0 przy zachowaniu AttentionProjection, akcji, Recovery safety i xterm ownership | bounded spec ready for Patryk approval; implementation plan and production changes not started |
| 2026-07-23 | Patryk zaakceptował bounded spec J0 Slice 3; plan wykonawczy rozpisał trzy sekwencyjne bramki TDD dla globalnego shellu Inboxa, płaskiej prezentacji oraz real-Electron proof bez nowego state/IPC/modelu kolejki | bounded spec approved; implementation plan ready for Patryk approval; production changes not started |
| 2026-07-27 | J0 Slice 3 i Slice 4 są scalone lokalnie; finalny Computer Use receipt trafił we właściwy development Electron po usunięciu konfliktu dwóch aplikacji z bundle ID `com.github.Electron` | Slice 4 complete and visually closed at `750cb93`; merged-main `pnpm verify:quality` PASS (desktop 902/902), Electron smoke `13/13`, final review 0 findings, direct 1440×900/1120×720 observation PASS; no push; product-wide consistency/accessibility is next |
| 2026-07-28 | Phase J dogfooding wykonał trzy realne sesje w Alfred, IronLog i CodexPulse; triage naprawił Focus selection i aktualność Context, a dwa kolejne post-fix core flows przeszły bez blokera | dogfooding gate PASS at `d8042c7`; `pnpm test` PASS (desktop 905/905), typecheck i build PASS; J0 pozostaje otwarte wyłącznie przez product-wide consistency/accessibility pass; missing-workspace recovery zapisane w backlogu |
| 2026-07-28 | Product-wide J0 pass usunął martwy SurfaceSwitcher, wyrównał utility surfaces do przyjętych granic typografii i płaskich powierzchni, domknął focus/semantykę modali oraz dodał jeden real-Electron scenariusz przekrojowy | complete at `786d21e`; `pnpm verify:quality` PASS (desktop 910/910), Electron `14/14`, direct native observation PASS; tylko native-glass accept/defer pozostaje przed J0 closeout |
| 2026-07-28 | Patryk zaakceptował bounded native glass jako końcową korektę J0: natywne macOS vibrancy tylko dla titlebara i Projects, wszystkie powierzchnie treści opaque, fallback opaque poza macOS, bez ustawienia i bez `transparent: true` | production implementation plan ready; resize, native shadow, active/inactive contrast, light/dark backdrop, 1440×900, 1120×720 i xterm identity wymagają osobnej bramki przed J0 closeout |
| 2026-07-28 | Bounded native glass został zaakceptowany po realnej próbie z `transparent: true`: materiał pozostaje wyłącznie w titlebarze i Projects, content jest opaque, resize i natywny cień działają na wspieranym macOS, a intensywność finalna to `0.44` / `0.54` | complete and integrated locally at `22bf219`; `pnpm verify:quality` PASS, Electron `15/15`, final review 0 findings, Patryk accepted; J0 and Phase J closed, Phase Z next and not started, no push |
| 2026-07-28 | Pierwszy post-push Electron smoke ujawnił, że runner macOS poprawnie aktywuje opaque fallback przy `prefers-reduced-transparency`, ale test nadal wymagał translucency; test-only hotfix rozlicza obie poprawne gałęzie bez osłabiania opaque Work/terminal | Phase J published and closed at `3242fc7`; replacement GitHub Actions run `30385887045` PASS (`quality`, `electron-smoke`); branch/worktree removed, Phase Z next and not started |
| 2026-07-29 | Post-closeout calibration przywróciła aktywny charakter natywnej próby, saturację `1.22` i zwiększyła przepuszczalność titlebara/Projects do `0.30` / `0.36`, bez rozszerzania glass na content | accepted and published at `3544486`; focused contract `106/106`, desktop build PASS, GitHub Actions `30403883952` PASS; Phase Z next and not started |
| 2026-07-29 | Phase Z release-readiness rozpisano jako bounded plan: F14 atomic exit reconciliation, recoverable missing-folder state, pełny istniejący quality/Electron gate, direct native observation i jawna akceptacja codziennej wersji | plan ready for Patryk approval; implementation not started; no redesign, Observatory, packaging, updater or new framework |
| 2026-07-29 | Phase Z zamknęła F14 przez atomowy terminal reconcile i dodała odzyskiwalny stan brakującego folderu bez startu PTY; pełny lokalny `pnpm verify`, bezpośrednia obserwacja natywna i post-push CI przeszły, a Patryk zaakceptował wynik jako pierwszą codzienną wersję | complete and published at `2a020a0`; GitHub Actions `30432394289` PASS (`quality`, `electron-smoke`); zero P0/P1 i reprodukowalnych deferred P2; brak zatwierdzonej następnej fazy |

# Alfred Refoundation

Status: draft decyzyjny
Data: 2026-04-27
Zakres: personal cloud first, SaaS-ready later

## 1. Decyzja

Alfred przestaje byc projektem "macOS native app in Rust/Tauri" jako glownym kierunkiem produktu.

Obecny Alfred Lab zostaje traktowany jako prototyp domeny: udowodnil wartosc lokalnej obserwowalnosci agentow, model sesji, hooki Claude Code, widoki Live/Lab oraz kierunek "agent observatory". Nie powinien jednak byc fundamentem docelowej aplikacji desktop/web/mobile.

Nowy kierunek:

- web-first aplikacja produktowa,
- personal cloud jako pierwszy tryb,
- lokalny runner/collector jako most do agentow dzialajacych na komputerze,
- desktop jako wrapper albo lokalny companion, nie jako jedyne centrum produktu,
- mobile jako PWA/Capacitor companion,
- architektura gotowa na pozniejszy tryb team/SaaS,
- Claude Code i Codex dzialaja od pierwszej wersji.

Robocze pozycjonowanie:

> Alfred to osobisty chief of staff dla pracy z agentami kodujacymi: obserwuje, porzadkuje, pamieta, pilnuje kontekstu, lapie ryzyka i pomaga doprowadzac zadania do konca.

Nie budujemy tylko kolejnego dashboardu do logow LLM. Budujemy "The Cave" dla pracy agentowej: miejsce, w ktorym widac misje, agentow, dowody, decyzje, raporty i stan projektu.

## 2. Dlaczego przebudowa

Obecny kod jest dobrym proof of concept, ale ma ograniczenia strategiczne:

- jest silnie zwiazany z macOS i Tauri,
- Rust backend podnosi koszt iteracji produktu,
- aplikacja lokalna utrudnia mobile/web i synchronizacje,
- dane sa zamkniete w lokalnym SQLite,
- obserwowalnosc jest skupiona prawie wylacznie na Claude Code,
- brakuje uniwersalnego modelu "agent source",
- nie ma jasnego podzialu na cloud core, local runner, web app i integracje,
- kierunek "agent command center" wymaga szybciej rozwijanego stacku produktowego.

Rekomendacja: nie przepisywac obecnego Tauri 1:1. Zbudowac nowy rdzen produktu, a obecny projekt wykorzystac jako laboratorium domenowe i kopalnie dobrych pomyslow.

## 3. Zasady produktu

### Personal first, SaaS-ready

Pierwsza wersja ma byc dla jednej osoby i jej projektow. Model danych od razu powinien miec `workspace_id`, `owner_user_id`, `device_id` i granice uprawnien, zeby pozniej nie robic bolesnej migracji na zespoly.

### Agent-neutral

Alfred nie jest "Claude dashboardem" ani "Codex dashboardem". Claude i Codex sa pierwszymi adapterami. Model produktu musi obslugiwac rozne runtime'y:

- Claude Code,
- Codex CLI,
- OpenAI Agents SDK,
- LangGraph/LangChain,
- custom shell agents,
- przyszle narzedzia przez OpenTelemetry albo MCP.

### Observability before orchestration

Najpierw Alfred ma widziec i rozumiec prace agentow. Dopiero potem powinien nimi sterowac.

V1: obserwatorium + task handoff + raporty.

Later: uruchamianie agentow, swarms, reguly, automatyczne retry, agent reputation, evals.

### Human-in-command

Alfred moze proponowac, streszczac, ostrzegac i porzadkowac. Decyzje o wykonaniu ryzykownych akcji powinny byc czytelne i audytowalne.

### Local runner jako granica zaufania

Cloud nie powinien sam czytac lokalnych plikow, sekretow ani historii sesji. Local runner zbiera dane, redaguje je, stosuje polityke prywatnosci i dopiero potem synchronizuje.

### Privacy by design

Domyslnie nie wysylamy pelnych transkryptow i diffow. Wysylamy metadane, statusy, tool summaries, field reports i wybrane fragmenty. Pelna tresc sesji jest opt-in per projekt albo per run.

### Standards-compatible

Alfred powinien umiec mowic jezykiem rynku observability:

- OpenTelemetry GenAI semantic conventions,
- OpenInference,
- trace/span/event model,
- eksport/import przez standardowe formaty tam, gdzie ma to sens.

### Reports over raw chat

Najcenniejszym artefaktem nie jest caly czat agenta. Najcenniejsze sa:

- co agent zrobil,
- czego dotknal,
- jakie decyzje podjal,
- jakie znalazl ryzyka,
- czego nie zdazyl,
- co nastepny agent albo czlowiek powinien wiedziec.

## 4. Non-goals dla V1

V1 nie probuje byc:

- pelnym klonem BridgeMind,
- IDE,
- zamiennikiem Claude Code albo Codex,
- systemem do automatycznego deployowania zmian,
- platforma team/billing/org management,
- chmurowym executor'em kodu bez lokalnego runnera,
- miejscem, ktore domyslnie uploaduje cale prywatne transkrypty,
- narzedziem observability tylko dla requestow API LLM.

## 5. Metafora produktu

Alfred powinien miec dusze pomocnika, nie tylko dashboardu.

Gdy wyobrazamy sobie Alfreda jako pomocnika Batmana, to nie jest on glosnym botem, ktory ciagle gada. To ktos, kto:

- wie, nad czym pracujesz,
- wie, kto co robil,
- przypomina istotne fakty we wlasciwym momencie,
- widzi, ze agent utknal albo zaczal krecic sie w kolko,
- zbiera dowody i raporty,
- pilnuje standardow,
- rozumie, kiedy trzeba wejsc z sugestia, a kiedy nie przeszkadzac,
- pomaga zaczac kolejna sesje bez utraty kontekstu.

Nazwy domenowe moga budowac charakter produktu:

- The Cave - glowny command center,
- Cases - dlugie watki/projekty problemowe,
- Missions - konkretne zadania,
- Field Reports - raporty agentow,
- Evidence Locker - pliki, diffy, logi, zrzuty i decyzje,
- Morning Briefing - co dzisiaj wymaga uwagi,
- Watchtower - alerty i anomalie,
- Context Butler - warstwa pamieci i przypominania.

Trzeba jednak uwazac, zeby styl nie przykryl uzytecznosci. Produkt ma byc elegancki, osobisty i praktyczny.

## 6. Core concepts

### Workspace

Kontener danych. W V1 prawdopodobnie jeden osobisty workspace, ale model danych od razu musi byc wieloworkspace'owy.

### Device

Komputer, na ktorym dziala local runner. Device ma wlasne source adapters, offline outbox, sekrety i polityki prywatnosci.

### Project

Repozytorium albo katalog roboczy. Projekt laczy runy, zadania, raporty, wiedze i ustawienia prywatnosci.

### Case

Dlugotrwaly temat, np. "przebudowa Alfreda na personal cloud". Case moze zawierac wiele missions, runs i field reports.

### Mission

Konkretne zadanie do wykonania. Mission moze byc przypisana czlowiekowi albo agentowi.

### Run

Jedna sesja pracy agenta albo czlowieka. Dla Claude Code to sesja hookow. Dla Codex to thread/session.

### Agent Source

Zrodlo zdarzen, np. `claude-code`, `codex-cli`, `openai-agents-sdk`, `langgraph`, `custom`.

### Span

Jednostka pracy wewnatrz runa. Moze reprezentowac tool call, model call, command, file edit, search, subagent spawn albo etap planu.

### Event

Punktowe zdarzenie w czasie: start, stop, notification, approval request, tool output, error, alert.

### Artifact

Dowod pracy: diff, plik, log, screenshot, test result, link, summary, command output.

### Field Report

Strukturalny raport konczacy run albo etap. Powinien byc latwy do przeczytania przez czlowieka i latwy do uzycia przez kolejnego agenta.

### Knowledge Entry

Trwala informacja projektowa: decyzja, konwencja, ograniczenie, fakt domenowy, ryzyko, instrukcja operacyjna.

### Alert

Sygnal wymagajacy uwagi: agent czeka na input, testy padly, koszt rosnie, loop, podejrzana komenda, schema drift adaptera, brak sync.

## 7. Architektura docelowa

```
Agent runtimes
  Claude Code
  Codex CLI
  OpenAI Agents SDK
  LangGraph / LangChain
  Custom agents

        |
        v

Local runner / collector
  source adapters
  privacy policy
  redaction
  offline outbox
  MCP server

        |
        v

Cloud core
  ingest API
  auth
  database
  object storage
  workers
  realtime events

        |
        v

Clients
  web app
  desktop wrapper
  mobile companion
  MCP clients / agent tools
```

### Cloud core

Odpowiada za:

- auth,
- workspaces,
- projects,
- runs,
- events,
- spans,
- artifacts,
- field reports,
- task board,
- alerts,
- summaries,
- search,
- realtime subscriptions.

### Ingest API

Stabilny endpoint dla local runnera. Przyjmuje znormalizowane zdarzenia Alfreda, nie surowe formaty narzedzi.

Powinien miec:

- idempotency keys,
- batch ingest,
- cursor checkpoints,
- retry-safe behavior,
- schema versioning,
- source capability metadata.

### Workers

Asynchroniczna warstwa przetwarzania:

- streszczenia runow,
- koszt i token usage,
- wykrywanie loopow,
- anomalie,
- field report synthesis,
- knowledge extraction,
- alert rules,
- eval/replay later.

### Web app

Pierwszy pelny klient produktu. Widoki MVP:

- Live - aktywne i ostatnie runy ze wszystkich zrodel,
- Runs - historia i filtry,
- Run detail - timeline, spans, artifacts, reports,
- Missions - task board dla ludzi i agentow,
- Field Reports - raporty z pracy,
- Project Memory - decyzje i wiedza projektowa,
- Settings - privacy, devices, sources.

### Desktop

Nie jako jedyny fundament. Dwie mozliwe sciezki:

- wrapper web app + local runner UX,
- osobny tray/local companion do statusu, powiadomien i kontroli runnera.

### Mobile

Najpierw companion, nie pelny executor:

- powiadomienia,
- review raportow,
- akceptacja prostych decyzji,
- Morning Briefing,
- stan misji,
- szybkie komentarze do taskow.

### Local runner

Najwazniejszy komponent V1 poza web app.

Odpowiada za:

- wykrywanie Claude Code i Codex,
- czytanie lokalnych baz/logow/sesji,
- normalizacje zdarzen,
- redakcje wrazliwych danych,
- offline queue,
- synchronizacje z cloud,
- lokalny MCP server,
- health checks.

Runner powinien byc maly, przewidywalny i latwy do audytu.

### MCP server

MCP jest kluczowy, bo Alfred ma byc uzyteczny dla samych agentow.

Minimalny zestaw narzedzi:

- `alfred_list_missions`,
- `alfred_get_mission`,
- `alfred_claim_mission`,
- `alfred_append_finding`,
- `alfred_submit_field_report`,
- `alfred_mark_review_needed`,
- `alfred_search_project_memory`,
- `alfred_add_knowledge_entry`.

To pozwala agentom pracowac w jednym systemie bez wymuszania jednego runtime'u.

## 8. V1 source adapters

### Claude Code adapter

Status: najpewniejsze zrodlo na start.

Dlaczego:

- obecny projekt ma juz hooki,
- mozemy dostawac zdarzenia blisko realtime,
- mamy model sesji, tool calls, notifications, stop/session end,
- latwo rozszerzyc hooki o field reports i mission metadata.

Zakres:

- session start/end,
- pre/post tool use,
- notifications,
- stop events,
- cost/token estimates tam, gdzie dostepne,
- tool summaries,
- files touched,
- command/test results,
- field reports.

### Codex CLI adapter

Status: wymagany od pierwszej wersji, ale jako defensywny best-effort adapter.

Obecne lokalne zrodla:

- `~/.codex/state_5.sqlite`,
- `~/.codex/logs_2.sqlite`,
- `~/.codex/sessions/**/*.jsonl`.

Przydatne byty z Codex:

- threads jako runy,
- rollout/session path jako zrodlo historii,
- cwd/git metadata jako project mapping,
- model/reasoning effort/provider,
- tokens_used,
- thread_spawn_edges jako relacje parent/child agentow,
- agent jobs i job items tam, gdzie dostepne,
- logs jako diagnostyka.

Ryzyka:

- schemat jest prywatny i moze sie zmienic,
- nie wszystko musi byc realtime,
- czesc tresci sesji moze byc wrazliwa,
- parser JSONL musi byc odporny na zmiany formatu.

Zasady implementacji:

- traktowac Codex jako nieoficjalne zrodlo,
- wykrywac wersje schematu,
- miec source health status,
- nie zakladac, ze tabela albo kolumna istnieje,
- synchronizowac metadane domyslnie,
- pelny transcript tylko opt-in,
- nie blokowac calego runnera, jesli Codex adapter sie wysypie.

## 9. Adapter contract

Docelowo kazde zrodlo powinno implementowac podobny kontrakt:

```ts
type AgentSourceId =
  | "claude-code"
  | "codex-cli"
  | "openai-agents-sdk"
  | "langgraph"
  | "custom";

interface AgentSourceAdapter {
  sourceId: AgentSourceId;
  displayName: string;
  capabilities: SourceCapabilities;

  discoverProjects(): Promise<ProjectDiscovery[]>;
  discoverRuns(cursor?: SourceCursor): Promise<RunDiscoveryPage>;
  readRun(sourceRunId: string): Promise<SourceRun>;
  readEvents(sourceRunId: string, cursor?: SourceCursor): Promise<SourceEventPage>;
  readArtifacts(sourceRunId: string): Promise<SourceArtifact[]>;
  normalize(input: SourceEvent): AlfredEvent[];
  healthCheck(): Promise<SourceHealth>;
}
```

Wazne: adapter zwraca znormalizowane eventy Alfreda. UI i cloud core nie powinny znac szczegolow `state_5.sqlite`, hookow Claude ani formatu JSONL.

## 10. Model danych

Minimalny rdzen:

- `users`,
- `workspaces`,
- `workspace_members`,
- `devices`,
- `projects`,
- `cases`,
- `missions`,
- `runs`,
- `run_relations`,
- `spans`,
- `events`,
- `artifacts`,
- `field_reports`,
- `knowledge_entries`,
- `alerts`,
- `usage_records`,
- `source_cursors`,
- `source_health_checks`,
- `audit_log`.

### Runs

Run powinien miec:

- `id`,
- `workspace_id`,
- `project_id`,
- `device_id`,
- `source_id`,
- `source_run_id`,
- `parent_run_id`,
- `status`,
- `title`,
- `cwd`,
- `git_branch`,
- `git_sha`,
- `model`,
- `reasoning_effort`,
- `started_at`,
- `ended_at`,
- `last_seen_at`,
- `privacy_mode`,
- `summary`,
- `raw_ref` tylko jezeli dozwolone.

### Events

Event powinien miec:

- `id`,
- `workspace_id`,
- `run_id`,
- `span_id`,
- `source_event_id`,
- `type`,
- `severity`,
- `occurred_at`,
- `payload`,
- `redaction_state`,
- `ingested_at`.

### Field reports

Field report powinien byc strukturalny:

- `mission_id`,
- `run_id`,
- `agent_source`,
- `summary`,
- `completed_work`,
- `files_touched`,
- `commands_run`,
- `tests_run`,
- `decisions`,
- `risks`,
- `blockers`,
- `next_steps`,
- `confidence`,
- `needs_human_review`.

To jest glowny format przekazywania kontekstu miedzy agentami.

## 11. Privacy modes

### Minimal

Do cloud trafia:

- run metadata,
- status,
- czas,
- project mapping,
- model/source,
- high-level summaries,
- alerty.

Nie trafia:

- pelny transcript,
- command outputs,
- diffy,
- fragmenty plikow.

### Standard

Domyslny tryb.

Do cloud trafia:

- wszystko z Minimal,
- tool summaries,
- field reports,
- lista plikow dotknietych przez agenta,
- wynik testow w formie summary,
- wybrane krotkie fragmenty po redakcji,
- artifacts tylko z allowlisty.

### Full

Opt-in per project albo per run.

Do cloud moze trafic:

- pelny transcript,
- diff,
- command output,
- wieksze artifacts.

Full mode musi miec bardzo czytelne oznaczenie w UI.

## 12. MVP 0

Cel: udowodnic, ze Alfred jest jednym centrum dla Claude i Codex, dziala przez cloud sync i realnie pomaga w pracy osobistej.

Zakres produktowy:

- personal account/workspace,
- local runner z Claude Code adapterem,
- local runner z Codex CLI adapterem,
- cloud ingest API,
- offline outbox,
- web app z widokami Live, Runs, Run detail, Missions, Field Reports,
- MCP server dla agentow,
- podstawowy Project Memory,
- standard privacy mode,
- manual mission creation,
- agent field reports.

Kryteria sukcesu:

- widac sesje Claude i Codex w jednym Live view,
- Codex threads mapuja sie na runy,
- Codex spawn edges mapuja sie na relacje runow, jesli sa dostepne,
- Claude hook events i Codex events trafiaja do tego samego modelu,
- agent moze pobrac mission przez MCP,
- agent moze zapisac finding i field report,
- cloud sync dziala po przerwie internetu,
- domyslny sync nie wysyla pelnych transcriptow,
- run detail pozwala szybko zrozumiec "co sie stalo".

## 13. MVP 1

Po MVP 0:

- mobile PWA,
- push notifications,
- Morning Briefing,
- Watchtower alerts,
- bardziej zaawansowany Project Memory,
- cost dashboard,
- search across reports/artifacts,
- approval inbox,
- per-project privacy policies,
- import/export OpenTelemetry/OpenInference,
- lepszy Codex JSONL parser,
- Claude field report hook template,
- basic agent reputation.

## 14. Later

Pozniejsze kierunki:

- uruchamianie agentow z UI,
- orchestration plans,
- agent swarms,
- evals i replay,
- team workspaces,
- role-based access control,
- billing,
- shared project memory,
- policy engine,
- integrations z GitHub/GitLab/Linear/Jira,
- hosted runners dla bezpiecznych sandboxow,
- agent marketplace/integration registry.

## 15. Stack rekomendowany

Rekomendacja kierunkowa na start:

- TypeScript monorepo,
- web app jako glowny klient,
- backend API w tym samym ekosystemie TS,
- Postgres jako baza,
- object storage na artifacts,
- realtime przez WebSocket/SSE,
- local runner w TypeScript albo Go,
- MCP server w runnerze,
- desktop wrapper dopiero po stabilizacji web/local runner,
- mobile jako PWA najpierw, Capacitor pozniej.

Najwazniejsze nie jest wybranie modnego frameworka. Najwazniejsze jest utrzymanie czystych granic:

- `apps/web`,
- `apps/api`,
- `apps/runner`,
- `packages/schema`,
- `packages/adapters`,
- `packages/mcp`,
- `packages/sdk`,
- `packages/ui`.

## 16. Inspiracje rynkowe

Narzedzia observability i agent tooling:

- Langfuse - https://langfuse.com/docs/observability/overview
- Arize Phoenix - https://arize.com/docs/phoenix
- OpenInference - https://arize-ai.github.io/openinference/
- LangSmith - https://www.langchain.com/langsmith-platform
- Helicone - https://docs.helicone.ai/getting-started/platform-overview
- AgentOps - https://docs.agentops.ai/
- OpenTelemetry GenAI semantic conventions - https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
- OpenAI Agents SDK tracing - https://openai.github.io/openai-agents-js/guides/tracing
- Claude Agent SDK observability - https://code.claude.com/docs/en/agent-sdk/observability

Inspiracja produktem szerszym niz observability:

- BridgeMind - https://www.bridgemind.ai/

Wniosek:

- observability tools sa dobre w trace/cost/debug,
- BridgeMind pokazuje kierunek osobistej warstwy pamieci i workflow,
- Alfred powinien polaczyc oba swiaty dla pracy developer-agentowej: observability + command center + project memory + MCP-native workflow.

## 17. Najwieksze ryzyka

### Schema drift Codex

Codex adapter bazuje na lokalnych, nieoficjalnych strukturach. Trzeba go izolowac, testowac i oznaczac jako best-effort.

### Prywatnosc

Agent sessions moga zawierac sekrety, prywatne notatki, kod klientow i dane osobowe. Redakcja i privacy mode nie sa dodatkiem. To fundament.

### Zbyt szeroki scope

"Alfred z dusza" latwo moze urosnac do wszystkiego naraz. MVP musi byc waskie:

- collect,
- normalize,
- sync,
- show,
- report,
- remember.

### Local runner security

Runner bedzie blisko plikow, logow i narzedzi. Musi miec proste uprawnienia, dobry audit log i jasne ustawienia.

### Mobile expectations

Mobile nie powinno udawac pelnego lokalnego obserwatorium. Mobile ma byc companionem: review, alerts, briefings, lightweight decisions.

### Orchestration too early

Sterowanie agentami przed dobrym modelem obserwowalnosci stworzy chaos. Najpierw trzeba widziec prawde o pracy agentow.

## 18. Pierwszy plan wykonawczy

1. Utworzyc nowy monorepo albo nowy katalog `refoundation/` jako eksperyment.
2. Zdefiniowac shared schema: runs, events, spans, reports, missions.
3. Zbudowac minimalny cloud ingest z lokalnym dev Postgres.
4. Zbudowac local runner z outboxem.
5. Dodac Claude adapter.
6. Dodac Codex adapter read-only.
7. Zbudowac web Live view.
8. Dodac run detail.
9. Dodac MCP tools dla missions i field reports.
10. Przeprowadzic dogfooding na tym repo.

Rekomendacja praktyczna: zaczac od nowego kodu, ale trzymac obecny Alfred Lab obok jako referencje domenowa.

## 19. Definition of done dla refoundation MVP

MVP mozna uznac za sensownie domkniety, gdy:

- Alfred pokazuje Claude i Codex w jednej osi czasu,
- mozna wejsc w run i zrozumiec jego przebieg bez czytania calego transkryptu,
- agent moze pobrac zadanie przez MCP,
- agent moze oddac field report,
- raport jest widoczny w web app,
- local runner synchronizuje po offline,
- privacy standard nie wysyla pelnych transcriptow,
- architektura pozwala dodac trzecie zrodlo bez przebudowy UI,
- system jest uzywany przez nas samych do dalszego rozwoju Alfreda.

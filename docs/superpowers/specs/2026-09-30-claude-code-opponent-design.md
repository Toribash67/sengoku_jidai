# Claude Code opponent

_Design — 2026-09-30_

Let a live **Claude Code session** play one seat of an online game against a human
in the web app. The human creates an online game as usual, copies the opponent's
invite link, and runs `/play-sengoku <link>` in Claude Code. Claude joins the seat,
waits for its turns, reads the board, picks orders, and chats in the in-game log.

## Goals and non-goals

**Goals**

- A human can play a full game against a Claude Code session, on prod or local.
- Claude only ever sees its own seat's view (same hidden-information surface as the
  web client) and only submits player intent through the existing API.
- Claude cannot submit malformed commands; argument mistakes are caught locally
  with a clear message before anything is sent.
- Cheap per-turn context: compact text, not raw view JSON.

**Non-goals**

- No server, engine, or web changes. No new opponent option on the create screen
  (reuse the online-invite flow). No Anthropic API key on the server.
- No MCP server. No websockets (polling is fine at human pace).
- Not trying to make Claude strong via tooling — strength is Claude's own reasoning
  guided by the skill's rules primer.

## Setup flow

1. Human creates an online (`private_multiplayer`) game in the web app.
2. Human copies the opponent seat's invite link: `https://<host>/g/<gameId>#<token>`.
3. Human runs `/play-sengoku <link>` in a Claude Code session in this repo.
4. The skill runs `corepack pnpm sengoku join <link> --name Claude`, greets in
   chat, then enters the turn loop.

## Components

### 1. `packages/claude-player` (new package)

A Node CLI, exposed at the repo root as `corepack pnpm sengoku <subcommand>`.

**Package boundary:** imports only `@sengoku-jidai/shared` and
`@sengoku-jidai/engine/client` — the same client-safe surface the web uses. Add an
ESLint `boundary(...)` entry enforcing this (no root `@sengoku-jidai/engine`, no
`server`, `ai`, `web`, `board-render`, `terrain`).

**Internal units** (each a pure module with its own tests, except `api` / `cli`):

| Module         | Responsibility                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `link.ts`      | Parse `…/g/<gameId>#<token>` → `{ baseUrl, gameId, token }`; reject anything else.               |
| `session.ts`   | Read/write `~/.sengoku/session.json` (one current game).                                         |
| `api.ts`       | Thin `fetch` client: claim, get view, submit command, events after, chat after/post. Bearer auth. |
| `orders.ts`    | `PlayerGameView` → numbered `Order[]`; `Order` + CLI args → validated `Command` or local error.   |
| `board.ts`     | `PlayerGameView` + compiled map → board text (header, area lines, pending combat/decision).     |
| `events.ts`    | `PlayerGameEvent` → one-line text; unknown types fall back to `type + JSON`.                     |
| `cli.ts`       | Argument parsing, subcommand dispatch, exit codes.                                               |

### 2. Skill `.claude/skills/play-sengoku/`

- `SKILL.md` — invocation (`/play-sengoku <invite-link>`), the turn loop, error
  handling, play guidance, chat etiquette.
- `rules.md` — concise rules primer written from `packages/engine/src/rules.ts` and
  `cards.ts`: action types, supply, combat and dice, forts and Ambush, the 8
  operation cards, commanders per round, scoring and the round limit.

## CLI subcommands

All subcommands except `join` read the session file; missing session → exit 1 with
"run `sengoku join <link>` first".

| Subcommand                       | Behaviour                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `join <link> [--name Claude]`    | Parse link, `POST /claim`, fetch + cache the map, write session, print `status`.                              |
| `status`                         | Fetch view, print board text + numbered orders (or "Not your turn — opponent is on the clock.").              |
| `wait [--timeout 540]`           | Poll until Claude has orders / game over / timeout; print new events + chat (see Turn loop).                  |
| `play <n> [--from …] [--place …] [--bonus k]` | Build + locally validate the command for order `n`, submit, print resulting events and new `status`. |
| `say "<text>"`                   | Post a chat message.                                                                                         |

### Exit codes

| Code | Meaning                                                                          |
| ---- | -------------------------------------------------------------------------------- |
| 0    | Success / it is Claude's turn (`wait`).                                          |
| 1    | Local error (bad args, no session, argument over a limit). Nothing submitted.    |
| 2    | Game over (`wait`, `status`, `play`). Final result printed.                      |
| 3    | `wait` timed out with the opponent still on the clock — call `wait` again.       |
| 4    | Server rejected the command or the revision was stale — re-run `status`.         |
| 5    | Auth failure (401/403) — seat token invalid; rejoin with a fresh link.           |

## Orders (numbering and arguments)

`orders.ts` flattens `view.legal` (`LegalCommandSummary`) and `view.pendingDecision`
into a stable, numbered list. Numbering is recomputed on every `status`/`play`
from the current view, so `play <n>` always re-derives the list and refuses (exit 4)
if the view's revision differs from the one `status` last printed (stored in the
session) — preventing "order 7 meant something else".

| Order kind          | Source                              | Arguments                               | Command built                           |
| ------------------- | ----------------------------------- | --------------------------------------- | --------------------------------------- |
| Advance / Sail      | `legal.moves[]`                     | `--from A:n,B:m` (≥1 source, n ≤ `max`) | `advance`/`sail` `{spaceId, moves}`     |
| Bombard / Shell     | `legal.strikes[]` × each target     | none                                    | `{spaceId, targetAreaId}`               |
| Reinforce / Embark  | `legal.placements[]`                | `--place A:n,…` (targets only, Σ ≤ `min(pool, reserve)`, Σ ≥ 1) | `{spaceId, placements}` |
| Plan                | `legal.plans[]`                     | none                                    | `plan {spaceId}`                        |
| Card play           | `legal.cardPlays[]` × each option   | as for its action, plus `--bonus k` (≤ `bonusMax`) where offered | action command + `card` (+ `cardBonus`) |
| Combat roll         | `legal.canRollCombat`               | none                                    | `combatRoll {pendingId}`                |
| Ambush roll         | `legal.canAmbush`                   | none                                    | `combatRoll {pendingId, card: ambush}`  |
| Reroll              | `legal.canRerollCombat` × each card | none                                    | `combatReroll {pendingId, card}`        |
| Resolve combat      | `legal.canResolveCombat`            | none                                    | `combatResolve {pendingId}`             |
| Pending decision    | `view.pendingDecision.choices[]` (when `seat` = viewer) | none            | `choosePendingDecision {pendingId, choice}` |
| Pass                | `legal.canPass`                     | none                                    | `pass`                                  |

Exact card/combat field mapping follows what the web client sends for the same
action (read `packages/web` command builders during implementation and mirror
them; add a test per card-play kind).

Each order line shows its limits, e.g.

```
 4. Advance into L7  (sources: L3 up to 2, L9 up to 1)        → play 4 --from L3:2,L9:1
 9. Reinforce (pool 3, reserve 5) targets: L3, L9, L12        → play 9 --place L3:2,L12:1
12. [card: Ground Assault] Advance into L7 (+up to 2 bonus)    → play 12 --from L3:2 --bonus 2
15. Bombard from S2 → L7 (3 dice)                             → play 15
20. Pass                                                      → play 20
```

Local validation errors (exit 1) name the violated limit ("L3 allows at most 2",
"L5 is not a legal source for order 4", "order 9 places at most 3"). The server
remains authoritative; a server rejection prints its error message (exit 4).

Every submission uses the existing `POST /api/games/:id/commands` with
`baseRevision` = view revision and a fresh `clientCommandId` (UUID).

**"Is it Claude's turn"** = the order list is non-empty. This covers normal turns,
pending decisions, and combat rolls owed on the opponent's turn (defence rolls),
without duplicating clock logic.

## Board text

The CLI fetches `GET /api/maps/:mapId` once on `join`, compiles it with
`compileHexMap` (engine/client), and caches the compiled kinds + adjacency in the
session file.

`status` prints:

1. **Header** — round X/Y, phase, initiative, whose turn, VP (both seats),
   commanders remaining/total (both seats), Claude's hand (card names + short
   effect), opponent hand count.
2. **Areas**, one line each, grouped land then water:
   `L7 land ★2 fort harbor bonus:barracks | red | 3 troops 1 siege | supply: red | adj: L3, L9, S2`
   (empty/neutral areas still listed, compactly).
3. **Pending combat / combat queue / pending decision**, spelled out (attacker,
   defender, area, dice state).
4. **Numbered orders** (or the not-your-turn line).

Area ids are Claude-internal; the skill forbids using them in chat.

## Turn loop (`wait`)

- Poll `GET /api/games/:id` every 2 s (network errors retried with backoff, never
  fatal inside `wait`).
- When the view's revision changes, fetch `GET /events?after=<lastSeenRevision>`
  and `GET /chat?after=<lastChatId>`, print them, and update the session's
  `lastSeenRevision` / `lastChatId`.
- Exit 0 when the order list is non-empty; exit 2 on `status` of `"complete"` or `"abandoned"` (prints
  winner + end reason + final VP); exit 3 after `--timeout` seconds (default 540,
  under Claude Code's 10-minute Bash limit).
- Chat from the opponent is printed even while waiting continues, so Claude can
  reply on its next turn.

## Skill behaviour

- Join; greet briefly in chat.
- Loop: `wait` (repeat on exit 3) → `status` → reason about the position using
  `rules.md` → `play` (optionally `say`) → back to `wait`. On exit 4 re-run `status`;
  on exit 1 fix the arguments; on exit 5 stop and ask the human for a fresh link.
- On exit 2: short "gg" + one-line recap in chat, then report the result to the
  human in the terminal.
- Etiquette: never mention raw area ids in chat (describe places in words), keep
  chat short and occasional, reply when spoken to.

## Testing

- **Unit (vitest, pure):** `link` parsing; `orders` numbering + argument validation
  + command building (fixtures from real `playerView(state, seat)` output built via
  engine test helpers, one per order kind incl. each card-play kind and combat
  steps); `board` text snapshot for the Rivers start position; `events` formatter
  covers every `GameEvent` type or its fallback.
- **Integration:** start the real Fastify app in-process on a temp SQLite DB, create
  a private game, `join` both seats (two session files via an override path), and
  drive a full game where each seat plays "first order with minimal legal
  arguments" through the CLI's own modules until game over. Asserts: no rejected
  commands, game reaches `status: "complete"`.
- **Manual:** one real game against prod before merge.
- Full gate per AGENTS.md: typecheck, test, lint, prettier, build. No Docker change
  (the package is not part of the server image), but confirm the Dockerfile's
  workspace install still builds.

## Risks

- **Card/command mapping drift** — mitigated by mirroring the web's builders and a
  test per card-play kind; the integration game exercises the common path.
- **Context growth over a long game** — board text is compact; the skill keeps its
  reasoning per turn and does not re-read `rules.md` every turn.
- **Custom maps with many areas** — area lines stay one per area; acceptable.

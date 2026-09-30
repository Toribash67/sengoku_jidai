# Claude Code Opponent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a live Claude Code session play one seat of an online game via a `sengoku` CLI (new package `packages/claude-player`) and a `/play-sengoku` skill.

**Architecture:** The CLI is a thin client of the existing seat-token HTTP API. Pure modules turn a `PlayerGameView` into numbered orders (`orders.ts`), board text (`board.ts`) and event lines (`events.ts`); `api.ts` + `session.ts` handle HTTP and the local session file; `commands.ts` implements `join/status/play/wait/say` as testable functions returning exit codes; `cli.ts` is the process entry. No server, engine or web changes.

**Tech Stack:** TypeScript (NodeNext ESM), Node 22 `fetch` + `node:util` `parseArgs`, vitest, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-30-claude-code-opponent-design.md`

## Global Constraints

- `packages/claude-player/src` imports only `@sengoku-jidai/shared` and `@sengoku-jidai/engine/client` (never root `@sengoku-jidai/engine`, never server/ai/web/board-render/terrain). Tests may import root `@sengoku-jidai/engine` and `../../server/src/app.js`.
- Clients submit player intent only: every command goes through `POST /api/games/:id/commands` with `baseRevision` and a fresh `clientCommandId`.
- Exit codes: 0 ok / your turn, 1 local error (nothing submitted), 2 game over, 3 `wait` timed out, 4 server rejected or stale revision, 5 auth failure (401/403).
- Session file default `~/.sengoku/session.json`; override with env `SENGOKU_SESSION` or `--session <path>`.
- `wait` default timeout 540 s, poll interval 2000 ms.
- Invoked as `corepack pnpm -s sengoku <subcommand>` (root script → `node packages/claude-player/dist/cli.js`).
- Chat never contains raw area ids (skill rule).
- Use `corepack pnpm …`. Never touch port 18081 (live prod container) in tests.
- Rebuild libs (`corepack pnpm build:libs`) before filtered test runs — packages consume each other's `dist`.

## Review Focus

1. **Stale order numbers** — Claude runs `status`, the game advances, then `play 3`: must exit 4 and submit nothing. → Task 4 test "play refuses when the game moved on".
2. **Invite-link variants** — trailing slash, surrounding quotes/angle brackets/whitespace, `http://localhost:…`, percent-encoded id, missing `#token`: first four parse, the last errors clearly. → Task 1 tests.
3. **Allocation mistakes** — duplicate area (`L3:1,L3:1` sums), count 0, non-numeric, area not offered, total above `min(pool, reserve)`, `--bonus` above `bonusMax` or on a card without bonus: local exit 1 naming the limit. → Task 2 tests.
4. **Server blip during `wait`** — a fetch that throws (network) must not end `wait`; it retries until the turn arrives. → Task 4 test "wait survives a network error".
5. **Game already over** — `status`, `play`, `wait` on a complete game exit 2 with the result, never 0/1. → Task 4 test "commands report game over".

---

## File Structure

```
packages/claude-player/
  package.json            # @sengoku-jidai/claude-player, bin-less; root script runs dist/cli.js
  tsconfig.json           # typecheck src + test (noEmit)
  tsconfig.build.json     # emit src → dist
  src/
    link.ts               # parseInviteLink
    orders.ts             # listOrders, buildCommand, formatOrder, parseAllocation
    board.ts              # renderBoard, CARD_TEXT
    events.ts             # formatEvent
    session.ts            # Session, load/save, defaultSessionPath
    api.ts                # createApi, ApiError
    commands.ts           # runJoin/runStatus/runPlay/runWait/runSay, EXIT, Ctx
    main.ts               # main(argv, ctx) argument parsing + dispatch
    cli.ts                # process entry
  test/
    link.test.ts
    orders.test.ts
    board.test.ts
    events.test.ts
    commands.test.ts      # integration: real Fastify app on 127.0.0.1:0
    helpers.ts            # view fixtures
.claude/skills/play-sengoku/SKILL.md
.claude/skills/play-sengoku/rules.md
eslint.config.js          # + boundary for packages/claude-player/src
package.json              # + "sengoku" script, claude-player in build:libs
Dockerfile                # + COPY claude-player/package.json in runtime stage
```

---

### Task 1: Package scaffold, invite-link parser, lint boundary

**Files:**
- Create: `packages/claude-player/package.json`, `tsconfig.json`, `tsconfig.build.json`, `src/link.ts`, `test/link.test.ts`
- Modify: `package.json` (root), `eslint.config.js`, `Dockerfile`

**Interfaces:**
- Produces: `parseInviteLink(raw: string): InviteLink`, `interface InviteLink { baseUrl: string; gameId: string; token: string }`, `class LinkError extends Error`.

- [ ] **Step 1: Scaffold the package**

`packages/claude-player/package.json`:

```json
{
  "name": "@sengoku-jidai/claude-player",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@sengoku-jidai/engine": "workspace:*",
    "@sengoku-jidai/shared": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

`packages/claude-player/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`packages/claude-player/tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

Root `package.json`: append `--filter @sengoku-jidai/claude-player` to the `build:libs` filter list (after `@sengoku-jidai/ai`), and add the script:

```json
"sengoku": "node packages/claude-player/dist/cli.js",
```

`Dockerfile` runtime stage: after `COPY packages/ai/package.json ./packages/ai/package.json` add

```dockerfile
COPY packages/claude-player/package.json ./packages/claude-player/package.json
```

(the prod install needs every workspace importer present; nothing from its `dist` is copied — the server does not use it).

Run: `corepack pnpm install` — expected: lockfile gains the `packages/claude-player` importer.

- [ ] **Step 2: Add the lint boundary**

In `eslint.config.js`, next to the other `boundary(...)` entries:

```js
  boundary("packages/claude-player/src", [
    {
      group: [
        "@sengoku-jidai/*",
        "@sengoku-jidai/*/**",
        "!@sengoku-jidai/shared",
        "!@sengoku-jidai/engine/client"
      ],
      message:
        "claude-player is an API client: import only @sengoku-jidai/shared and @sengoku-jidai/engine/client."
    }
  ]),
```

- [ ] **Step 3: Write the failing link tests**

`packages/claude-player/test/link.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LinkError, parseInviteLink } from "../src/link.js";

describe("parseInviteLink", () => {
  it("parses a prod invite link", () => {
    expect(parseInviteLink("https://sengoku.example.com/g/abc-123#tok_secret")).toEqual({
      baseUrl: "https://sengoku.example.com",
      gameId: "abc-123",
      token: "tok_secret"
    });
  });

  it("tolerates whitespace, quotes, angle brackets and a trailing slash", () => {
    for (const raw of [
      "  https://h.example/g/abc/#tok \n",
      '"https://h.example/g/abc#tok"',
      "'https://h.example/g/abc#tok'",
      "<https://h.example/g/abc#tok>"
    ]) {
      expect(parseInviteLink(raw)).toEqual({
        baseUrl: "https://h.example",
        gameId: "abc",
        token: "tok"
      });
    }
  });

  it("keeps a local host and port, and decodes the id", () => {
    expect(parseInviteLink("http://localhost:5173/g/a%20b#t")).toEqual({
      baseUrl: "http://localhost:5173",
      gameId: "a b",
      token: "t"
    });
  });

  it("keeps a path prefix in the base url", () => {
    expect(parseInviteLink("https://h.example/sengoku/g/abc#t").baseUrl).toBe(
      "https://h.example/sengoku"
    );
  });

  it("rejects a link without a token", () => {
    expect(() => parseInviteLink("https://h.example/g/abc")).toThrow(LinkError);
    expect(() => parseInviteLink("https://h.example/g/abc")).toThrow(/seat token/);
  });

  it("rejects non-invite urls and garbage", () => {
    expect(() => parseInviteLink("https://h.example/maps#t")).toThrow(LinkError);
    expect(() => parseInviteLink("not a url")).toThrow(LinkError);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `corepack pnpm --filter @sengoku-jidai/claude-player test`
Expected: FAIL — cannot find `../src/link.js`.

- [ ] **Step 5: Implement `src/link.ts`**

```ts
/** A seat invite link, `https://<host>[/prefix]/g/<gameId>#<seatToken>`, split into parts. */
export interface InviteLink {
  baseUrl: string;
  gameId: string;
  token: string;
}

export class LinkError extends Error {}

export function parseInviteLink(raw: string): InviteLink {
  const trimmed = raw.trim().replace(/^["'<]+|["'>]+$/g, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new LinkError(`Not a URL: ${raw.trim()}`);
  }
  const match = /^(.*)\/g\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) {
    throw new LinkError("Expected an invite link like https://host/g/<gameId>#<token>.");
  }
  const token = decodeURIComponent(url.hash.replace(/^#/, ""));
  if (!token) {
    throw new LinkError("The invite link is missing its seat token (the part after #).");
  }
  return {
    baseUrl: `${url.origin}${match[1]}`,
    gameId: decodeURIComponent(match[2]!),
    token
  };
}
```

- [ ] **Step 6: Run tests, typecheck, lint**

Run: `corepack pnpm --filter @sengoku-jidai/claude-player test && corepack pnpm --filter @sengoku-jidai/claude-player typecheck && corepack pnpm lint`
Expected: PASS, no type errors, no lint errors.

Boundary check: temporarily add `import "@sengoku-jidai/engine";` to `src/link.ts`, run `corepack pnpm exec eslint packages/claude-player/src/link.ts` → expected error with the claude-player message; add `import "@sengoku-jidai/engine/client";` instead → no error. Remove both lines.

- [ ] **Step 7: Commit**

```bash
git add packages/claude-player package.json pnpm-lock.yaml eslint.config.js Dockerfile
git commit -m "feat(claude-player): scaffold package with invite-link parser"
```

---

### Task 2: Numbered orders (`orders.ts`)

**Files:**
- Create: `packages/claude-player/src/orders.ts`, `test/helpers.ts`, `test/orders.test.ts`

**Interfaces:**
- Consumes: engine/client types `Command`, `LegalMove`, `LegalPlacement`, `LegalStrike`, `OperationCard`, `PlayerGameView`, `SeatId`.
- Produces:
  ```ts
  export type OrderTemplate =
    | { kind: "move"; type: "advance" | "sail"; spaceId: string; targetAreaId: string;
        sources: { areaId: string; max: number }[]; card?: OperationCard; bonusMax?: number }
    | { kind: "placement"; type: "reinforce" | "embark"; spaceId: string; unit: "troop" | "ship";
        targets: string[]; limit: number; pool: number; reserve: number; card?: OperationCard }
    | { kind: "fixed"; command: Command };
  export interface Order { n: number; label: string; template: OrderTemplate }
  export interface OrderArgs { from?: string; place?: string; bonus?: number }
  export class OrderArgError extends Error {}
  export function listOrders(view: PlayerGameView): Order[];
  export function buildCommand(order: Order, args: OrderArgs): Command;
  export function formatOrder(order: Order): string;
  export function parseAllocation(raw: string): Map<string, number>;
  ```

- [ ] **Step 1: Write test helpers**

`packages/claude-player/test/helpers.ts`:

```ts
import {
  createInitialState,
  playerView,
  type GameState,
  type OperationCard,
  type PlayerGameView
} from "@sengoku-jidai/engine";

/** A fresh Rivers game with `cards` forced into the active seat's hand. */
export function openingState(seed = "cp", cards: OperationCard[] = []): GameState {
  const base = createInitialState({ gameId: "claude-player", seed });
  const seat = base.activeSeat;
  return {
    ...base,
    players: { ...base.players, [seat]: { ...base.players[seat], hand: cards } }
  } as GameState;
}

export function activeView(state: GameState): PlayerGameView {
  return playerView(state, state.activeSeat);
}

/** A view whose legal summary is empty — base for hand-built order fixtures. */
export function emptyLegalView(state: GameState): PlayerGameView {
  const view = activeView(state);
  return {
    ...view,
    legal: {
      ...view.legal,
      canPass: false,
      moves: [],
      strikes: [],
      placements: [],
      plans: [],
      cardPlays: [],
      canRollCombat: false,
      canResolveCombat: false,
      canRerollCombat: false,
      canAmbush: false
    },
    pendingDecision: null,
    pendingCombat: null
  };
}
```

- [ ] **Step 2: Write the failing order tests**

`packages/claude-player/test/orders.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { playerView, resolveCommand, type PendingCombat } from "@sengoku-jidai/engine";
import {
  OrderArgError,
  buildCommand,
  formatOrder,
  listOrders,
  parseAllocation,
  type Order
} from "../src/orders.js";
import { activeView, emptyLegalView, openingState } from "./helpers.js";

/** Minimal legal args for an order: 1 unit from/into the first offered area. */
function minimalArgs(order: Order) {
  const t = order.template;
  if (t.kind === "move") return { from: `${t.sources[0]!.areaId}:1` };
  if (t.kind === "placement") return { place: `${t.targets[0]!}:1` };
  return {};
}

const combat: PendingCombat = {
  id: "pc-1",
  kind: "advance",
  attacker: "black",
  defender: "red",
  responsibleSeat: "red",
  phase: "awaiting-roll",
  area: "L7",
  unit: "troop",
  attackers: 3,
  defenders: 2
};

describe("listOrders", () => {
  it("numbers orders from 1 and ends with pass on a normal turn", () => {
    const orders = listOrders(activeView(openingState()));
    expect(orders.length).toBeGreaterThan(1);
    expect(orders.map((o) => o.n)).toEqual(orders.map((_, i) => i + 1));
    expect(orders.at(-1)!.template).toEqual({ kind: "fixed", command: { type: "pass" } });
  });

  it("is empty for the seat that is not on the clock", () => {
    const state = openingState();
    const other = state.activeSeat === "red" ? "black" : "red";
    expect(listOrders(playerView(state, other))).toEqual([]);
  });

  it("every order on the opening turn (with all 8 cards) builds a command the engine accepts", () => {
    const state = openingState("cp-all", [
      "ambush",
      "commandeer",
      "counterattack",
      "ground_assault",
      "mobilise",
      "river_assault",
      "ship_strike",
      "shore_strike"
    ]);
    const orders = listOrders(activeView(state));
    expect(orders.some((o) => o.label.includes("mobilise"))).toBe(true);
    for (const order of orders) {
      const command = buildCommand(order, minimalArgs(order));
      const result = resolveCommand(state, { seat: state.activeSeat }, command);
      expect(result.status, `${order.label} → ${JSON.stringify(command)}`).toBe("accepted");
    }
  });

  it("offers roll, ambush and nothing else while a defence roll is owed", () => {
    const base = emptyLegalView(openingState("cp", ["ambush", "mobilise"]));
    const view = {
      ...base,
      pendingCombat: combat,
      legal: { ...base.legal, canRollCombat: true, canAmbush: true }
    };
    const orders = listOrders(view);
    expect(orders.map((o) => buildCommand(o, {}))).toEqual([
      { type: "combatRoll", pendingId: "pc-1" },
      { type: "combatRoll", pendingId: "pc-1", card: "ambush" }
    ]);
  });

  it("offers one reroll per distinct card in hand, then resolve", () => {
    const base = emptyLegalView(openingState("cp", ["mobilise", "mobilise", "ambush"]));
    const view = {
      ...base,
      pendingCombat: { ...combat, phase: "rolled" as const, rolls: [3, 5], total: 8 },
      legal: { ...base.legal, canRerollCombat: true, canResolveCombat: true }
    };
    expect(view.hand).toEqual(["mobilise", "mobilise", "ambush"]);
    const commands = listOrders(view).map((o) => buildCommand(o, {}));
    expect(commands).toEqual([
      { type: "combatReroll", pendingId: "pc-1", card: "mobilise" },
      { type: "combatReroll", pendingId: "pc-1", card: "ambush" },
      { type: "combatResolve", pendingId: "pc-1" }
    ]);
  });

  it("turns a pending decision for this seat into one order per choice", () => {
    const base = emptyLegalView(openingState());
    const view = {
      ...base,
      pendingDecision: {
        id: "pd-1",
        seat: base.viewerSeat,
        prompt: "Ship Strike: shell again?",
        choices: [
          { id: "S3", label: "Shell S3" },
          { id: "decline", label: "Decline" }
        ],
        kind: "shipStrike" as const,
        spaceId: "shell-L4"
      }
    };
    const orders = listOrders(view);
    expect(orders.map((o) => o.label)).toEqual([
      "Ship Strike: shell again? → Shell S3",
      "Ship Strike: shell again? → Decline"
    ]);
    expect(buildCommand(orders[1]!, {})).toEqual({
      type: "choosePendingDecision",
      pendingId: "pd-1",
      choice: { id: "decline", label: "Decline" }
    });
  });

  it("ignores a pending decision that belongs to the opponent", () => {
    const base = emptyLegalView(openingState());
    const other = base.viewerSeat === "red" ? "black" : "red";
    const view = {
      ...base,
      pendingDecision: { id: "pd-1", seat: other, prompt: "p", choices: [{ id: "x", label: "X" }] }
    };
    expect(listOrders(view)).toEqual([]);
  });

  it("lists one order per bombard/shell target", () => {
    const base = emptyLegalView(openingState());
    const view = {
      ...base,
      legal: {
        ...base.legal,
        strikes: [
          { spaceId: "bombard-S2", type: "bombard" as const, linkedAreaId: "S2", targets: ["L7", "L8"], dice: 3 }
        ]
      }
    };
    const orders = listOrders(view);
    expect(orders.map((o) => o.label)).toEqual(["Bombard from S2 → L7 (3 dice)", "Bombard from S2 → L8 (3 dice)"]);
    expect(buildCommand(orders[1]!, {})).toEqual({ type: "bombard", spaceId: "bombard-S2", targetAreaId: "L8" });
  });
});

describe("buildCommand for moves", () => {
  const base = emptyLegalView(openingState("cp", ["ground_assault", "counterattack"]));
  const move = {
    spaceId: "advance-L7",
    type: "advance" as const,
    targetAreaId: "L7",
    sources: [
      { areaId: "L3", max: 2 },
      { areaId: "L9", max: 1 }
    ]
  };
  const view = {
    ...base,
    legal: {
      ...base.legal,
      moves: [move],
      cardPlays: [
        { card: "ground_assault" as const, action: "advance" as const, moves: [move], bonusMax: 2 },
        { card: "counterattack" as const, action: "advance" as const, moves: [move] }
      ]
    }
  };
  const [plain, assault, counter] = listOrders(view);

  it("labels limits and usage", () => {
    expect(formatOrder(plain!)).toBe(
      " 1. Advance into L7 (sources: L3 up to 2, L9 up to 1)  → play 1 --from AREA:N[,AREA:N]"
    );
    expect(formatOrder(assault!)).toContain("[card: ground_assault]");
    expect(formatOrder(assault!)).toContain("--bonus 0-2");
  });

  it("builds advance moves in source order", () => {
    expect(buildCommand(plain!, { from: "L9:1,L3:2" })).toEqual({
      type: "advance",
      spaceId: "advance-L7",
      moves: [
        { from: "L3", count: 2 },
        { from: "L9", count: 1 }
      ]
    });
  });

  it("sums a repeated area and enforces its max", () => {
    expect(() => buildCommand(plain!, { from: "L3:1,L3:2" })).toThrow(/L3 allows at most 2/);
    expect(buildCommand(plain!, { from: "L3:1,L3:1" })).toMatchObject({ moves: [{ from: "L3", count: 2 }] });
  });

  it("rejects missing, unknown, zero and malformed sources", () => {
    expect(() => buildCommand(plain!, {})).toThrow(/needs --from/);
    expect(() => buildCommand(plain!, { from: "L5:1" })).toThrow(/L5 is not a legal source for order 1/);
    expect(() => buildCommand(plain!, { from: "L3:0" })).toThrow(OrderArgError);
    expect(() => buildCommand(plain!, { from: "L3-2" })).toThrow(/AREA:COUNT/);
    expect(() => buildCommand(plain!, { from: "L3:1", place: "L3:1" })).toThrow(/--place/);
  });

  it("adds card and cardBonus (default 0) for assault cards, card only for counterattack", () => {
    expect(buildCommand(assault!, { from: "L3:1" })).toMatchObject({ card: "ground_assault", cardBonus: 0 });
    expect(buildCommand(assault!, { from: "L3:1", bonus: 2 })).toMatchObject({ cardBonus: 2 });
    expect(() => buildCommand(assault!, { from: "L3:1", bonus: 3 })).toThrow(/at most 2/);
    const c = buildCommand(counter!, { from: "L3:1" });
    expect(c).toMatchObject({ card: "counterattack" });
    expect(c).not.toHaveProperty("cardBonus");
    expect(() => buildCommand(counter!, { from: "L3:1", bonus: 1 })).toThrow(/--bonus/);
  });
});

describe("buildCommand for placements", () => {
  const base = emptyLegalView(openingState());
  const view = {
    ...base,
    legal: {
      ...base.legal,
      placements: [
        {
          spaceId: "reinforce-a",
          type: "reinforce" as const,
          unit: "troop" as const,
          targets: ["L3", "L9", "L12"],
          pool: 3,
          reserve: 2
        }
      ]
    }
  };
  const [reinforce] = listOrders(view);

  it("limits the total to min(pool, reserve)", () => {
    expect(reinforce!.template).toMatchObject({ kind: "placement", limit: 2 });
    expect(buildCommand(reinforce!, { place: "L3:1,L12:1" })).toEqual({
      type: "reinforce",
      spaceId: "reinforce-a",
      placements: [
        { area: "L3", count: 1 },
        { area: "L12", count: 1 }
      ]
    });
    expect(() => buildCommand(reinforce!, { place: "L3:2,L9:1" })).toThrow(/places at most 2/);
    expect(() => buildCommand(reinforce!, { place: "L4:1" })).toThrow(/L4 is not a legal target/);
    expect(() => buildCommand(reinforce!, {})).toThrow(/needs --place/);
  });
});

describe("parseAllocation", () => {
  it("parses and sums", () => {
    expect([...parseAllocation(" L3:2, L9:1 ,L3:1")]).toEqual([
      ["L3", 3],
      ["L9", 1]
    ]);
  });
  it("rejects empty input", () => {
    expect(() => parseAllocation(" , ")).toThrow(OrderArgError);
  });
});
```

If the "every order … engine accepts" guard `orders.some(… "mobilise")` fails because the opening offers no Reinforce on seed `cp-all`, try other seeds until one does (keep the guard — it stops the test being vacuous).

- [ ] **Step 3: Run to verify failure**

Run: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/claude-player test`
Expected: FAIL — cannot find `../src/orders.js`.

- [ ] **Step 4: Implement `src/orders.ts`**

```ts
import type {
  Command,
  LegalMove,
  LegalPlacement,
  LegalStrike,
  OperationCard,
  PlayerGameView
} from "@sengoku-jidai/engine/client";

export type OrderTemplate =
  | {
      kind: "move";
      type: "advance" | "sail";
      spaceId: string;
      targetAreaId: string;
      sources: { areaId: string; max: number }[];
      card?: OperationCard;
      bonusMax?: number;
    }
  | {
      kind: "placement";
      type: "reinforce" | "embark";
      spaceId: string;
      unit: "troop" | "ship";
      targets: string[];
      limit: number;
      pool: number;
      reserve: number;
      card?: OperationCard;
    }
  | { kind: "fixed"; command: Command };

export interface Order {
  n: number;
  label: string;
  template: OrderTemplate;
}

export interface OrderArgs {
  from?: string;
  place?: string;
  bonus?: number;
}

/** A mistake in `play` arguments, caught locally — nothing is submitted. */
export class OrderArgError extends Error {}

const MOVE_VERB = { advance: "Advance into", sail: "Sail into" } as const;

/** Every order the viewer can give right now, numbered from 1. Empty when not on the clock. */
export function listOrders(view: PlayerGameView): Order[] {
  const drafts: { label: string; template: OrderTemplate }[] = [];
  const legal = view.legal;

  const decision = view.pendingDecision;
  if (decision && decision.seat === view.viewerSeat) {
    for (const choice of decision.choices) {
      drafts.push({
        label: `${decision.prompt} → ${choice.label}`,
        template: {
          kind: "fixed",
          command: { type: "choosePendingDecision", pendingId: decision.id, choice }
        }
      });
    }
  }

  const combat = view.pendingCombat;
  if (combat) {
    const where = `combat at ${combat.area}`;
    if (legal.canRollCombat) {
      drafts.push({
        label: `Roll the dice (${where})`,
        template: { kind: "fixed", command: { type: "combatRoll", pendingId: combat.id } }
      });
    }
    if (legal.canAmbush) {
      drafts.push({
        label: `Roll with Ambush — discard ambush for +2 defence dice (${where})`,
        template: {
          kind: "fixed",
          command: { type: "combatRoll", pendingId: combat.id, card: "ambush" }
        }
      });
    }
    if (legal.canRerollCombat) {
      for (const card of new Set(view.hand)) {
        drafts.push({
          label: `Reroll — discard ${card} (${where})`,
          template: { kind: "fixed", command: { type: "combatReroll", pendingId: combat.id, card } }
        });
      }
    }
    if (legal.canResolveCombat) {
      drafts.push({
        label: `Accept the roll and apply casualties (${where})`,
        template: { kind: "fixed", command: { type: "combatResolve", pendingId: combat.id } }
      });
    }
  }

  for (const move of legal.moves) drafts.push(moveDraft(move));
  for (const strike of legal.strikes) drafts.push(...strikeDrafts(strike));
  for (const placement of legal.placements) drafts.push(placementDraft(placement));
  for (const plan of legal.plans) {
    drafts.push({
      label: plan.initiative
        ? "Plan — draw a card and seize initiative next round"
        : "Plan — draw a card",
      template: { kind: "fixed", command: { type: "plan", spaceId: plan.spaceId } }
    });
  }
  for (const play of legal.cardPlays) {
    for (const move of play.moves ?? []) drafts.push(moveDraft(move, play.card, play.bonusMax));
    for (const strike of play.strikes ?? []) drafts.push(...strikeDrafts(strike, play.card));
    for (const placement of play.placements ?? []) drafts.push(placementDraft(placement, play.card));
  }
  if (legal.canPass) {
    drafts.push({
      label: "Pass — done deploying this round",
      template: { kind: "fixed", command: { type: "pass" } }
    });
  }

  return drafts.map((d, i) => ({ n: i + 1, ...d }));
}

function cardTag(card: OperationCard | undefined): string {
  return card ? `[card: ${card}] ` : "";
}

function moveDraft(move: LegalMove, card?: OperationCard, bonusMax?: number) {
  const sources = move.sources.map((s) => `${s.areaId} up to ${s.max}`).join(", ");
  const bonus =
    bonusMax !== undefined
      ? `; +up to ${bonusMax} reserve ${move.type === "advance" ? "troops" : "ships"}`
      : "";
  return {
    label: `${cardTag(card)}${MOVE_VERB[move.type]} ${move.targetAreaId} (sources: ${sources}${bonus})`,
    template: {
      kind: "move" as const,
      type: move.type,
      spaceId: move.spaceId,
      targetAreaId: move.targetAreaId,
      sources: move.sources,
      ...(card ? { card } : {}),
      ...(bonusMax !== undefined ? { bonusMax } : {})
    }
  };
}

function strikeDrafts(strike: LegalStrike, card?: OperationCard) {
  const verb = strike.type === "bombard" ? "Bombard" : "Shell";
  return strike.targets.map((target) => ({
    label: `${cardTag(card)}${verb} from ${strike.linkedAreaId} → ${target} (${strike.dice} dice)`,
    template: {
      kind: "fixed" as const,
      command: {
        type: strike.type,
        spaceId: strike.spaceId,
        targetAreaId: target,
        ...(card ? { card } : {})
      } as Command
    }
  }));
}

function placementDraft(placement: LegalPlacement, card?: OperationCard) {
  const limit = Math.min(placement.pool, placement.reserve);
  const verb = placement.type === "reinforce" ? "Reinforce" : "Embark";
  const units = placement.unit === "troop" ? "troops" : "ships";
  return {
    label: `${cardTag(card)}${verb}: place up to ${limit} ${units} (pool ${placement.pool}, reserve ${placement.reserve}) into ${placement.targets.join(", ")}`,
    template: {
      kind: "placement" as const,
      type: placement.type,
      spaceId: placement.spaceId,
      unit: placement.unit,
      targets: placement.targets,
      limit,
      pool: placement.pool,
      reserve: placement.reserve,
      ...(card ? { card } : {})
    }
  };
}

/** One order line with its usage hint, e.g. ` 4. Advance into L7 (…)  → play 4 --from AREA:N`. */
export function formatOrder(order: Order): string {
  const t = order.template;
  let usage = `play ${order.n}`;
  if (t.kind === "move") {
    usage += " --from AREA:N[,AREA:N]";
    if (t.bonusMax !== undefined) usage += ` [--bonus 0-${t.bonusMax}]`;
  } else if (t.kind === "placement") {
    usage += " --place AREA:N[,AREA:N]";
  }
  return `${String(order.n).padStart(2)}. ${order.label}  → ${usage}`;
}

/** Parse `A:2,B:1` into area → count (repeated areas sum). */
export function parseAllocation(raw: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^([^:\s]+):(\d+)$/.exec(part);
    if (!m) throw new OrderArgError(`Can't read "${part}" — use AREA:COUNT, e.g. L3:2.`);
    const count = Number(m[2]);
    if (count < 1) throw new OrderArgError(`Counts must be at least 1 ("${part}").`);
    out.set(m[1]!, (out.get(m[1]!) ?? 0) + count);
  }
  if (out.size === 0) throw new OrderArgError("Give at least one AREA:COUNT.");
  return out;
}

/** Validate `args` against the order's limits and build the engine command. */
export function buildCommand(order: Order, args: OrderArgs): Command {
  const t = order.template;
  const n = order.n;
  if (t.kind === "fixed") {
    if (args.from !== undefined || args.place !== undefined || args.bonus !== undefined) {
      throw new OrderArgError(`Order ${n} takes no arguments — run \`play ${n}\`.`);
    }
    return t.command;
  }

  if (t.kind === "move") {
    if (args.place !== undefined) throw new OrderArgError(`Order ${n} is a move: use --from, not --place.`);
    if (args.from === undefined) throw new OrderArgError(`Order ${n} needs --from AREA:N[,AREA:N].`);
    const wanted = parseAllocation(args.from);
    for (const [area, count] of wanted) {
      const source = t.sources.find((s) => s.areaId === area);
      if (!source) throw new OrderArgError(`${area} is not a legal source for order ${n}.`);
      if (count > source.max) throw new OrderArgError(`${area} allows at most ${source.max}.`);
    }
    const moves = t.sources
      .filter((s) => wanted.has(s.areaId))
      .map((s) => ({ from: s.areaId, count: wanted.get(s.areaId)! }));
    if (args.bonus !== undefined) {
      if (t.bonusMax === undefined) throw new OrderArgError(`Order ${n} takes no --bonus.`);
      if (!Number.isInteger(args.bonus) || args.bonus < 0 || args.bonus > t.bonusMax) {
        throw new OrderArgError(`--bonus for order ${n} must be 0 to at most ${t.bonusMax}.`);
      }
    }
    // Mirrors the web's buildCommand: assault cards always carry cardBonus; counterattack only the card.
    const cardFields = t.card
      ? { card: t.card, ...(t.bonusMax !== undefined ? { cardBonus: args.bonus ?? 0 } : {}) }
      : {};
    return { type: t.type, spaceId: t.spaceId, moves, ...cardFields } as Command;
  }

  if (args.from !== undefined) throw new OrderArgError(`Order ${n} is a placement: use --place, not --from.`);
  if (args.bonus !== undefined) throw new OrderArgError(`Order ${n} takes no --bonus.`);
  if (args.place === undefined) throw new OrderArgError(`Order ${n} needs --place AREA:N[,AREA:N].`);
  const wanted = parseAllocation(args.place);
  let total = 0;
  for (const [area, count] of wanted) {
    if (!t.targets.includes(area)) throw new OrderArgError(`${area} is not a legal target for order ${n}.`);
    total += count;
  }
  if (total > t.limit) throw new OrderArgError(`Order ${n} places at most ${t.limit} in total.`);
  const placements = t.targets
    .filter((a) => wanted.has(a))
    .map((area) => ({ area, count: wanted.get(area)! }));
  return { type: t.type, spaceId: t.spaceId, placements, ...(t.card ? { card: t.card } : {}) } as Command;
}
```

Note: the bonus error text must match the test regex `/at most 2/` — "must be 0 to at most 2" does.

- [ ] **Step 5: Run tests**

Run: `corepack pnpm --filter @sengoku-jidai/claude-player test`
Expected: PASS. If "every order … engine accepts" fails, print the failing label/command, compare with `packages/web/src/App.tsx` `buildCommand` (≈line 1214) and fix the mapping — do not loosen the test.

- [ ] **Step 6: Typecheck + lint, then commit**

Run: `corepack pnpm --filter @sengoku-jidai/claude-player typecheck && corepack pnpm lint`

```bash
git add packages/claude-player
git commit -m "feat(claude-player): numbered orders with local argument validation"
```

---

### Task 3: Board text and event lines

**Files:**
- Create: `packages/claude-player/src/board.ts`, `src/events.ts`, `test/board.test.ts`, `test/events.test.ts`

**Interfaces:**
- Consumes: `Order`, `formatOrder` (Task 2); engine/client `MapDefinition`, `PlayerGameView`, `PlayerGameEvent`, `OperationCard`, `SeatId`.
- Produces:
  ```ts
  export const CARD_TEXT: Record<OperationCard, string>;
  export function renderBoard(view: PlayerGameView, map: MapDefinition, orders: Order[]): string;
  export function gameOverLine(view: PlayerGameView): string;
  export function formatEvent(event: PlayerGameEvent, viewer: SeatId): string;
  ```

- [ ] **Step 1: Write the failing tests**

`packages/claude-player/test/board.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getMap } from "@sengoku-jidai/engine";
import { CARD_TEXT, gameOverLine, renderBoard } from "../src/board.js";
import { listOrders } from "../src/orders.js";
import { activeView, openingState } from "./helpers.js";

describe("renderBoard", () => {
  const state = openingState("board", ["mobilise"]);
  const view = activeView(state);
  const map = getMap(state.mapId);
  const text = renderBoard(view, map, listOrders(view));

  it("has a header naming the viewer, round, clock, VP and hand", () => {
    expect(text).toContain(`You are ${view.viewerSeat.toUpperCase()}`);
    expect(text).toContain(`Round ${view.round}/${view.maxRounds}`);
    expect(text).toContain("On the clock: you");
    expect(text).toMatch(/VP: red \d+ · black \d+/);
    expect(text).toContain(`mobilise — ${CARD_TEXT.mobilise}`);
  });

  it("lists every area once with owner, units and adjacency", () => {
    for (const area of view.areas) {
      const lines = text.split("\n").filter((l) => l.startsWith(`${area.id} `));
      expect(lines, area.id).toHaveLength(1);
      expect(lines[0]).toContain(`adj: ${map.areas[area.id]!.adjacent.join(", ")}`);
    }
  });

  it("ends with the numbered orders", () => {
    expect(text).toContain("Your orders:");
    expect(text).toMatch(/\n 1\. /);
  });

  it("says when it is not your turn", () => {
    const quiet = renderBoard(view, map, []);
    expect(quiet).toContain("Not your turn — the opponent is on the clock.");
  });

  it("matches the Rivers opening snapshot", () => {
    expect(text).toMatchSnapshot();
  });

  it("describes a finished game", () => {
    const over = { ...view, status: "complete" as const, winner: "red" as const, endReason: "victoryPoints" as const };
    expect(gameOverLine(over)).toMatch(/^GAME OVER — winner: red \(victoryPoints\) — VP red \d+ · black \d+$/);
    expect(renderBoard(over, map, [])).toContain("GAME OVER");
  });
});
```

`packages/claude-player/test/events.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PlayerGameEvent } from "@sengoku-jidai/engine";
import { formatEvent } from "../src/events.js";

const all: PlayerGameEvent[] = [
  { type: "commanderDeployed", seat: "red", spaceId: "advance-L7" },
  { type: "passed", seat: "black" },
  { type: "unitsMoved", seat: "red", from: "L3", to: "L7", unit: "troop", count: 2 },
  { type: "unitsPlaced", seat: "red", area: "L3", unit: "troop", count: 3 },
  { type: "bonusApplied", seat: "red", bonus: "barracks", area: "L3" },
  { type: "diceRolled", seat: "black", purpose: "defence", rolls: [2, 6], total: 8, fort: true },
  { type: "cardsDrawn", seat: "red", count: 1 },
  { type: "cardDiscarded", seat: "red" },
  { type: "cardPlayed", seat: "red", card: "mobilise" },
  { type: "unitsRemoved", seat: "black", area: "L7", unit: "troop", count: 1 },
  { type: "areaCaptured", seat: "red", area: "L7", previousOwner: "black" },
  { type: "capExceeded", area: "S1", unit: "ship", returned: 1, owner: "red" },
  { type: "turnAdvanced", activeSeat: "black" },
  { type: "recalled", round: 2, initiative: "red" },
  { type: "initiativeSeized", seat: "black" },
  { type: "gameEnded", winner: "red", reason: "victoryPoints" }
];

describe("formatEvent", () => {
  it("formats every event type on one line without falling back to JSON", () => {
    for (const e of all) {
      const line = formatEvent(e, "red");
      expect(line, e.type).not.toContain("\n");
      expect(line, e.type).not.toContain("{");
    }
  });

  it("names the viewer as you", () => {
    expect(formatEvent(all[2]!, "red")).toBe("red (you) moved 2 troops L3 → L7");
    expect(formatEvent(all[2]!, "black")).toBe("red (opponent) moved 2 troops L3 → L7");
    expect(formatEvent(all[5]!, "red")).toBe("black (opponent) rolled defence: 2, 6 = 8 (fort)");
  });

  it("falls back to type + JSON for unknown events", () => {
    const odd = { type: "somethingNew", x: 1 } as unknown as PlayerGameEvent;
    expect(formatEvent(odd, "red")).toBe('somethingNew {"type":"somethingNew","x":1}');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `corepack pnpm --filter @sengoku-jidai/claude-player test`
Expected: FAIL — missing `../src/board.js` / `../src/events.js`.

- [ ] **Step 3: Implement `src/events.ts`**

```ts
import type { PlayerGameEvent, SeatId } from "@sengoku-jidai/engine/client";

function who(seat: SeatId, viewer: SeatId): string {
  return `${seat} (${seat === viewer ? "you" : "opponent"})`;
}

function units(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** One human-readable line per engine event. */
export function formatEvent(event: PlayerGameEvent, viewer: SeatId): string {
  switch (event.type) {
    case "commanderDeployed":
      return `${who(event.seat, viewer)} deployed a commander to ${event.spaceId}`;
    case "passed":
      return `${who(event.seat, viewer)} passed`;
    case "unitsMoved":
      return `${who(event.seat, viewer)} moved ${units(event.count, event.unit)} ${event.from} → ${event.to}`;
    case "unitsPlaced":
      return `${who(event.seat, viewer)} placed ${units(event.count, event.unit)} in ${event.area}`;
    case "bonusApplied":
      return `${who(event.seat, viewer)} got the ${event.bonus} bonus at ${event.area}`;
    case "diceRolled":
      return `${who(event.seat, viewer)} rolled ${event.purpose}: ${event.rolls.join(", ")} = ${event.total}${event.fort ? " (fort)" : ""}`;
    case "cardsDrawn":
      return `${who(event.seat, viewer)} drew ${event.count} card${event.count === 1 ? "" : "s"}`;
    case "cardDiscarded":
      return `${who(event.seat, viewer)} discarded a card`;
    case "cardPlayed":
      return `${who(event.seat, viewer)} played ${event.card}`;
    case "unitsRemoved":
      return `${who(event.seat, viewer)} lost ${units(event.count, event.unit)} in ${event.area}`;
    case "areaCaptured":
      return `${who(event.seat, viewer)} captured ${event.area}${event.previousOwner ? ` from ${event.previousOwner}` : ""}`;
    case "capExceeded":
      return `${event.owner}: ${units(event.returned, event.unit)} over the cap in ${event.area} returned to reserve`;
    case "turnAdvanced":
      return `— ${event.activeSeat}${event.activeSeat === viewer ? " (you)" : " (opponent)"} to act —`;
    case "recalled":
      return `=== Recall: round ${event.round} begins, initiative ${event.initiative} ===`;
    case "initiativeSeized":
      return `${who(event.seat, viewer)} seized initiative for next round`;
    case "gameEnded":
      return `GAME ENDED — winner: ${event.winner ?? "none"} (${event.reason})`;
    default: {
      const unknown = event as { type: string };
      return `${unknown.type} ${JSON.stringify(unknown)}`;
    }
  }
}
```

- [ ] **Step 4: Implement `src/board.ts`**

```ts
import type {
  MapDefinition,
  OperationCard,
  PlayerAreaView,
  PlayerGameView,
  SeatId,
  UnitCounts
} from "@sengoku-jidai/engine/client";
import { formatOrder, type Order } from "./orders.js";

/** One-line effect of each operation card. Any card may also be discarded to reroll combat dice. */
export const CARD_TEXT: Record<OperationCard, string> = {
  ambush: "when defending a land Advance, discard before the roll for +2 defence dice",
  commandeer: "Embark with +1 ship and may land ships in enemy-held seas (sea battles follow)",
  counterattack: "Advance through an action space the opponent already occupies",
  ground_assault: "Advance, and up to 2 reserve troops join the move-in",
  mobilise: "Reinforce with +2 to the space's pool",
  river_assault: "Sail, and up to 2 reserve ships join the move-in",
  ship_strike: "after your Shell resolves, you may Shell a second sea",
  shore_strike: "Bombard with +2 dice"
};

function seatLabel(seat: SeatId, viewer: SeatId): string {
  return seat === viewer ? "you" : `opponent (${seat})`;
}

function unitText(u: UnitCounts): string {
  const parts: string[] = [];
  if (u.troop) parts.push(`${u.troop} troop${u.troop === 1 ? "" : "s"}`);
  if (u.ship) parts.push(`${u.ship} ship${u.ship === 1 ? "" : "s"}`);
  if (u.siege) parts.push(`${u.siege} siege`);
  return parts.length ? parts.join(" ") : "empty";
}

function areaLine(area: PlayerAreaView, view: PlayerGameView, map: MapDefinition): string {
  const def = map.areas[area.id];
  const tags = [area.id, area.kind];
  if (area.valueStars) tags.push(`★${area.valueStars}`);
  if (def?.hq) tags.push(`HQ:${def.hq}`);
  if (def?.fort) tags.push("fort");
  if (def?.harbor) tags.push("harbor");
  const bonus = view.bonuses[area.id];
  if (bonus) tags.push(`bonus:${bonus}`);
  return [
    tags.join(" "),
    area.owner ?? "neutral",
    unitText(area.units),
    `supply: ${area.suppliedBy ?? "-"}`,
    `adj: ${(def?.adjacent ?? []).join(", ")}`
  ].join(" | ");
}

export function gameOverLine(view: PlayerGameView): string {
  return `GAME OVER — winner: ${view.winner ?? "none"} (${view.endReason ?? "?"}) — VP red ${view.victoryPoints.red} · black ${view.victoryPoints.black}`;
}

/** The whole position as compact text, ending with the numbered orders. */
export function renderBoard(view: PlayerGameView, map: MapDefinition, orders: Order[]): string {
  const me = view.viewerSeat;
  const other: SeatId = me === "red" ? "black" : "red";
  const out: string[] = [];

  out.push(
    `You are ${me.toUpperCase()}. Round ${view.round}/${view.maxRounds} · ${view.phase} phase · initiative: ${seatLabel(view.initiative, me)} · On the clock: ${seatLabel(view.activeSeat, me)}`
  );
  out.push(`VP: red ${view.victoryPoints.red} · black ${view.victoryPoints.black}`);
  out.push(
    `Commanders left: you ${view.commandersRemaining[me]}/${view.commandersTotal[me]} · opponent ${view.commandersRemaining[other]}/${view.commandersTotal[other]}`
  );
  out.push(
    view.hand.length
      ? `Your hand:\n${view.hand.map((c) => `  - ${c} — ${CARD_TEXT[c]}`).join("\n")}`
      : "Your hand: (empty)"
  );
  out.push(`Opponent hand: ${view.opponentHandCount} card(s)`);
  out.push("");
  out.push("Areas (id kind [★stars HQ fort harbor bonus] | owner | units | supply | adjacent):");
  for (const kind of ["land", "sea"] as const) {
    for (const area of view.areas.filter((a) => a.kind === kind)) out.push(areaLine(area, view, map));
  }

  const combats = [view.pendingCombat, ...view.combatQueue].filter((c) => c !== null);
  if (combats.length) {
    out.push("");
    for (const c of combats) {
      const dice = c.phase === "rolled" ? `rolled ${c.rolls?.join(", ")} = ${c.total}` : "dice not yet rolled";
      const sides =
        c.attackers !== undefined ? ` — ${c.attackers} attacking vs ${c.defenders ?? 0} defending` : "";
      out.push(
        `Combat (${c.kind}) at ${c.area}: ${c.attacker} attacks ${c.defender}${sides}; ${seatLabel(c.responsibleSeat, me)} rolls; ${dice}`
      );
    }
  }
  if (view.pendingDecision) {
    out.push(`Pending decision for ${seatLabel(view.pendingDecision.seat, me)}: ${view.pendingDecision.prompt}`);
  }

  out.push("");
  if (view.status === "complete" || view.status === "abandoned") {
    out.push(gameOverLine(view));
  } else if (orders.length) {
    out.push("Your orders:");
    for (const order of orders) out.push(formatOrder(order));
  } else {
    out.push("Not your turn — the opponent is on the clock.");
  }
  return out.join("\n");
}
```

Before relying on `CARD_TEXT`, check each line against the engine (`packages/engine/src/view.ts` `enumerateCardPlays`, `validate.ts`, `actions.ts`, and the `canAmbush` condition in `legalCommandsForState`) and correct any that are wrong.

- [ ] **Step 5: Run tests; inspect and accept the snapshot**

Run: `corepack pnpm --filter @sengoku-jidai/claude-player test`
Expected: PASS; a new snapshot file under `test/__snapshots__/`. Open it and read it as if you were the player: it must be understandable with no other context. Fix anything confusing, rerun with `-u`.

- [ ] **Step 6: Typecheck + lint, then commit**

Run: `corepack pnpm --filter @sengoku-jidai/claude-player typecheck && corepack pnpm lint`

```bash
git add packages/claude-player
git commit -m "feat(claude-player): board text and event lines"
```

---

### Task 4: Session, API client, commands, CLI entry, integration game

**Files:**
- Create: `packages/claude-player/src/session.ts`, `src/api.ts`, `src/commands.ts`, `src/main.ts`, `src/cli.ts`, `test/commands.test.ts`

**Interfaces:**
- Consumes: `parseInviteLink`, `LinkError` (Task 1); `listOrders`, `buildCommand`, `OrderArgError`, `OrderArgs` (Task 2); `renderBoard`, `gameOverLine`, `formatEvent` (Task 3); engine/client `compileHexMap`, `MapDefinition`, `PlayerGameView`, `PlayerGameEvent`, `Command`, `SeatId`; shared `PlayerGameViewEnvelope`, `SubmitCommandResponse`, `EventsResponse`, `ChatResponse`, `ChatMessage`, `MapDetail`, `ApiErrorBody`.
- Produces:
  ```ts
  // session.ts
  export interface Session { baseUrl: string; gameId: string; token: string; seat: SeatId;
    map: MapDefinition; lastSeenRevision: number; lastChatId: number; ordersRevision: number | null }
  export class SessionError extends Error {}
  export function defaultSessionPath(env?: NodeJS.ProcessEnv): string;
  export function loadSession(path: string): Session;
  export function saveSession(path: string, session: Session): void;
  // api.ts
  export class ApiError extends Error { status: number; code: string }
  export interface GameApi { claim(name: string); view(); submit(baseRevision: number, command: Command);
    eventsAfter(revision: number); chatAfter(id: number); say(text: string); map(mapId: string) }
  export function createApi(link: { baseUrl: string; gameId: string; token: string }, fetchImpl?: typeof fetch): GameApi;
  // commands.ts
  export const EXIT: { ok: 0; local: 1; over: 2; waiting: 3; rejected: 4; auth: 5 };
  export interface Ctx { sessionPath: string; out(line: string): void; err(line: string): void;
    fetch?: typeof fetch; sleep?(ms: number): Promise<void>; now?(): number }
  export function runJoin(ctx: Ctx, link: string, name: string): Promise<number>;
  export function runStatus(ctx: Ctx): Promise<number>;
  export function runPlay(ctx: Ctx, n: number, args: OrderArgs): Promise<number>;
  export function runWait(ctx: Ctx, opts: { timeoutSec: number; intervalMs: number }): Promise<number>;
  export function runSay(ctx: Ctx, text: string): Promise<number>;
  // main.ts
  export function main(argv: string[], ctx: Omit<Ctx, "sessionPath">, env?: NodeJS.ProcessEnv): Promise<number>;
  ```

- [ ] **Step 1: Write the failing integration tests**

`packages/claude-player/test/commands.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../server/src/app.js";
import type { ServerConfig } from "../../server/src/config.js";
import { createApi } from "../src/api.js";
import { EXIT, runJoin, runPlay, runSay, runStatus, runWait, type Ctx } from "../src/commands.js";
import { main } from "../src/main.js";
import { listOrders, type Order } from "../src/orders.js";
import { loadSession } from "../src/session.js";

const config: ServerConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 0,
  webOrigin: "http://localhost:5173",
  sqlitePath: ":memory:",
  sessionSecret: "test-session-secret",
  logLevel: "silent"
};

let app: ReturnType<typeof buildApp>;
let base: string;
let dir: string;

beforeAll(async () => {
  app = buildApp(config);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  base = `http://127.0.0.1:${addr.port}`;
  dir = mkdtempSync(join(tmpdir(), "sengoku-cli-"));
});

afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

function ctxFor(name: string): Ctx & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    sessionPath: join(dir, `${name}-${Math.random().toString(36).slice(2)}.json`),
    out: (l) => lines.push(l),
    err: (l) => lines.push(`ERR ${l}`),
    sleep: async () => undefined
  };
}

async function newGame(seed: string) {
  const res = await fetch(`${base}/api/games`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "private_multiplayer", seed, name: "Human", side: "red" })
  });
  const body = (await res.json()) as { gameId: string; seats: { seat: string; token: string }[] };
  const link = (seat: string) =>
    `${base}/g/${body.gameId}#${body.seats.find((s) => s.seat === seat)!.token}`;
  return { gameId: body.gameId, red: link("red"), black: link("black") };
}

function minimalArgs(order: Order) {
  const t = order.template;
  if (t.kind === "move") return { from: `${t.sources[0]!.areaId}:1` };
  if (t.kind === "placement") return { place: `${t.targets[0]!}:1` };
  return {};
}

async function ordersFor(ctx: Ctx) {
  const s = loadSession(ctx.sessionPath);
  const env = await createApi(s).view();
  return { env, orders: listOrders(env.view) };
}

describe("claude-player commands against a real server", () => {
  it("join claims the seat under the given name and prints the board", async () => {
    const game = await newGame("join");
    const claude = ctxFor("claude");
    expect(await runJoin(claude, game.black, "Claude")).toBe(EXIT.ok);
    expect(claude.lines.join("\n")).toContain("You are BLACK");
    const env = await createApi(loadSession(claude.sessionPath)).view();
    expect(env.seatInfo.find((s) => s.seat === "black")).toMatchObject({ name: "Claude", status: "claimed" });
  });

  it("play refuses when the game moved on since status", async () => {
    const game = await newGame("stale");
    const red = ctxFor("red");
    const black = ctxFor("black");
    await runJoin(red, game.red, "Human");
    await runJoin(black, game.black, "Claude");
    const mover = (await ordersFor(red)).orders.length ? red : black;
    expect(await runStatus(mover)).toBe(EXIT.ok);
    // The game advances behind the CLI's back (same seat, direct API call).
    const { env, orders } = await ordersFor(mover);
    const pass = orders.at(-1)!.template;
    if (pass.kind !== "fixed" || pass.command.type !== "pass") throw new Error("expected pass last");
    const s = loadSession(mover.sessionPath);
    await createApi(s).submit(env.revision, pass.command);
    const before = (await createApi(s).view()).revision;
    expect(await runPlay(mover, 1, {})).toBe(EXIT.rejected);
    expect(mover.lines.join("\n")).toMatch(/moved on/);
    expect((await createApi(s).view()).revision).toBe(before);
  });

  it("play reports local argument errors with exit 1 and submits nothing", async () => {
    const game = await newGame("args");
    const red = ctxFor("red");
    const black = ctxFor("black");
    await runJoin(red, game.red, "Human");
    await runJoin(black, game.black, "Claude");
    const mover = (await ordersFor(red)).orders.length ? red : black;
    expect(await runStatus(mover)).toBe(EXIT.ok);
    const { env, orders } = await ordersFor(mover);
    const move = orders.find((o) => o.template.kind === "move");
    expect(move, "opening should offer a move").toBeDefined();
    expect(await runPlay(mover, move!.n, { from: "NOPE:1" })).toBe(EXIT.local);
    expect(mover.lines.join("\n")).toMatch(/NOPE is not a legal source/);
    expect((await ordersFor(mover)).env.revision).toBe(env.revision);
  });

  it("wait times out with exit 3 while the opponent is on the clock, and survives a network error", async () => {
    const game = await newGame("wait");
    const red = ctxFor("red");
    const black = ctxFor("black");
    await runJoin(red, game.red, "Human");
    await runJoin(black, game.black, "Claude");
    const idle = (await ordersFor(red)).orders.length ? black : red;
    const busy = idle === red ? black : red;

    expect(await runWait(idle, { timeoutSec: 0, intervalMs: 1 })).toBe(EXIT.waiting);

    // The busy seat passes; the idle seat's wait should then return 0 despite one failed fetch.
    await runStatus(busy);
    const passN = (await ordersFor(busy)).orders.at(-1)!.n;
    expect(await runPlay(busy, passN, {})).toBe(EXIT.ok);
    let failed = false;
    const flaky: typeof fetch = async (input, init) => {
      if (!failed) {
        failed = true;
        throw new TypeError("fetch failed");
      }
      return fetch(input, init);
    };
    const code = await runWait({ ...idle, fetch: flaky }, { timeoutSec: 30, intervalMs: 1 });
    expect(code).toBe(EXIT.ok);
    expect(idle.lines.join("\n")).toMatch(/passed/);
    expect(idle.lines.join("\n")).toMatch(/Your turn/);
  });

  it("wait prints the opponent's chat", async () => {
    const game = await newGame("chat");
    const red = ctxFor("red");
    const black = ctxFor("black");
    await runJoin(red, game.red, "Human");
    await runJoin(black, game.black, "Claude");
    expect(await runSay(red, "good luck")).toBe(EXIT.ok);
    await runWait(black, { timeoutSec: 0, intervalMs: 1 });
    expect(black.lines.join("\n")).toContain("💬 red: good luck");
  });

  it("an invalid token exits 5", async () => {
    const game = await newGame("auth");
    const bad = ctxFor("bad");
    expect(await runJoin(bad, `${game.red.split("#")[0]}#not-a-token`, "X")).toBe(EXIT.auth);
  });

  it("main parses argv and dispatches", async () => {
    const game = await newGame("main");
    const lines: string[] = [];
    const io = { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l), sleep: async () => undefined };
    const session = join(dir, "main.json");
    expect(await main(["join", game.black, "--name", "Claude", "--session", session], io)).toBe(EXIT.ok);
    expect(await main(["status", "--session", session], io)).toBe(EXIT.ok);
    expect(await main(["play", "abc", "--session", session], io)).toBe(EXIT.local);
    expect(await main(["bogus"], io)).toBe(EXIT.local);
  });

  it(
    "plays a whole game through the CLI with no rejected commands, then reports game over",
    async () => {
      const game = await newGame("full-game");
      const red = ctxFor("red");
      const black = ctxFor("black");
      await runJoin(red, game.red, "Bot A");
      await runJoin(black, game.black, "Bot B");
      let over = false;
      for (let step = 0; step < 5000 && !over; step++) {
        let acted = false;
        for (const seat of [red, black]) {
          const { env, orders } = await ordersFor(seat);
          if (env.view.status === "complete") {
            over = true;
            break;
          }
          if (!orders.length) continue;
          expect(await runStatus(seat)).toBe(EXIT.ok);
          const code = await runPlay(seat, orders[0]!.n, minimalArgs(orders[0]!));
          expect([EXIT.ok, EXIT.over], seat.lines.slice(-5).join("\n")).toContain(code);
          acted = true;
          if (code === EXIT.over) over = true;
          break;
        }
        expect(acted || over, "nobody could act but the game is not over").toBe(true);
      }
      expect(over).toBe(true);
      for (const seat of [red, black]) {
        expect(await runStatus(seat)).toBe(EXIT.over);
        expect(await runWait(seat, { timeoutSec: 0, intervalMs: 1 })).toBe(EXIT.over);
        expect(await runPlay(seat, 1, {})).toBe(EXIT.over);
      }
    },
    120_000
  );
});
```

- [ ] **Step 2: Run to verify failure**

Run: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/claude-player test`
Expected: FAIL — missing `../src/api.js`, `../src/commands.js`, `../src/main.js`, `../src/session.js`.

- [ ] **Step 3: Implement `src/session.ts`**

```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { MapDefinition, SeatId } from "@sengoku-jidai/engine/client";

/** Everything the CLI remembers between invocations (one game at a time). */
export interface Session {
  baseUrl: string;
  gameId: string;
  token: string;
  seat: SeatId;
  map: MapDefinition;
  /** Last revision whose events were printed (by play or wait). */
  lastSeenRevision: number;
  /** Highest chat message id already printed. */
  lastChatId: number;
  /** Revision the last printed order list was computed from; `play` requires it to be current. */
  ordersRevision: number | null;
}

export class SessionError extends Error {}

export function defaultSessionPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.SENGOKU_SESSION ?? join(homedir(), ".sengoku", "session.json");
}

export function loadSession(path: string): Session {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new SessionError("No game joined yet — run `sengoku join <invite-link>` first.");
  }
  return JSON.parse(raw) as Session;
}

export function saveSession(path: string, session: Session): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(session), { mode: 0o600 });
}
```

- [ ] **Step 4: Implement `src/api.ts`**

```ts
import type { Command, PlayerGameEvent, PlayerGameView } from "@sengoku-jidai/engine/client";
import type {
  ApiErrorBody,
  ChatResponse,
  EventsResponse,
  MapDetail,
  PlayerGameViewEnvelope,
  SubmitCommandResponse
} from "@sengoku-jidai/shared";

/** An HTTP error response from the game server. Network failures are NOT ApiErrors. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export type ViewEnvelope = PlayerGameViewEnvelope<PlayerGameView>;

export interface GameApi {
  claim(name: string): Promise<ViewEnvelope>;
  view(): Promise<ViewEnvelope>;
  submit(baseRevision: number, command: Command): Promise<SubmitCommandResponse<PlayerGameView, PlayerGameEvent>>;
  eventsAfter(revision: number): Promise<EventsResponse<PlayerGameEvent>>;
  chatAfter(id: number): Promise<ChatResponse>;
  say(text: string): Promise<void>;
  map(mapId: string): Promise<MapDetail>;
}

export function createApi(
  link: { baseUrl: string; gameId: string; token: string },
  fetchImpl: typeof fetch = fetch
): GameApi {
  const game = `${link.baseUrl}/api/games/${encodeURIComponent(link.gameId)}`;
  const auth = { authorization: `Bearer ${link.token}` };

  async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await fetchImpl(url, {
      ...init,
      headers: { ...auth, ...(init.body ? { "content-type": "application/json" } : {}) }
    });
    const text = await res.text();
    const body = text ? (JSON.parse(text) as unknown) : {};
    if (!res.ok) {
      const error = (body as Partial<ApiErrorBody>).error;
      throw new ApiError(res.status, error?.code ?? "httpError", error?.message ?? `HTTP ${res.status}`);
    }
    return body as T;
  }

  return {
    claim: (name) => call(`${game}/claim`, { method: "POST", body: JSON.stringify({ name }) }),
    view: () => call(game),
    submit: (baseRevision, command) =>
      call(`${game}/commands`, {
        method: "POST",
        body: JSON.stringify({ baseRevision, clientCommandId: crypto.randomUUID(), command })
      }),
    eventsAfter: (revision) => call(`${game}/events?after=${revision}`),
    chatAfter: (id) => call(`${game}/chat?after=${id}`),
    say: async (text) => {
      await call(`${game}/chat`, { method: "POST", body: JSON.stringify({ text }) });
    },
    map: (mapId) => call(`${link.baseUrl}/api/maps/${encodeURIComponent(mapId)}`)
  };
}
```

- [ ] **Step 5: Implement `src/commands.ts`**

```ts
import { compileHexMap, type HexMapSource, type PlayerGameView } from "@sengoku-jidai/engine/client";
import { ApiError, createApi, type GameApi } from "./api.js";
import { gameOverLine, renderBoard } from "./board.js";
import { formatEvent } from "./events.js";
import { LinkError, parseInviteLink } from "./link.js";
import { OrderArgError, buildCommand, listOrders, type OrderArgs } from "./orders.js";
import { SessionError, loadSession, saveSession, type Session } from "./session.js";

export const EXIT = { ok: 0, local: 1, over: 2, waiting: 3, rejected: 4, auth: 5 } as const;

export interface Ctx {
  sessionPath: string;
  out(line: string): void;
  err(line: string): void;
  fetch?: typeof fetch;
  sleep?(ms: number): Promise<void>;
  now?(): number;
}

const isOver = (view: PlayerGameView) => view.status === "complete" || view.status === "abandoned";

function apiFor(ctx: Ctx, s: Pick<Session, "baseUrl" | "gameId" | "token">): GameApi {
  return createApi(s, ctx.fetch ?? fetch);
}

/** Map thrown errors to exit codes with a message Claude can act on. */
async function guarded(ctx: Ctx, fn: () => Promise<number>): Promise<number> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      ctx.err("The seat token was rejected — ask for a fresh invite link and run `sengoku join` again.");
      return EXIT.auth;
    }
    if (e instanceof ApiError) {
      ctx.err(`Server rejected it (${e.code}): ${e.message} — run \`sengoku status\` and try again.`);
      return EXIT.rejected;
    }
    if (e instanceof OrderArgError || e instanceof LinkError || e instanceof SessionError) {
      ctx.err(e.message);
      return EXIT.local;
    }
    ctx.err(`Could not reach the game server: ${(e as Error).message}`);
    return EXIT.local;
  }
}

/** Print the board + orders and remember which revision the numbering belongs to. */
function printStatus(ctx: Ctx, s: Session, view: PlayerGameView, revision: number): number {
  ctx.out(renderBoard(view, s.map, isOver(view) ? [] : listOrders(view)));
  s.ordersRevision = revision;
  saveSession(ctx.sessionPath, s);
  return isOver(view) ? EXIT.over : EXIT.ok;
}

export function runJoin(ctx: Ctx, link: string, name: string): Promise<number> {
  return guarded(ctx, async () => {
    const parsed = parseInviteLink(link);
    const api = apiFor(ctx, parsed);
    const env = await api.claim(name);
    const detail = await api.map(env.view.mapId);
    const map = compileHexMap(detail.source as HexMapSource).definition;
    const chat = await api.chatAfter(0);
    const session: Session = {
      ...parsed,
      seat: env.seat,
      map,
      lastSeenRevision: env.revision,
      lastChatId: chat.messages.at(-1)?.id ?? 0,
      ordersRevision: null
    };
    ctx.out(`Joined game ${parsed.gameId} as ${env.seat} ("${name}").`);
    for (const m of chat.messages) ctx.out(`💬 ${m.seat}: ${m.text}`);
    return printStatus(ctx, session, env.view, env.revision);
  });
}

export function runStatus(ctx: Ctx): Promise<number> {
  return guarded(ctx, async () => {
    const s = loadSession(ctx.sessionPath);
    const env = await apiFor(ctx, s).view();
    return printStatus(ctx, s, env.view, env.revision);
  });
}

export function runPlay(ctx: Ctx, n: number, args: OrderArgs): Promise<number> {
  return guarded(ctx, async () => {
    const s = loadSession(ctx.sessionPath);
    const api = apiFor(ctx, s);
    const env = await api.view();
    if (isOver(env.view)) {
      ctx.out(gameOverLine(env.view));
      return EXIT.over;
    }
    if (s.ordersRevision !== env.revision) {
      ctx.err("The game has moved on since your last `sengoku status` — run it again before playing.");
      return EXIT.rejected;
    }
    const orders = listOrders(env.view);
    const order = orders.find((o) => o.n === n);
    if (!order) throw new OrderArgError(`There is no order ${n} (there are ${orders.length}).`);
    const command = buildCommand(order, args);
    const res = await api.submit(env.revision, command);
    ctx.out(`Played: ${order.label}`);
    for (const e of res.events ?? []) ctx.out(`  ${formatEvent(e, s.seat)}`);
    s.lastSeenRevision = res.revision;
    ctx.out("");
    const view = res.view ?? (await api.view()).view;
    return printStatus(ctx, s, view, res.revision);
  });
}

export function runWait(ctx: Ctx, opts: { timeoutSec: number; intervalMs: number }): Promise<number> {
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = ctx.now ?? Date.now;
  return guarded(ctx, async () => {
    const s = loadSession(ctx.sessionPath);
    const api = apiFor(ctx, s);
    const deadline = now() + opts.timeoutSec * 1000;
    let reportedOutage = false;
    for (;;) {
      let view: PlayerGameView;
      try {
        const env = await api.view();
        view = env.view;
        if (env.revision !== s.lastSeenRevision) {
          const { events } = await api.eventsAfter(s.lastSeenRevision);
          for (const e of events) ctx.out(formatEvent(e, s.seat));
          s.lastSeenRevision = env.revision;
          saveSession(ctx.sessionPath, s);
        }
        const chat = await api.chatAfter(s.lastChatId);
        for (const m of chat.messages) {
          if (m.seat !== s.seat) ctx.out(`💬 ${m.seat}: ${m.text}`);
          s.lastChatId = m.id;
        }
        if (chat.messages.length) saveSession(ctx.sessionPath, s);
        reportedOutage = false;
      } catch (e) {
        if (e instanceof ApiError) throw e;
        if (!reportedOutage) ctx.err(`Server unreachable (${(e as Error).message}) — retrying…`);
        reportedOutage = true;
        if (now() >= deadline) return EXIT.waiting;
        await sleep(opts.intervalMs);
        continue;
      }
      if (isOver(view)) {
        ctx.out(gameOverLine(view));
        return EXIT.over;
      }
      if (listOrders(view).length) {
        ctx.out("Your turn. Run `sengoku status`.");
        return EXIT.ok;
      }
      if (now() >= deadline) {
        ctx.out("Still the opponent's turn — run `sengoku wait` again.");
        return EXIT.waiting;
      }
      await sleep(opts.intervalMs);
    }
  });
}

export function runSay(ctx: Ctx, text: string): Promise<number> {
  return guarded(ctx, async () => {
    const s = loadSession(ctx.sessionPath);
    await apiFor(ctx, s).say(text);
    ctx.out("Sent.");
    return EXIT.ok;
  });
}
```

Note: in the "wait survives a network error" test the flaky fetch throws on the *first* request, which is inside the `try` — the loop must retry, not exit. With `timeoutSec: 30` and the busy seat having already passed, the second poll sees the turn and returns 0.

- [ ] **Step 6: Implement `src/main.ts` and `src/cli.ts`**

`src/main.ts`:

```ts
import { parseArgs } from "node:util";
import { EXIT, runJoin, runPlay, runSay, runStatus, runWait, type Ctx } from "./commands.js";
import { defaultSessionPath } from "./session.js";

export const USAGE = `Usage: sengoku <command> [--session <path>]
  join <invite-link> [--name Claude]   claim the seat and show the board
  status                               board + numbered orders
  play <n> [--from A:N,...] [--place A:N,...] [--bonus K]
  wait [--timeout 540]                 block until it is your turn (exit 3: still waiting)
  say "<text>"                         post to the game chat
Exit codes: 0 ok/your turn · 1 local error · 2 game over · 3 still waiting · 4 rejected/stale · 5 bad token`;

export async function main(
  argv: string[],
  io: Omit<Ctx, "sessionPath">,
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        session: { type: "string" },
        name: { type: "string" },
        from: { type: "string" },
        place: { type: "string" },
        bonus: { type: "string" },
        timeout: { type: "string" }
      }
    });
  } catch (e) {
    io.err(`${(e as Error).message}\n${USAGE}`);
    return EXIT.local;
  }
  const { values, positionals } = parsed;
  const ctx: Ctx = { ...io, sessionPath: values.session ?? defaultSessionPath(env) };
  const [command, arg] = positionals;

  switch (command) {
    case "join":
      if (!arg) break;
      return runJoin(ctx, arg, values.name ?? "Claude");
    case "status":
      return runStatus(ctx);
    case "play": {
      const n = Number(arg);
      const bonus = values.bonus === undefined ? undefined : Number(values.bonus);
      if (!Number.isInteger(n) || n < 1 || (bonus !== undefined && !Number.isInteger(bonus))) {
        io.err("play needs an order number (and an integer --bonus if given).");
        return EXIT.local;
      }
      return runPlay(ctx, n, { from: values.from, place: values.place, bonus });
    }
    case "wait":
      return runWait(ctx, { timeoutSec: Number(values.timeout ?? 540), intervalMs: 2000 });
    case "say":
      if (!arg) break;
      return runSay(ctx, positionals.slice(1).join(" "));
  }
  io.err(USAGE);
  return EXIT.local;
}
```

`src/cli.ts`:

```ts
#!/usr/bin/env node
import { main } from "./main.js";

const code = await main(process.argv.slice(2), {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`)
});
process.exitCode = code;
```

(`runPlay`'s `{ from: undefined }` keys are fine: `buildCommand` checks `!== undefined`.)

- [ ] **Step 7: Run tests**

Run: `corepack pnpm --filter @sengoku-jidai/claude-player test`
Expected: PASS (full-game test may take several seconds). If the full-game test hits a rejected command, the assertion message shows the last lines — fix the order mapping, not the test.

- [ ] **Step 8: Smoke-test the real binary against a local dev server**

Run (a temporary port, NOT 18081):

```bash
corepack pnpm build:libs
PORT=3999 SQLITE_PATH=$(mktemp -d)/t.sqlite corepack pnpm --filter @sengoku-jidai/server exec tsx src/server.ts &
sleep 3
GAME=$(curl -s -XPOST localhost:3999/api/games -H 'content-type: application/json' -d '{"mode":"private_multiplayer","side":"red","name":"Me"}')
LINK="http://localhost:3999/g/$(echo "$GAME" | node -pe 'JSON.parse(require("fs").readFileSync(0)).gameId')#$(echo "$GAME" | node -pe 'JSON.parse(require("fs").readFileSync(0)).seats.find(s=>s.seat==="black").token')"
SENGOKU_SESSION=$(mktemp -d)/s.json corepack pnpm -s sengoku join "$LINK"; echo "exit=$?"
kill %1
```

Expected: board text printed, `exit=0`.

- [ ] **Step 9: Typecheck + lint, then commit**

Run: `corepack pnpm --filter @sengoku-jidai/claude-player typecheck && corepack pnpm lint`

```bash
git add packages/claude-player
git commit -m "feat(claude-player): sengoku CLI (join/status/play/wait/say) with integration game"
```

---

### Task 5: `/play-sengoku` skill and rules primer

**Files:**
- Create: `.claude/skills/play-sengoku/SKILL.md`, `.claude/skills/play-sengoku/rules.md`

**Interfaces:**
- Consumes: the CLI surface and exit codes from Task 4.

- [ ] **Step 1: Write `rules.md` from the engine source**

Read `packages/engine/src/rules.ts`, `actionSpaces.ts`, `legality.ts`, `supply.ts`, `scoring.ts`, `actions.ts`, `validate.ts`, `game.ts` (setup, recall), `view.ts` (`enumerateCardPlays`, `legalCommandsForState`) and write a concise primer (target ≤ 150 lines) with exactly these sections:

1. **Goal & game end** — VP from value stars / what scores and when; HQ elimination; `maxRounds`.
2. **Round structure** — deploy phase (alternating commander deployments from the initiative seat, pass), recall, how initiative changes (Plan initiative space).
3. **Action spaces** — one short paragraph each: Advance, Sail, Bombard, Shell, Reinforce, Embark, Plan; which are linked to an area; "one of each support type per round" if the engine enforces it (`supportTypeOccupied`); a source keeps one unit.
4. **Supply** — what supply is, why it matters for which actions are legal.
5. **Combat** — who rolls, how many dice (attackers/defenders, fort +1 on land Advance), how casualties resolve, rolled → reroll/resolve step, bombard/shell dice.
6. **Operation cards** — the 8 cards (match `CARD_TEXT` in `packages/claude-player/src/board.ts`) + "any card can be discarded to reroll".
7. **Bonuses** — the 6 bonus tiles (`BonusType`) and their effects.
8. **Stacking caps** — `capExceeded` behaviour if the engine has caps.

Every statement must be checked against the named source file; where the engine and your intuition about the board game differ, the engine wins. No area ids in examples.

- [ ] **Step 2: Write `SKILL.md`**

```markdown
---
name: play-sengoku
description: Play a game of General Orders: Sengoku Jidai against a human, as one seat of an online game, given its invite link. Use when the user runs /play-sengoku <invite-link> or asks Claude to play/join a Sengoku game.
argument-hint: <invite-link>
allowed-tools: Bash(corepack pnpm -s sengoku:*), Bash(corepack pnpm -s build:libs), Read
---

# Play Sengoku Jidai

You are playing one seat of an online game against a human who is using the web app.
You act only through the `sengoku` CLI in this repo. Read `rules.md` (next to this file) once
before your first move.

## Setup

1. `corepack pnpm -s build:libs` (builds the CLI; once per session).
2. `corepack pnpm -s sengoku join "<invite-link>" --name Claude`
3. Greet briefly: `corepack pnpm -s sengoku say "Good luck — may your supply lines hold."`

## Turn loop

Repeat until the game is over:

1. `corepack pnpm -s sengoku wait` — blocks up to ~9 min. Prints the opponent's moves and chat.
   - exit 0 → your turn, go on. exit 3 → still waiting, run `wait` again. exit 2 → game over.
2. `corepack pnpm -s sengoku status` — board + numbered orders.
3. Think: threats to your HQ and supply, value stars you can take or defend, commanders left
   for both sides, cards in hand (don't waste them; keep one to reroll a critical combat).
4. `corepack pnpm -s sengoku play <n> [--from A:N,...] [--place A:N,...] [--bonus K]`
   - exit 0 → the board after your move is printed; if it still lists orders for you
     (e.g. a combat roll, a decision), continue from step 3; otherwise back to step 1.
   - exit 1 → your arguments were wrong; the message names the limit. Fix and retry.
   - exit 4 → stale or rejected; run `status` and choose again.
   - exit 5 → token rejected; stop and ask the human for a fresh invite link.

Combat rolls you owe (e.g. defending when the human advances) show up as orders on the
human's turn — `wait` returns 0 for them too.

## Chat etiquette

- Reply when the human speaks to you; otherwise at most one short line every few turns.
- Never mention area ids (like L7 or S2) in chat — describe places in words
  ("your northern fort", "the river mouth").
- No running commentary on every move, no gloating.

## Game over (exit 2)

Say "gg" plus one line on what decided the game, then tell the human in the terminal who won
and the final VP.
```

- [ ] **Step 3: Dry-run the skill instructions**

Against the local server from Task 4 Step 8, follow SKILL.md literally for three of your own turns (use a second session file to play the other seat via `play`). Fix any step that doesn't work as written.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/play-sengoku
git commit -m "feat: /play-sengoku skill and rules primer for the Claude Code opponent"
```

(Only add `.claude/skills/play-sengoku` — the rest of `.claude/` is local and must stay untracked.)

---

### Task 6: Full gate, Docker, PR

**Files:** none new.

- [ ] **Step 1: Full gate**

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
corepack pnpm build
corepack pnpm exec prettier --write . && corepack pnpm exec prettier --check .
```

Expected: all green. Commit any prettier changes: `git commit -am "style: prettier"`.

- [ ] **Step 2: Docker image**

Run: `docker build -t sengoku-jidai-web:test .`
Expected: builds (runtime `pnpm install --prod --frozen-lockfile` succeeds with the new importer).

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin claude-code-opponent
gh pr create --title "feat: play against a Claude Code session (sengoku CLI + /play-sengoku skill)" --body "…summary, test plan…

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr checks --watch
```

Do not merge — ask Martin first. After merge (prod auto-deploys), play one real game against prod with `/play-sengoku <prod invite link>` and note any rough edges as follow-ups.

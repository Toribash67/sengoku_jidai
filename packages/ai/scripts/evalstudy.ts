/**
 * Play games and log every quiet position with what the scoring function saw, so the scores can
 * be checked against who went on to win.
 *
 *   tsx scripts/evalstudy.ts --red alphabeta:depth=3 --black expecti:depth=3 \
 *     --seed-prefix study --from 0 --to 50 --out study.jsonl
 *
 * One JSON line per game: { seed, red, black, winner, endReason, rounds, vp, rows[] }. Each row
 * is a position with no battle or decision pending, taken just before a command.
 */
import { appendFileSync } from "node:fs";
import {
  createInitialState,
  gameBoard,
  getMap,
  resolveCommand,
  suppliedAreas,
  victoryPoints,
  type GameState,
  type MapDefinition,
  type SeatId
} from "@sengoku-jidai/engine";
import { DEFAULT_WEIGHTS, evaluate, parseBotSpec } from "../src/index.js";
import { hqDistances } from "../src/geometry.js";
import { onTheClock } from "../src/onclock.js";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const other = (s: SeatId): SeatId => (s === "red" ? "black" : "red");

function seatFeatures(state: GameState, map: MapDefinition, seat: SeatId) {
  const supplied = suppliedAreas(map, gameBoard(state), seat);
  const myHq = hqDistances(map, seat);
  const enemyHq = hqDistances(map, other(seat));
  const p = state.players[seat];
  const occupied = Object.values(state.actionSpaces).filter((o) => o === seat).length;
  const f = {
    starsSup: 0,
    starsUnsup: 0,
    bonus: {} as Record<string, number>,
    /** The three parts of the current military term: presence × (stars | bonus slot | proximity). */
    pStar: 0,
    pSlot: 0,
    pProx: 0,
    presSup: 0,
    unitsSup: 0,
    unitsUnsup: 0,
    ships: 0,
    tiles: 0,
    hand: p.hand.length,
    init: state.initiative === seat ? 1 : 0,
    hqUnits: 0,
    /** Own units one / two steps from the ENEMY HQ. */
    near1: 0,
    near2: 0,
    reserve: p.reserve.troop + p.reserve.ship,
    cmdLeft: p.commanders.total - occupied - p.commanders.standby - p.commanders.counterattacks,
    passed: p.passed ? 1 : 0
  };
  for (const [id, rt] of Object.entries(state.areas)) {
    if (rt.owner !== seat) continue;
    const units = rt.units.troop + rt.units.ship;
    if (units <= 0) continue;
    const area = map.areas[id]!;
    const sup = supplied.has(id);
    const sf = sup ? 1 : DEFAULT_WEIGHTS.unsuppliedFactor;
    const pres = 1 + Math.log2(units);
    if (sup) f.starsSup += area.valueStars;
    else f.starsUnsup += area.valueStars;
    const bonus = state.bonuses[id];
    if (bonus && sup) f.bonus[bonus] = (f.bonus[bonus] ?? 0) + 1;
    const d = enemyHq.get(id);
    f.pStar += area.valueStars * pres * sf;
    f.pSlot += (map.bonusSlots.includes(id) ? 1 : 0) * pres * sf;
    f.pProx += (d === undefined ? 0 : 1 / (d + 1)) * pres * sf;
    if (sup) {
      f.presSup += pres;
      f.unitsSup += units;
    } else f.unitsUnsup += units;
    f.ships += rt.units.ship;
    f.tiles += 1;
    if (myHq.get(id) === 0) f.hqUnits = units;
    if (d === 1) f.near1 += units;
    if (d === 2) f.near2 += units;
  }
  return f;
}

function playGame(redSpec: string, blackSpec: string, seed: string) {
  const bots = { red: parseBotSpec(redSpec).make(), black: parseBotSpec(blackSpec).make() };
  let state = createInitialState({ gameId: seed, seed });
  const map = getMap(state.mapId);
  const rows: unknown[] = [];
  let n = 0;
  while (state.status === "active") {
    const seat = onTheClock(state);
    if (!seat) break;
    if (!state.pendingCombat && !state.pendingDecision) {
      rows.push({
        n,
        round: state.round,
        toMove: seat,
        eval: evaluate(state, "red"),
        red: seatFeatures(state, map, "red"),
        black: seatFeatures(state, map, "black")
      });
    }
    const cmd = bots[seat].chooseCommand(state, seat);
    const r = resolveCommand(state, { seat }, cmd);
    if (r.status !== "accepted") throw new Error(`illegal command from ${seat}`);
    state = r.nextState;
    n++;
  }
  const board = gameBoard(state);
  return {
    seed,
    red: redSpec,
    black: blackSpec,
    winner: state.winner,
    endReason: state.endReason,
    rounds: state.round,
    commands: n,
    vp: { red: victoryPoints(map, board, "red"), black: victoryPoints(map, board, "black") },
    rows
  };
}

const red = flag("--red")!;
const black = flag("--black")!;
const prefix = flag("--seed-prefix") ?? "study";
const out = flag("--out")!;
for (let i = Number(flag("--from") ?? 0); i < Number(flag("--to") ?? 1); i++) {
  appendFileSync(out, JSON.stringify(playGame(red, black, `${prefix}-${i}`)) + "\n");
}

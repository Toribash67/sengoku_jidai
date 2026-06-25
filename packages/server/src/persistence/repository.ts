import {
  createInitialState,
  deserializeState,
  playerEvents,
  playerView,
  resolveCommand,
  serializeState,
  type Command,
  type GameEvent,
  type GameMode,
  type GameState,
  type PlayerGameEvent,
  type PlayerGameView,
  type SeatId
} from "@sengoku-jidai/engine";
import type { GameSeatInfo, SeatStatus } from "@sengoku-jidai/shared";
import { randomUUID } from "node:crypto";
import { issueToken } from "../sessions/tokens.js";
import type { SqliteDatabase } from "./database.js";

export interface SessionRecord {
  id: string;
  gameId: string;
  seat: SeatId;
}

export interface SeatTokenRecord {
  seat: SeatId;
  token: string;
}

export interface CreatedGame {
  gameId: string;
  seat: SeatId;
  revision: number;
  view: PlayerGameView;
  seats: SeatTokenRecord[];
  seatInfo: GameSeatInfo[];
}

export interface CommandSubmission {
  status: "accepted" | "rejected" | "stale" | "duplicate";
  httpStatus: number;
  revision: number;
  view?: PlayerGameView;
  events?: PlayerGameEvent[];
  error?: { code: string; message: string };
}

interface GameRow {
  id: string;
  mode: GameMode;
  current_revision: number;
}

interface SnapshotRow {
  state_json: string;
}

interface SessionRow {
  id: string;
  game_id: string;
  seat: SeatId;
}

interface AttemptRow {
  result_status: "accepted" | "rejected";
  accepted_revision: number | null;
  rejection_code: string | null;
}

interface SeatInfoRow {
  seat: SeatId;
  display_name: string | null;
  status: SeatStatus;
}

export class GameRepository {
  constructor(private readonly db: SqliteDatabase) {}

  getSeatInfo(gameId: string): GameSeatInfo[] {
    const rows = this.db
      .prepare("SELECT seat, display_name, status FROM game_seats WHERE game_id = ? ORDER BY seat")
      .all(gameId) as SeatInfoRow[];
    return rows.map((r) => ({ seat: r.seat, name: r.display_name, status: r.status }));
  }

  createGame(
    mode: GameMode,
    seed?: string,
    opts: { creatorName?: string; creatorSide?: SeatId } = {}
  ): CreatedGame {
    const gameId = randomUUID();
    const now = new Date().toISOString();
    const state = createInitialState({ gameId, mode, seed: seed ?? randomUUID() });
    const creatorSide: SeatId = opts.creatorSide ?? "red";
    const named = opts.creatorName !== undefined;
    const seatTokens: SeatTokenRecord[] = [];

    const create = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO games
            (id, map_id, mode, ruleset_id, ruleset_version, ruleset_hash, status, current_revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          gameId,
          state.mapId,
          state.mode,
          state.rules.rulesetId,
          state.rules.rulesetVersion,
          state.rules.rulesetHash,
          state.status,
          state.revision,
          now,
          now
        );

      for (const seat of ["red", "black"] as const) {
        const isCreator = seat === creatorSide;
        const status: SeatStatus = !named || isCreator ? "claimed" : "open";
        const displayName = !named ? seat : isCreator ? opts.creatorName! : null;
        const claimedAt = status === "claimed" ? now : null;
        this.db
          .prepare(
            `INSERT INTO game_seats
              (game_id, seat, player_id, status, display_name, claimed_at, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(gameId, seat, seat, status, displayName, claimedAt, now);

        const token = issueToken();
        seatTokens.push({ seat, token: token.token });
        this.db
          .prepare(
            `INSERT INTO game_sessions
              (id, token_hash, game_id, seat, created_at, last_seen_at, revoked_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL)`
          )
          .run(token.id, token.tokenHash, gameId, seat, now, now);
      }

      this.insertSnapshot(state, now);
    });

    create();

    return {
      gameId,
      seat: creatorSide,
      revision: state.revision,
      view: playerView(state, creatorSide),
      seats: seatTokens,
      seatInfo: this.getSeatInfo(gameId)
    };
  }

  getSession(tokenHash: string): SessionRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, game_id, seat
         FROM game_sessions
         WHERE token_hash = ? AND revoked_at IS NULL`
      )
      .get(tokenHash) as SessionRow | undefined;

    if (!row) {
      return null;
    }

    this.db
      .prepare("UPDATE game_sessions SET last_seen_at = ? WHERE id = ?")
      .run(new Date().toISOString(), row.id);

    return {
      id: row.id,
      gameId: row.game_id,
      seat: row.seat
    };
  }

  getPlayerView(
    gameId: string,
    seat: SeatId
  ): { revision: number; view: PlayerGameView; seatInfo: GameSeatInfo[] } | null {
    const game = this.getGameRow(gameId);
    if (!game) {
      return null;
    }
    const state = this.loadSnapshot(gameId, game.current_revision);
    return {
      revision: game.current_revision,
      view: playerView(state, seat),
      seatInfo: this.getSeatInfo(gameId)
    };
  }

  claimSeat(
    gameId: string,
    seat: SeatId,
    name: string
  ): { revision: number; view: PlayerGameView; seatInfo: GameSeatInfo[] } | null {
    const game = this.getGameRow(gameId);
    if (!game) {
      return null;
    }
    const row = this.db
      .prepare("SELECT status FROM game_seats WHERE game_id = ? AND seat = ?")
      .get(gameId, seat) as { status: SeatStatus } | undefined;
    if (!row) {
      return null;
    }
    if (row.status === "open") {
      this.db
        .prepare(
          "UPDATE game_seats SET display_name = ?, status = 'claimed', claimed_at = ? WHERE game_id = ? AND seat = ?"
        )
        .run(name, new Date().toISOString(), gameId, seat);
    }
    const state = this.loadSnapshot(gameId, game.current_revision);
    return {
      revision: game.current_revision,
      view: playerView(state, seat),
      seatInfo: this.getSeatInfo(gameId)
    };
  }

  submitCommand(
    gameId: string,
    session: SessionRecord,
    baseRevision: number,
    clientCommandId: string,
    command: Command
  ): CommandSubmission {
    const submit = this.db.transaction(() => {
      const duplicate = this.findCommandAttempt(gameId, session.seat, clientCommandId);
      if (duplicate) {
        return this.duplicateCommandResult(gameId, session.seat, duplicate);
      }

      const game = this.getGameRow(gameId);
      if (!game) {
        return {
          status: "rejected",
          httpStatus: 404,
          revision: baseRevision,
          error: { code: "gameNotFound", message: "Game was not found." }
        } satisfies CommandSubmission;
      }

      if (game.current_revision !== baseRevision) {
        const state = this.loadSnapshot(gameId, game.current_revision);
        return {
          status: "stale",
          httpStatus: 409,
          revision: game.current_revision,
          view: playerView(state, session.seat),
          error: { code: "staleRevision", message: "The game has advanced. Refresh and try again." }
        } satisfies CommandSubmission;
      }

      const state = this.loadSnapshot(gameId, baseRevision);
      const result = resolveCommand(state, { seat: session.seat }, command);
      const now = new Date().toISOString();

      if (result.status === "rejected") {
        this.insertCommandAttempt({
          gameId,
          seat: session.seat,
          clientCommandId,
          baseRevision,
          acceptedRevision: null,
          command,
          resultStatus: "rejected",
          rejectionCode: result.reason.code,
          now
        });
        return {
          status: "rejected",
          httpStatus: 422,
          revision: baseRevision,
          view: playerView(state, session.seat),
          error: result.reason
        } satisfies CommandSubmission;
      }

      this.insertSnapshot(result.nextState, now);
      this.insertEvents(gameId, result.nextState.revision, result.events, now);
      this.insertCommandAttempt({
        gameId,
        seat: session.seat,
        clientCommandId,
        baseRevision,
        acceptedRevision: result.nextState.revision,
        command,
        resultStatus: "accepted",
        rejectionCode: null,
        now
      });
      this.db
        .prepare("UPDATE games SET current_revision = ?, status = ?, updated_at = ? WHERE id = ?")
        .run(result.nextState.revision, result.nextState.status, now, gameId);

      return {
        status: "accepted",
        httpStatus: 200,
        revision: result.nextState.revision,
        view: playerView(result.nextState, session.seat),
        events: playerEvents(result.events)
      } satisfies CommandSubmission;
    });

    return submit();
  }

  eventsAfter(gameId: string, afterRevision: number): GameEvent[] {
    const rows = this.db
      .prepare(
        `SELECT event_json
         FROM game_events
         WHERE game_id = ? AND revision > ?
         ORDER BY revision ASC, sequence ASC`
      )
      .all(gameId, afterRevision) as { event_json: string }[];

    return rows.map((row) => JSON.parse(row.event_json) as GameEvent);
  }

  private duplicateCommandResult(
    gameId: string,
    seat: SeatId,
    attempt: AttemptRow
  ): CommandSubmission {
    const game = this.getGameRow(gameId);
    const revision = attempt.accepted_revision ?? game?.current_revision ?? 0;
    const state = this.loadSnapshot(gameId, revision);

    if (attempt.result_status === "accepted") {
      return {
        status: "duplicate",
        httpStatus: 200,
        revision,
        view: playerView(state, seat),
        events: attempt.accepted_revision
          ? this.eventsForRevision(gameId, attempt.accepted_revision)
          : []
      };
    }

    return {
      status: "duplicate",
      httpStatus: 422,
      revision,
      view: playerView(state, seat),
      error: {
        code: attempt.rejection_code ?? "commandRejected",
        message: "Command was already rejected."
      }
    };
  }

  private getGameRow(gameId: string): GameRow | null {
    const row = this.db
      .prepare("SELECT id, mode, current_revision FROM games WHERE id = ?")
      .get(gameId) as GameRow | undefined;
    return row ?? null;
  }

  private loadSnapshot(gameId: string, revision: number): GameState {
    const row = this.db
      .prepare("SELECT state_json FROM game_snapshots WHERE game_id = ? AND revision = ?")
      .get(gameId, revision) as SnapshotRow | undefined;
    if (!row) {
      throw new Error(`Missing snapshot for ${gameId} at revision ${revision}`);
    }
    return deserializeState(JSON.parse(row.state_json) as GameState);
  }

  private insertSnapshot(state: GameState, now: string): void {
    this.db
      .prepare(
        `INSERT INTO game_snapshots (game_id, revision, state_json, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(state.gameId, state.revision, JSON.stringify(serializeState(state)), now);
  }

  private insertEvents(gameId: string, revision: number, events: GameEvent[], now: string): void {
    const insert = this.db.prepare(
      `INSERT INTO game_events (game_id, revision, sequence, event_type, event_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    events.forEach((event, index) => {
      insert.run(gameId, revision, index, event.type, JSON.stringify(event), now);
    });
  }

  private eventsForRevision(gameId: string, revision: number): GameEvent[] {
    const rows = this.db
      .prepare(
        `SELECT event_json
         FROM game_events
         WHERE game_id = ? AND revision = ?
         ORDER BY sequence ASC`
      )
      .all(gameId, revision) as { event_json: string }[];
    return rows.map((row) => JSON.parse(row.event_json) as GameEvent);
  }

  private findCommandAttempt(
    gameId: string,
    seat: SeatId,
    clientCommandId: string
  ): AttemptRow | null {
    const row = this.db
      .prepare(
        `SELECT result_status, accepted_revision, rejection_code
         FROM game_command_attempts
         WHERE game_id = ? AND seat = ? AND client_command_id = ?`
      )
      .get(gameId, seat, clientCommandId) as AttemptRow | undefined;
    return row ?? null;
  }

  private insertCommandAttempt(input: {
    gameId: string;
    seat: SeatId;
    clientCommandId: string;
    baseRevision: number;
    acceptedRevision: number | null;
    command: Command;
    resultStatus: "accepted" | "rejected";
    rejectionCode: string | null;
    now: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO game_command_attempts
          (id, game_id, seat, client_command_id, base_revision, accepted_revision, command_json, result_status, rejection_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        input.gameId,
        input.seat,
        input.clientCommandId,
        input.baseRevision,
        input.acceptedRevision,
        JSON.stringify(input.command),
        input.resultStatus,
        input.rejectionCode,
        input.now
      );
  }
}

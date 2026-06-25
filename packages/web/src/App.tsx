import type {
  Command,
  LegalCardPlay,
  LegalMove,
  LegalPlacement,
  LegalPlan,
  LegalStrike,
  OperationCard,
  PendingChoice,
  PlayerGameEvent,
  PlayerGameView,
  SeatId
} from "@sengoku-jidai/engine";
import { getMap } from "@sengoku-jidai/engine";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { ActionBar } from "./components/board/ActionBar.js";
import { AreaDetails } from "./components/board/AreaDetails.js";
import { CardPreview } from "./components/board/CardPreview.js";
import { cardLabel } from "./components/board/cardImages.js";
import { CombatPanel } from "./components/board/CombatPanel.js";
import { PendingDecisionPanel } from "./components/board/PendingDecisionPanel.js";
import { Hand } from "./components/board/Hand.js";
import { describeArea } from "./components/board/areaLabel.js";
import {
  type ComposerState,
  largestPlacementPerType,
  stagedCountsFor
} from "./components/board/composer.js";
import { MapBoard } from "./components/board/MapBoard.js";
import { ApiError, createHotseatGame, fetchGameView, submitCommand } from "./client/api.js";
import {
  clearStoredGame,
  loadPanelWidth,
  loadStoredGame,
  savePanelWidth,
  saveStoredGame,
  type StoredGame
} from "./state/localGame.js";

const MIN_PANEL_WIDTH = 260;
const MIN_MAP_WIDTH = 360;
const DEFAULT_PANEL_WIDTH = 340;

interface LoadedGame extends StoredGame {
  revision: number;
  view: PlayerGameView;
}

export function App() {
  const [game, setGame] = useState<LoadedGame | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  // The source the stepper adjusts (the last-clicked glowing tile during a move).
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  // The hand card shown in the large preview overlay, if any.
  const [previewCard, setPreviewCard] = useState<OperationCard | null>(null);
  // A card being played: the user has chosen it and now picks the target tile on the map
  // (move/strike cards). Placement cards skip this and open their composer directly.
  const [playingCard, setPlayingCard] = useState<LegalCardPlay | null>(null);
  const [events, setEvents] = useState<PlayerGameEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(() => loadPanelWidth() ?? DEFAULT_PANEL_WIDTH);
  const layoutRef = useRef<HTMLElement>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    savePanelWidth(panelWidth);
  }, [panelWidth]);

  // Forget the active source whenever the composed order changes or clears.
  useEffect(() => {
    setActiveSourceId(null);
  }, [composer?.spaceId]);

  function handleDividerPointerDown(event: PointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleDividerPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current || !layoutRef.current) {
      return;
    }
    const rect = layoutRef.current.getBoundingClientRect();
    const max = Math.max(MIN_PANEL_WIDTH, rect.width - MIN_MAP_WIDTH);
    const next = Math.min(Math.max(rect.right - event.clientX, MIN_PANEL_WIDTH), max);
    setPanelWidth(next);
  }

  function handleDividerPointerUp(event: PointerEvent<HTMLDivElement>) {
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  useEffect(() => {
    const stored = loadStoredGame();
    if (!stored) {
      return;
    }

    const token = stored.seats.find((seat) => seat.seat === stored.activeSeat)?.token;
    if (!token) {
      clearStoredGame();
      return;
    }

    void fetchGameView(stored.gameId, token)
      .then((envelope) => {
        setGame({ ...stored, revision: envelope.revision, view: envelope.view });
      })
      .catch(() => {
        clearStoredGame();
      });
  }, []);

  const selectedArea = useMemo(
    () => game?.view.areas.find((area) => area.id === selectedAreaId) ?? null,
    [game?.view.areas, selectedAreaId]
  );

  const selectedMapArea = useMemo(
    () => (game && selectedAreaId ? (getMap(game.view.mapId).areas[selectedAreaId] ?? null) : null),
    [game, selectedAreaId]
  );

  // Glowing (non-interactive) targets while not composing: advance/sail destinations — or, when
  // a move/strike card is being played, the destinations / linked areas it unlocks.
  const legalTargetIds = useMemo(() => {
    if (composer) {
      return new Set<string>();
    }
    if (playingCard?.moves) {
      return new Set(playingCard.moves.map((m) => m.targetAreaId));
    }
    if (playingCard?.strikes) {
      return new Set(playingCard.strikes.map((s) => s.linkedAreaId));
    }
    if (playingCard) {
      return new Set<string>();
    }
    return new Set((game?.view.legal.moves ?? []).map((m) => m.targetAreaId));
  }, [composer, playingCard, game?.view.legal.moves]);
  // Glowing, clickable tiles for the active composer: move sources, or strike/placement
  // targets. Plan has no tiles.
  const sourceIds = useMemo(() => {
    if (!composer) {
      return new Set<string>();
    }
    if (composer.kind === "move") {
      return new Set(composer.sources.map((s) => s.areaId));
    }
    if (composer.kind === "strike" || composer.kind === "placement") {
      return new Set(composer.targets);
    }
    return new Set<string>();
  }, [composer]);

  // Orders contextual to the selected tile: an advance/sail into it, or a bombard/shell
  // linked to it. Offered as buttons in the bottom action bar (same matching as before).
  // While a card is being played, contextual orders come from the card's (modified) options
  // rather than the base legal lists; otherwise from what the selected tile allows.
  const contextualMove = useMemo(() => {
    if (!selectedAreaId) {
      return null;
    }
    const source = playingCard?.moves ?? game?.view.legal.moves ?? [];
    return source.find((m) => m.targetAreaId === selectedAreaId) ?? null;
  }, [playingCard, game?.view.legal.moves, selectedAreaId]);
  const contextualStrike = useMemo(() => {
    if (!selectedAreaId) {
      return null;
    }
    const source = playingCard?.strikes ?? game?.view.legal.strikes ?? [];
    return source.find((s) => s.linkedAreaId === selectedAreaId) ?? null;
  }, [playingCard, game?.view.legal.strikes, selectedAreaId]);

  // Staged units per area for the active move/placement, drawn as on-map badges.
  const stagedCounts = useMemo(() => stagedCountsFor(composer), [composer]);

  // Offer only the largest open space per placement type (e.g. Reinforce 6 over 5) to keep
  // the order panel uncluttered; the smaller one reappears once the larger is occupied.
  const placements = useMemo(
    () => largestPlacementPerType(game?.view.legal.placements ?? []),
    [game?.view.legal.placements]
  );

  // Cards in hand that can be played with a deploying commander right now.
  const cardPlays = useMemo(() => game?.view.legal.cardPlays ?? [], [game?.view.legal.cardPlays]);
  const playableCards = useMemo(() => new Set(cardPlays.map((p) => p.card)), [cardPlays]);

  async function handleCreateGame() {
    setBusy(true);
    setError(null);
    try {
      const created = await createHotseatGame();
      const stored: StoredGame = {
        gameId: created.gameId,
        activeSeat: created.seat,
        seats: created.seats
      };
      saveStoredGame(stored);
      setGame({ ...stored, revision: created.revision, view: created.view });
      setSelectedAreaId(null);
      setComposer(null);
      setPlayingCard(null);
      setEvents([]);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleSwitchSeat(seat: SeatId) {
    if (!game) {
      return;
    }
    const token = game.seats.find((seatToken) => seatToken.seat === seat)?.token;
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const envelope = await fetchGameView(game.gameId, token);
      const stored = { gameId: game.gameId, activeSeat: seat, seats: game.seats };
      saveStoredGame(stored);
      setGame({ ...stored, revision: envelope.revision, view: envelope.view });
      setSelectedAreaId(null);
      setComposer(null);
      setPlayingCard(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function startOrder(move: LegalMove, card?: OperationCard, bonusMax?: number) {
    setComposer({
      kind: "move",
      spaceId: move.spaceId,
      type: move.type,
      targetAreaId: move.targetAreaId,
      sources: move.sources.map((s) => ({ areaId: s.areaId, max: s.max })),
      counts: {},
      card,
      bonus: bonusMax !== undefined ? 0 : undefined,
      bonusMax
    });
    setPlayingCard(null);
  }

  function startStrike(strike: LegalStrike, card?: OperationCard) {
    setComposer({
      kind: "strike",
      spaceId: strike.spaceId,
      type: strike.type,
      linkedAreaId: strike.linkedAreaId,
      targets: [...strike.targets],
      dice: strike.dice,
      targetAreaId: strike.targets.length === 1 ? strike.targets[0]! : null,
      card
    });
    setPlayingCard(null);
  }

  function startPlacement(placement: LegalPlacement, card?: OperationCard) {
    setComposer({
      kind: "placement",
      spaceId: placement.spaceId,
      type: placement.type,
      unit: placement.unit,
      targets: [...placement.targets],
      pool: placement.pool,
      reserve: placement.reserve,
      counts: {},
      card
    });
    setPlayingCard(null);
  }

  function startPlan(plan: LegalPlan) {
    setComposer({ kind: "plan", spaceId: plan.spaceId, initiative: plan.initiative });
  }

  // Begin playing a card. Placement cards (mobilise/commandeer) open their composer at once;
  // move/strike cards enter a "pick the target tile" mode driven by the card's glowing options.
  function startCardPlay(play: LegalCardPlay) {
    setPreviewCard(null);
    if (play.placements && play.placements.length > 0) {
      const best = play.placements.reduce((a, b) => (b.pool > a.pool ? b : a));
      startPlacement(best, play.card);
      return;
    }
    if (play.action === "bombard" && play.strikes && play.strikes.length === 1) {
      startStrike(play.strikes[0]!, play.card);
      return;
    }
    setComposer(null);
    setSelectedAreaId(null);
    setPlayingCard(play);
  }

  // Cancel any in-progress order or card play, returning to idle.
  function cancelOrder() {
    setComposer(null);
    setPlayingCard(null);
  }

  // Adjust the assault bonus (ground/river_assault) on the active move composer (0..bonusMax).
  function adjustBonus(delta: number) {
    setComposer((prev) => {
      if (prev?.kind !== "move" || prev.bonusMax === undefined) {
        return prev;
      }
      const next = clamp((prev.bonus ?? 0) + delta, 0, prev.bonusMax);
      return { ...prev, bonus: next };
    });
  }

  // Adjust a staged count for a move source or placement target, clamped to its bound:
  // a move source keeps one unit; a placement is bounded by min(pool, reserve) overall.
  function adjustCount(areaId: string, delta: number) {
    setComposer((prev) => {
      if (!prev) {
        return prev;
      }
      if (prev.kind === "move") {
        const source = prev.sources.find((s) => s.areaId === areaId);
        if (!source) {
          return prev;
        }
        const next = clamp((prev.counts[areaId] ?? 0) + delta, 0, source.max);
        return { ...prev, counts: { ...prev.counts, [areaId]: next } };
      }
      if (prev.kind === "placement") {
        if (!prev.targets.includes(areaId)) {
          return prev;
        }
        const cap = Math.min(prev.pool, prev.reserve);
        const others = Object.entries(prev.counts).reduce(
          (sum, [id, n]) => (id === areaId ? sum : sum + n),
          0
        );
        const next = clamp((prev.counts[areaId] ?? 0) + delta, 0, cap - others);
        return { ...prev, counts: { ...prev.counts, [areaId]: next } };
      }
      return prev;
    });
  }

  function selectStrikeTarget(areaId: string) {
    setComposer((prev) =>
      prev?.kind === "strike" && prev.targets.includes(areaId)
        ? { ...prev, targetAreaId: areaId }
        : prev
    );
  }

  // Tile selection. While composing a move, keep the gold highlight pinned to the target
  // being advanced/sailed into rather than letting it follow source clicks.
  function handleSelectArea(areaId: string) {
    if (composer?.kind === "move") {
      return;
    }
    setSelectedAreaId(areaId);
  }

  // A click on a glowing map tile during composition: pick the strike target, or stage a
  // unit for a move/placement (and mark it the active source for the stepper).
  function handleSourceClick(areaId: string) {
    if (composer?.kind === "strike") {
      selectStrikeTarget(areaId);
      return;
    }
    setActiveSourceId(areaId);
    adjustCount(areaId, 1);
  }

  async function handleConfirmOrder() {
    if (!game || !composer) {
      return;
    }
    const token = game.seats.find((seat) => seat.seat === game.activeSeat)?.token;
    if (!token) {
      setError("Missing seat token.");
      return;
    }
    const command = buildCommand(composer);
    if (!command) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await submitCommand(game.gameId, token, game.revision, command);
      if (response.view) {
        setGame({ ...game, revision: response.revision, view: response.view });
      }
      setEvents((previous) => [...(response.events ?? []), ...previous].slice(0, 8));
      setComposer(null);
      setPlayingCard(null);
      setSelectedAreaId(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handlePass() {
    if (!game) {
      return;
    }
    const token = game.seats.find((seat) => seat.seat === game.activeSeat)?.token;
    if (!token) {
      setError("Missing seat token.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await submitCommand(game.gameId, token, game.revision, { type: "pass" });
      if (response.view) {
        setGame({ ...game, revision: response.revision, view: response.view });
      }
      setEvents((previous) => [...(response.events ?? []), ...previous].slice(0, 8));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  // Drive the paused combat, all submitted by the viewer (the responsible seat): "combatRoll"
  // throws the dice, "combatReroll" discards a card to re-throw, "combatResolve" applies the
  // reviewed result.
  async function submitCombat(
    action:
      | { type: "combatRoll"; card?: OperationCard }
      | { type: "combatResolve" }
      | { type: "combatReroll"; card: OperationCard }
  ) {
    if (!game || !game.view.pendingCombat) {
      return;
    }
    const token = game.seats.find((seat) => seat.seat === game.activeSeat)?.token;
    if (!token) {
      setError("Missing seat token.");
      return;
    }
    const pendingId = game.view.pendingCombat.id;
    setBusy(true);
    setError(null);
    try {
      const response = await submitCommand(game.gameId, token, game.revision, {
        ...action,
        pendingId
      });
      if (response.view) {
        setGame({ ...game, revision: response.revision, view: response.view });
      }
      setEvents((previous) => [...(response.events ?? []), ...previous].slice(0, 8));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  // Answer a pending decision (the Ship Strike "Shell again / Decline" follow-up).
  async function submitDecision(choice: PendingChoice) {
    if (!game || !game.view.pendingDecision) {
      return;
    }
    const token = game.seats.find((seat) => seat.seat === game.activeSeat)?.token;
    if (!token) {
      setError("Missing seat token.");
      return;
    }
    const pendingId = game.view.pendingDecision.id;
    setBusy(true);
    setError(null);
    try {
      const response = await submitCommand(game.gameId, token, game.revision, {
        type: "choosePendingDecision",
        pendingId,
        choice
      });
      if (response.view) {
        setGame({ ...game, revision: response.revision, view: response.view });
      }
      setEvents((previous) => [...(response.events ?? []), ...previous].slice(0, 8));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!game) {
    return (
      <main className="app-shell app-empty">
        <section className="start-panel" aria-label="Start game">
          <h1>General Orders: Sengoku Jidai</h1>
          <button type="button" onClick={handleCreateGame} disabled={busy}>
            {busy ? "Creating..." : "New hotseat game"}
          </button>
          {error ? <p className="error-text">{error}</p> : null}
        </section>
      </main>
    );
  }

  const isViewerActive = game.view.activeSeat === game.activeSeat;

  // A paused combat replaces the order bar with the roll step.
  const pendingCombat = game.view.pendingCombat;
  const combatAreaLabel = pendingCombat
    ? describeArea(getMap(game.view.mapId).areas[pendingCombat.area]!)
    : "";
  // For advance/sail, the attackers are held off-board; surface them on the contested tile
  // so both sides are visible during combat (the defender is already on the board).
  const pendingAttack =
    pendingCombat && (pendingCombat.kind === "advance" || pendingCombat.kind === "sail")
      ? {
          area: pendingCombat.area,
          seat: pendingCombat.attacker,
          unit: pendingCombat.unit,
          count: pendingCombat.attackers ?? 0
        }
      : null;

  // During a move, the gold highlight stays on the target; the stepper and the solid source
  // ring follow the active source instead.
  const isMove = composer?.kind === "move";
  const goldAreaId = isMove ? composer.targetAreaId : selectedAreaId;
  const stepperAreaId = isMove ? activeSourceId : selectedAreaId;
  const mapActiveSourceId = isMove ? activeSourceId : null;

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <h1>General Orders: Sengoku Jidai</h1>
          <p>{game.view.prompt}</p>
        </div>
        <div className="top-stats" aria-label="Game status">
          <span>Round {game.view.round}</span>
          <span>{game.view.phase}</span>
          <span>Revision {game.revision}</span>
          <span>{game.view.activeSeat} to act</span>
          <span>
            VP {game.view.victoryPoints.red}–{game.view.victoryPoints.black}
          </span>
        </div>
      </header>

      <section
        className="game-layout"
        ref={layoutRef}
        style={{ "--panel-width": `${panelWidth}px` } as CSSProperties}
      >
        <div className="board-column">
          <MapBoard
            areas={game.view.areas}
            activeSeat={game.view.activeSeat}
            selectedAreaId={goldAreaId}
            actionSpaces={game.view.actionSpaces}
            onSelectArea={handleSelectArea}
            legalTargetIds={legalTargetIds}
            sourceIds={sourceIds}
            onSourceClick={handleSourceClick}
            stagedCounts={stagedCounts}
            activeSourceId={mapActiveSourceId}
            pendingAttack={pendingAttack}
          />

          {pendingCombat ? (
            <CombatPanel
              pendingCombat={pendingCombat}
              areaLabel={combatAreaLabel}
              canRoll={game.view.legal.canRollCombat}
              canResolve={game.view.legal.canResolveCombat}
              canReroll={game.view.legal.canRerollCombat}
              canAmbush={game.view.legal.canAmbush}
              busy={busy}
              onRoll={() => submitCombat({ type: "combatRoll" })}
              onRollAmbush={() => submitCombat({ type: "combatRoll", card: "ambush" })}
              onResolve={() => submitCombat({ type: "combatResolve" })}
            />
          ) : game.view.pendingDecision ? (
            <PendingDecisionPanel
              decision={game.view.pendingDecision}
              busy={busy}
              onChoose={submitDecision}
              renderLabel={
                game.view.pendingDecision.kind === "selectCombat"
                  ? (choice) => {
                      const area = getMap(game.view.mapId).areas[choice.id];
                      return area ? describeArea(area) : choice.label;
                    }
                  : undefined
              }
            />
          ) : (
            <ActionBar
              composer={composer}
              isViewerActive={isViewerActive}
              busy={busy}
              selectedAreaId={stepperAreaId}
              cardModeLabel={playingCard ? cardLabel(playingCard.card) : null}
              contextualMove={contextualMove}
              contextualStrike={contextualStrike}
              placements={placements}
              plans={game.view.legal.plans}
              canPass={game.view.legal.canPass}
              onStartOrder={(move) => startOrder(move, playingCard?.card, playingCard?.bonusMax)}
              onStartStrike={(strike) => startStrike(strike, playingCard?.card)}
              onStartPlacement={startPlacement}
              onStartPlan={startPlan}
              onPass={handlePass}
              onAdjust={adjustCount}
              onAdjustBonus={adjustBonus}
              onConfirm={handleConfirmOrder}
              onCancel={cancelOrder}
            />
          )}
        </div>

        <div
          className="layout-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize map and panel"
          onPointerDown={handleDividerPointerDown}
          onPointerMove={handleDividerPointerMove}
          onPointerUp={handleDividerPointerUp}
        />

        <aside className="side-panel" aria-label="Command panel">
          <div className="seat-switcher" role="group" aria-label="Seat">
            {game.seats.map((seat) => (
              <button
                key={seat.seat}
                type="button"
                className={seat.seat === game.activeSeat ? "is-active" : ""}
                onClick={() => handleSwitchSeat(seat.seat)}
                disabled={busy}
              >
                {seat.seat}
              </button>
            ))}
          </div>

          <section className="panel-section">
            <h2>{selectedMapArea ? describeArea(selectedMapArea) : "Select an area"}</h2>
            {selectedArea && selectedMapArea ? (
              <AreaDetails area={selectedArea} mapArea={selectedMapArea} view={game.view} />
            ) : (
              <p className="muted">Tap an area on the map to see its details.</p>
            )}
          </section>

          <section className="panel-section">
            <Hand
              hand={game.view.hand}
              opponentHandCount={game.view.opponentHandCount}
              canReroll={game.view.legal.canRerollCombat}
              playableCards={playableCards}
              onPreview={setPreviewCard}
            />
          </section>

          <section className="panel-section">
            <h2>Recent events</h2>
            {events.length === 0 ? (
              <p className="muted">No commands submitted yet.</p>
            ) : (
              <ol className="event-log">
                {events.map((event, index) => (
                  <li key={`${event.type}-${index}`}>{eventLabel(event)}</li>
                ))}
              </ol>
            )}
          </section>

          <button
            type="button"
            className="secondary-action"
            onClick={() => {
              clearStoredGame();
              setGame(null);
            }}
          >
            Clear local game
          </button>

          {error ? <p className="error-text">{error}</p> : null}
        </aside>
      </section>

      {previewCard ? (
        <CardPreview
          card={previewCard}
          canReroll={game.view.legal.canRerollCombat}
          canPlay={playableCards.has(previewCard)}
          busy={busy}
          onDiscard={(card) => {
            setPreviewCard(null);
            void submitCombat({ type: "combatReroll", card });
          }}
          onPlay={(card) => {
            const play = cardPlays.find((p) => p.card === card);
            if (play) {
              startCardPlay(play);
            }
          }}
          onClose={() => setPreviewCard(null)}
        />
      ) : null}
    </main>
  );
}

/** Build the engine Command for the composed order, or null if nothing is staged yet
 *  (no units chosen / no strike target). */
function buildCommand(composer: ComposerState): Command | null {
  switch (composer.kind) {
    case "move": {
      const moves = composer.sources
        .map((s) => ({ from: s.areaId, count: composer.counts[s.areaId] ?? 0 }))
        .filter((m) => m.count > 0);
      if (moves.length === 0) {
        return null;
      }
      // advance and sail share the same { spaceId, moves } payload. An assault card also carries
      // its 0–2 reserve bonus; counterattack (no bonusMax) carries only the card.
      const cardFields = composer.card
        ? {
            card: composer.card,
            ...(composer.bonusMax !== undefined ? { cardBonus: composer.bonus ?? 0 } : {})
          }
        : {};
      return { type: composer.type, spaceId: composer.spaceId, moves, ...cardFields } as Command;
    }
    case "placement": {
      const placements = composer.targets
        .map((area) => ({ area, count: composer.counts[area] ?? 0 }))
        .filter((p) => p.count > 0);
      if (placements.length === 0) {
        return null;
      }
      return {
        type: composer.type,
        spaceId: composer.spaceId,
        placements,
        ...(composer.card ? { card: composer.card } : {})
      } as Command;
    }
    case "strike":
      return composer.targetAreaId
        ? ({
            type: composer.type,
            spaceId: composer.spaceId,
            targetAreaId: composer.targetAreaId,
            ...(composer.card ? { card: composer.card } : {})
          } as Command)
        : null;
    case "plan":
      return { type: "plan", spaceId: composer.spaceId };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function eventLabel(event: PlayerGameEvent): string {
  switch (event.type) {
    case "diceRolled":
      return `${event.seat} rolled [${event.rolls.join(", ")}] = ${event.total} (${event.purpose})`;
    case "unitsRemoved":
      return `${event.seat} lost ${event.count} ${event.unit}${event.count === 1 ? "" : "s"}`;
    case "unitsMoved":
      return `${event.seat} moved ${event.count} ${event.unit}${event.count === 1 ? "" : "s"}`;
    case "unitsPlaced":
      return `${event.seat} placed ${event.count} ${event.unit}${event.count === 1 ? "" : "s"}`;
    case "areaCaptured":
      return `${event.seat} captured an area`;
    case "cardsDrawn":
      return `${event.seat} drew ${event.count} ${event.count === 1 ? "card" : "cards"}`;
    case "cardDiscarded":
      return `${event.seat} discarded a card to reroll`;
    case "cardPlayed":
      return `${event.seat} played ${cardLabel(event.card)}`;
    default:
      if ("seat" in event && typeof event.seat === "string") {
        return `${event.seat}: ${event.type}`;
      }
      return event.type;
  }
}

function errorMessage(caught: unknown): string {
  if (caught instanceof ApiError) {
    const body = caught.body as { error?: { message?: string } };
    return body.error?.message ?? caught.message;
  }
  if (caught instanceof Error) {
    return caught.message;
  }
  return "Unexpected error.";
}

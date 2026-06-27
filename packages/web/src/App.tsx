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
import {
  type ArmedOrder,
  armMove,
  armStrike,
  candidateTiles,
  resolveArmedTile,
  verbAvailability
} from "./components/board/orders.js";
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
  VERB,
  largestPlacementPerType,
  stagedCountsFor
} from "./components/board/composer.js";
import { MapBoard } from "./components/board/MapBoard.js";
import type { GameSeatInfo, SeatToken } from "@sengoku-jidai/shared";
import {
  ApiError,
  claimSeat,
  createGame,
  fetchEvents,
  fetchGameView,
  submitCommand
} from "./client/api.js";
import {
  forgetGame,
  loadPanelWidth,
  loadSeatTokens,
  rememberSeatTokens,
  savePanelWidth
} from "./state/localGame.js";
import { gameUrl, inviteUrl, navigateTo, useRoute } from "./state/route.js";
import { shouldPoll } from "./state/polling.js";
import { CreateGameScreen } from "./components/CreateGameScreen.js";
import { ClaimSeatPrompt } from "./components/ClaimSeatPrompt.js";
import { PlayersPanel } from "./components/PlayersPanel.js";

const MIN_PANEL_WIDTH = 260;
const MIN_MAP_WIDTH = 360;
const DEFAULT_PANEL_WIDTH = 340;

interface LoadedGame {
  gameId: string;
  token: string;
  heldSeats: SeatToken[];
  revision: number;
  view: PlayerGameView;
  seatInfo: GameSeatInfo[];
}

export function App() {
  const [game, setGame] = useState<LoadedGame | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  // The source the stepper adjusts (the last-clicked glowing tile during a move).
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  // The hand card shown in the large preview overlay, if any.
  const [previewCard, setPreviewCard] = useState<OperationCard | null>(null);
  // A move/strike order being targeted: the player armed a verb (or played a move/strike card)
  // and now picks a candidate tile on the map. Placement/Plan open their composer directly.
  const [armedOrder, setArmedOrder] = useState<ArmedOrder | null>(null);
  const [events, setEvents] = useState<PlayerGameEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(() => loadPanelWidth() ?? DEFAULT_PANEL_WIDTH);
  const layoutRef = useRef<HTMLElement>(null);
  const draggingRef = useRef(false);
  const route = useRoute();
  const loadedKeyRef = useRef<string | null>(null);

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

  // Load the seat named by the current /g/:id#token route. Keyed on the route only, so a
  // "view as" switch (which changes game.token but not the URL) does not trigger a reload.
  useEffect(() => {
    if (route.kind !== "game") {
      loadedKeyRef.current = null;
      setGame(null);
      return;
    }
    const { gameId, token } = route;
    const key = `${gameId}#${token}`;
    if (loadedKeyRef.current === key) {
      return;
    }
    loadedKeyRef.current = key;

    if (!token) {
      setError("This game link is missing its seat token.");
      return;
    }

    let cancelled = false;
    setBusy(true);
    setError(null);
    void fetchGameView(gameId, token)
      .then((envelope) => {
        if (cancelled) {
          return;
        }
        rememberSeatTokens(gameId, [{ seat: envelope.seat, token }]);
        setGame({
          gameId,
          token,
          heldSeats: loadSeatTokens(gameId),
          revision: envelope.revision,
          view: envelope.view,
          seatInfo: envelope.seatInfo
        });
        setSelectedAreaId(null);
        setComposer(null);
        setArmedOrder(null);
        setEvents([]);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(errorMessage(caught));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false);
        }
      });
    return () => {
      cancelled = true;
      // Release the key if this load was torn down before it finished (e.g. React
      // StrictMode's mount→unmount→remount in dev), so the remount re-fetches instead
      // of seeing the key already claimed and skipping the load.
      if (loadedKeyRef.current === key) {
        loadedKeyRef.current = null;
      }
    };
  }, [route]);

  const gameRef = useRef<LoadedGame | null>(null);
  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    if (!game || busy) {
      return;
    }
    if (!shouldPoll(game.view, game.seatInfo)) {
      return;
    }
    const interval = window.setInterval(() => {
      const current = gameRef.current;
      if (!current) {
        return;
      }
      void fetchGameView(current.gameId, current.token)
        .then(async (envelope) => {
          if (gameRef.current?.token !== current.token) {
            return; // seat switched mid-poll; drop this result
          }
          let newEvents: PlayerGameEvent[] = [];
          if (envelope.revision > current.revision) {
            newEvents = (await fetchEvents(current.gameId, current.token, current.revision)).events;
          }
          // Drop a stale tick whose revision is older than what we already hold (overlapping
          // out-of-order polls); >= still lets an unchanged-revision seatInfo update through
          // (e.g. the opponent claiming a seat does not advance the game revision).
          setGame((prev) =>
            prev && prev.token === current.token && envelope.revision >= prev.revision
              ? {
                  ...prev,
                  revision: envelope.revision,
                  view: envelope.view,
                  seatInfo: envelope.seatInfo
                }
              : prev
          );
          if (newEvents.length > 0) {
            setEvents((previous) => [...newEvents.reverse(), ...previous].slice(0, 8));
          }
        })
        .catch(() => {
          // transient poll failure: ignore and let the next tick retry
        });
    }, 3000);
    return () => window.clearInterval(interval);
  }, [game, busy]);

  const selectedArea = useMemo(
    () => game?.view.areas.find((area) => area.id === selectedAreaId) ?? null,
    [game?.view.areas, selectedAreaId]
  );

  const selectedMapArea = useMemo(
    () => (game && selectedAreaId ? (getMap(game.view.mapId).areas[selectedAreaId] ?? null) : null),
    [game, selectedAreaId]
  );

  // Candidate tiles to glow while a move/strike verb is armed. Nothing glows when idle.
  const legalTargetIds = useMemo(() => {
    if (composer || !armedOrder) {
      return new Set<string>();
    }
    return candidateTiles(armedOrder);
  }, [composer, armedOrder]);
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

  // Staged units per area for the active move/placement, drawn as on-map badges.
  const stagedCounts = useMemo(() => stagedCountsFor(composer), [composer]);

  // Offer only the largest open space per placement type (e.g. Reinforce 6 over 5) to keep
  // the order panel uncluttered; the smaller one reappears once the larger is occupied.
  const placements = useMemo(
    () => largestPlacementPerType(game?.view.legal.placements ?? []),
    [game?.view.legal.placements]
  );

  const availability = useMemo(
    () =>
      game
        ? verbAvailability(game.view.legal)
        : {
            advance: false,
            sail: false,
            bombard: false,
            shell: false,
            reinforce: false,
            embark: false,
            plan: false,
            pass: false
          },
    [game]
  );

  // Cards in hand that can be played with a deploying commander right now.
  const cardPlays = useMemo(() => game?.view.legal.cardPlays ?? [], [game?.view.legal.cardPlays]);
  const playableCards = useMemo(() => new Set(cardPlays.map((p) => p.card)), [cardPlays]);

  async function handleCreate(name: string, side: SeatId) {
    setBusy(true);
    setError(null);
    try {
      const created = await createGame({ name, side });
      rememberSeatTokens(created.gameId, created.seats);
      const myToken = created.seats.find((s) => s.seat === created.seat)!.token;
      loadedKeyRef.current = `${created.gameId}#${myToken}`;
      setGame({
        gameId: created.gameId,
        token: myToken,
        heldSeats: created.seats,
        revision: created.revision,
        view: created.view,
        seatInfo: created.seatInfo
      });
      setSelectedAreaId(null);
      setComposer(null);
      setArmedOrder(null);
      setEvents([]);
      navigateTo(gameUrl(created.gameId, myToken));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleClaim(name: string) {
    if (!game) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const envelope = await claimSeat(game.gameId, game.token, name);
      setGame({
        ...game,
        revision: envelope.revision,
        view: envelope.view,
        seatInfo: envelope.seatInfo
      });
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
    const token = game.heldSeats.find((held) => held.seat === seat)?.token;
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const envelope = await fetchGameView(game.gameId, token);
      setGame({
        ...game,
        token,
        revision: envelope.revision,
        view: envelope.view,
        seatInfo: envelope.seatInfo
      });
      setSelectedAreaId(null);
      setComposer(null);
      setArmedOrder(null);
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
    setArmedOrder(null);
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
    setArmedOrder(null);
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
    setArmedOrder(null);
  }

  function startPlan(plan: LegalPlan) {
    setComposer({ kind: "plan", spaceId: plan.spaceId, initiative: plan.initiative });
  }

  // Arm a move/strike verb from the palette: glow its candidate tiles, await a tile click.
  function armVerb(verb: "advance" | "sail" | "bombard" | "shell") {
    if (!game) {
      return;
    }
    const armed =
      verb === "advance" || verb === "sail"
        ? armMove(game.view.legal, verb)
        : armStrike(game.view.legal, verb);
    if (armed) {
      setComposer(null);
      setArmedOrder(armed);
    }
  }

  // Open the composer for the order the clicked candidate tile resolves to.
  function resolveArmed(areaId: string) {
    if (!armedOrder) {
      return;
    }
    const resolved = resolveArmedTile(armedOrder, areaId);
    if (!resolved) {
      return;
    }
    if (resolved.kind === "move" && armedOrder.kind === "move") {
      startOrder(resolved.move, armedOrder.card, armedOrder.bonusMax);
    } else if (resolved.kind === "strike") {
      startStrike(resolved.strike, armedOrder.card);
    }
  }

  // Begin playing a card. Placement cards (mobilise/commandeer) open their composer at once; a
  // single-target bombard card opens its strike composer directly; other move/strike cards arm
  // targeting mode (glow the card's options, await a tile click) carrying the card context.
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
    if (play.moves && play.moves.length > 0) {
      setArmedOrder({
        kind: "move",
        type: play.action === "sail" ? "sail" : "advance",
        moves: play.moves,
        card: play.card,
        bonusMax: play.bonusMax
      });
    } else if (play.strikes && play.strikes.length > 0) {
      setArmedOrder({ kind: "strike", type: "bombard", strikes: play.strikes, card: play.card });
    }
  }

  // Cancel any in-progress order or targeting, returning to the palette.
  function cancelOrder() {
    setComposer(null);
    setArmedOrder(null);
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

  // Tile selection. Inspection always updates AreaDetails. While composing a move, keep the gold
  // highlight pinned to the target rather than letting it follow source clicks. While a verb is
  // armed, a click on a candidate tile also resolves the order and opens its composer.
  function handleSelectArea(areaId: string) {
    if (composer?.kind !== "move") {
      setSelectedAreaId(areaId);
    }
    if (armedOrder) {
      resolveArmed(areaId);
    }
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
    const token = game.token;
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
      setArmedOrder(null);
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
    const token = game.token;

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
    const token = game.token;
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
    const token = game.token;
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

  if (route.kind === "create") {
    return <CreateGameScreen busy={busy} error={error} onCreate={handleCreate} />;
  }

  if (!game) {
    return (
      <main className="app-shell app-empty">
        <section className="start-panel" aria-label="Loading game">
          {busy ? (
            <p className="muted">Loading game…</p>
          ) : error ? (
            <p className="error-text">{error}</p>
          ) : (
            <p className="muted">Game not found.</p>
          )}
          <button type="button" className="secondary-action" onClick={() => navigateTo("/")}>
            New game
          </button>
        </section>
      </main>
    );
  }

  const viewerSeatInfo = game.seatInfo.find((s) => s.seat === game.view.viewerSeat);
  // Only the *invited* opponent (the one who opened the open seat's link) claims it. A creator
  // "viewing as" the still-open second seat changes game.token, not route.token, so they play it.
  if (route.kind === "game" && route.token === game.token && viewerSeatInfo?.status === "open") {
    return (
      <ClaimSeatPrompt
        seatInfo={game.seatInfo}
        viewerSeat={game.view.viewerSeat}
        busy={busy}
        error={error}
        onClaim={handleClaim}
      />
    );
  }

  const isViewerActive = game.view.activeSeat === game.view.viewerSeat;

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

  const armedLabel = armedOrder
    ? armedOrder.card
      ? cardLabel(armedOrder.card)
      : VERB[armedOrder.type]
    : null;

  const openSeat = game.seatInfo.find((s) => s.status === "open");
  const openSeatToken = openSeat
    ? game.heldSeats.find((held) => held.seat === openSeat.seat)?.token
    : undefined;
  const inviteLink = openSeatToken
    ? inviteUrl(window.location.origin, game.gameId, openSeatToken)
    : null;

  return (
    <main className="app-shell" data-active-seat={game.view.activeSeat}>
      <header className="top-bar">
        <div className="title-block">
          {/* The live instruction, promoted to the primary "general's order" line. The game
              title lives in the browser tab + start screen, kept out of the bar to save height. */}
          <p className="command-prompt">{game.view.prompt}</p>
        </div>
        <div className="scoreboard" aria-label="Game status">
          <span className={`score score-red${game.view.activeSeat === "red" ? " is-active" : ""}`}>
            <span className="score-side">Red</span>
            <span className="score-marker" aria-hidden="true" />
            <span className="score-vp">{game.view.victoryPoints.red}</span>
          </span>
          <span className="score-dash" aria-hidden="true">
            —
          </span>
          <span
            className={`score score-black${game.view.activeSeat === "black" ? " is-active" : ""}`}
          >
            <span className="score-vp">{game.view.victoryPoints.black}</span>
            <span className="score-marker" aria-hidden="true" />
            <span className="score-side">Black</span>
          </span>
          <span className="round-meta">
            <span className="round-no">Round {game.view.round}</span>
            <span className="phase-name">{phaseLabel(game.view.phase)}</span>
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
              renderLabel={(choice) => {
                const kind = game.view.pendingDecision?.kind;
                if (choice.id === "decline") {
                  return choice.label;
                }
                const area = getMap(game.view.mapId).areas[choice.id];
                if (!area) {
                  return choice.label;
                }
                // selectCombat lists battle areas by name; shipStrike lists candidate seas to shell.
                return kind === "shipStrike" ? `Shell ${describeArea(area)}` : describeArea(area);
              }}
            />
          ) : (
            <ActionBar
              composer={composer}
              isViewerActive={isViewerActive}
              busy={busy}
              selectedAreaId={stepperAreaId}
              availability={availability}
              armedLabel={armedLabel}
              placements={placements}
              plans={game.view.legal.plans}
              onArmVerb={armVerb}
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
          <PlayersPanel
            seatInfo={game.seatInfo}
            heldSeats={game.heldSeats.map((held) => held.seat)}
            viewerSeat={game.view.viewerSeat}
            activeSeat={game.view.activeSeat}
            inviteLink={inviteLink}
            busy={busy}
            onSwitchSeat={handleSwitchSeat}
          />

          <section className="panel-section panel-hand">
            <Hand
              hand={game.view.hand}
              opponentHandCount={game.view.opponentHandCount}
              canReroll={game.view.legal.canRerollCombat}
              playableCards={playableCards}
              onPreview={setPreviewCard}
            />
          </section>

          <section className="panel-section">
            <h2>{selectedMapArea ? describeArea(selectedMapArea) : "Select an area"}</h2>
            {selectedArea && selectedMapArea ? (
              <AreaDetails area={selectedArea} mapArea={selectedMapArea} view={game.view} />
            ) : (
              <p className="muted">Tap an area on the map to see its details.</p>
            )}
          </section>

          <section className="panel-section panel-log">
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
              forgetGame(game.gameId);
              navigateTo("/");
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

/** Title-case a phase id ("deploy" → "Deploy") for the scoreboard's secondary line. */
function phaseLabel(phase: string): string {
  return phase.length === 0 ? phase : phase[0]!.toUpperCase() + phase.slice(1);
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

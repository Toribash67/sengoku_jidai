import type { LegalMove, LegalPlacement, LegalPlan, LegalStrike } from "@sengoku-jidai/engine";
import { UNIT_NOUN, VERB, sumCounts, type ComposerState } from "./composer.js";

interface ActionBarProps {
  composer: ComposerState | null;
  isViewerActive: boolean;
  busy: boolean;
  /** The gold-outlined area; in a move/placement it is the one the stepper adjusts. */
  selectedAreaId: string | null;

  // Idle-mode inputs (contextual to the selected tile + always-available support actions).
  contextualMove: LegalMove | null;
  contextualStrike: LegalStrike | null;
  placements: LegalPlacement[];
  plans: LegalPlan[];
  canPass: boolean;
  onStartOrder: (move: LegalMove) => void;
  onStartStrike: (strike: LegalStrike) => void;
  onStartPlacement: (placement: LegalPlacement) => void;
  onStartPlan: (plan: LegalPlan) => void;
  onPass: () => void;

  // Compose-mode inputs.
  onAdjust: (areaId: string, delta: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A `[−] N [+]` stepper for the currently selected area's staged count. */
function Stepper({
  count,
  canDecrement,
  canIncrement,
  onAdjust
}: {
  count: number;
  canDecrement: boolean;
  canIncrement: boolean;
  onAdjust: (delta: number) => void;
}) {
  return (
    <span className="action-bar-stepper">
      <span className="stepper-label">Selected area</span>
      <span className="stepper">
        <button type="button" onClick={() => onAdjust(-1)} disabled={!canDecrement} aria-label="Fewer">
          &minus;
        </button>
        <span className="stepper-count">{count}</span>
        <button type="button" onClick={() => onAdjust(1)} disabled={!canIncrement} aria-label="More">
          +
        </button>
      </span>
    </span>
  );
}

function ComposerActions({
  busy,
  confirmLabel,
  confirmDisabled,
  onConfirm,
  onCancel
}: {
  busy: boolean;
  confirmLabel: string;
  confirmDisabled: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <span className="action-bar-buttons">
      <button type="button" onClick={onConfirm} disabled={confirmDisabled}>
        {confirmLabel}
      </button>
      <button type="button" className="secondary-action" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
    </span>
  );
}

function MoveBar({
  composer,
  selectedAreaId,
  busy,
  onAdjust,
  onConfirm,
  onCancel
}: {
  composer: Extract<ComposerState, { kind: "move" }>;
} & Pick<ActionBarProps, "selectedAreaId" | "busy" | "onAdjust" | "onConfirm" | "onCancel">) {
  const noun = UNIT_NOUN[composer.type === "advance" ? "troop" : "ship"];
  const total = sumCounts(composer.counts);
  const source = composer.sources.find((s) => s.areaId === selectedAreaId) ?? null;
  const count = source ? (composer.counts[source.areaId] ?? 0) : 0;
  return (
    <>
      <span className="action-bar-info">
        <strong>{VERB[composer.type]}</strong>
        <span className="action-bar-total">
          Moving {total} {noun}
        </span>
      </span>
      {source ? (
        <Stepper
          count={count}
          canDecrement={!busy && count > 0}
          canIncrement={!busy && count < source.max}
          onAdjust={(delta) => onAdjust(source.areaId, delta)}
        />
      ) : (
        <span className="action-bar-hint">Tap a glowing area to add {noun} (each keeps one).</span>
      )}
      <ComposerActions
        busy={busy}
        confirmLabel={`Confirm ${VERB[composer.type]}`}
        confirmDisabled={busy || total < 1}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </>
  );
}

function PlacementBar({
  composer,
  selectedAreaId,
  busy,
  onAdjust,
  onConfirm,
  onCancel
}: {
  composer: Extract<ComposerState, { kind: "placement" }>;
} & Pick<ActionBarProps, "selectedAreaId" | "busy" | "onAdjust" | "onConfirm" | "onCancel">) {
  const noun = UNIT_NOUN[composer.unit];
  const cap = Math.min(composer.pool, composer.reserve);
  const total = sumCounts(composer.counts);
  const isTarget = selectedAreaId !== null && composer.targets.includes(selectedAreaId);
  const count = isTarget ? (composer.counts[selectedAreaId] ?? 0) : 0;
  return (
    <>
      <span className="action-bar-info">
        <strong>{VERB[composer.type]}</strong>
        <span className="action-bar-total">
          Placing {total} / {cap} {noun}
        </span>
      </span>
      {isTarget && selectedAreaId ? (
        <Stepper
          count={count}
          canDecrement={!busy && count > 0}
          canIncrement={!busy && total < cap}
          onAdjust={(delta) => onAdjust(selectedAreaId, delta)}
        />
      ) : (
        <span className="action-bar-hint">Tap a glowing area to place {noun}.</span>
      )}
      <ComposerActions
        busy={busy}
        confirmLabel={`Confirm ${VERB[composer.type]}`}
        confirmDisabled={busy || total < 1}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </>
  );
}

function StrikeBar({
  composer,
  busy,
  onConfirm,
  onCancel
}: {
  composer: Extract<ComposerState, { kind: "strike" }>;
} & Pick<ActionBarProps, "busy" | "onConfirm" | "onCancel">) {
  const hasTarget = composer.targetAreaId !== null;
  return (
    <>
      <span className="action-bar-info">
        <strong>{VERB[composer.type]}</strong>
        <span className="action-bar-hint">
          Rolls {composer.dice} {composer.dice === 1 ? "die" : "dice"}. Tap a glowing enemy area
          to target it.
        </span>
        <span className="action-bar-total">{hasTarget ? "Target selected" : "No target yet"}</span>
      </span>
      <ComposerActions
        busy={busy}
        confirmLabel={`Confirm ${VERB[composer.type]}`}
        confirmDisabled={busy || !hasTarget}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </>
  );
}

function PlanBar({
  composer,
  busy,
  onConfirm,
  onCancel
}: {
  composer: Extract<ComposerState, { kind: "plan" }>;
} & Pick<ActionBarProps, "busy" | "onConfirm" | "onCancel">) {
  return (
    <>
      <span className="action-bar-info">
        <strong>Plan</strong>
        <span className="action-bar-hint">
          {composer.initiative ? "Draw a card and seize next round's initiative." : "Draw a card."}
        </span>
      </span>
      <ComposerActions
        busy={busy}
        confirmLabel="Confirm Plan"
        confirmDisabled={busy}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </>
  );
}

function IdleBar(props: ActionBarProps) {
  const {
    isViewerActive,
    busy,
    contextualMove,
    contextualStrike,
    placements,
    plans,
    canPass,
    onStartOrder,
    onStartStrike,
    onStartPlacement,
    onStartPlan,
    onPass
  } = props;

  if (!isViewerActive) {
    return <span className="action-bar-hint">Waiting for the other player…</span>;
  }

  const hasContextual = contextualMove !== null || contextualStrike !== null;
  return (
    <>
      <span className="action-bar-group">
        {contextualMove ? (
          <button type="button" onClick={() => onStartOrder(contextualMove)} disabled={busy}>
            {VERB[contextualMove.type]} here
          </button>
        ) : null}
        {contextualStrike ? (
          <button type="button" onClick={() => onStartStrike(contextualStrike)} disabled={busy}>
            {VERB[contextualStrike.type]} from here
          </button>
        ) : null}
        {!hasContextual ? (
          <span className="action-bar-hint">Select an area to see its orders.</span>
        ) : null}
      </span>
      <span className="action-bar-group action-bar-support">
        {placements.map((placement) => (
          <button
            key={placement.spaceId}
            type="button"
            onClick={() => onStartPlacement(placement)}
            disabled={busy}
          >
            {VERB[placement.type]}{" "}
            <span className="action-meta">up to {Math.min(placement.pool, placement.reserve)}</span>
          </button>
        ))}
        {plans.map((plan) => (
          <button key={plan.spaceId} type="button" onClick={() => onStartPlan(plan)} disabled={busy}>
            Plan {plan.initiative ? <span className="action-meta">★</span> : null}
          </button>
        ))}
        <button type="button" onClick={onPass} disabled={busy || !canPass}>
          Pass
        </button>
      </span>
    </>
  );
}

/** The bottom command bar: contextual + support actions when idle, or the active order's
 *  compose controls. All tile reference is via the map (glow + selection), never an id. */
export function ActionBar(props: ActionBarProps) {
  const { composer, selectedAreaId, busy, onAdjust, onConfirm, onCancel } = props;

  if (!composer) {
    return (
      <div className="action-bar" aria-label="Orders">
        <IdleBar {...props} />
      </div>
    );
  }

  return (
    <div className="action-bar action-bar-compose" aria-label="Compose order">
      {composer.kind === "move" ? (
        <MoveBar
          composer={composer}
          selectedAreaId={selectedAreaId}
          busy={busy}
          onAdjust={onAdjust}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      ) : null}
      {composer.kind === "placement" ? (
        <PlacementBar
          composer={composer}
          selectedAreaId={selectedAreaId}
          busy={busy}
          onAdjust={onAdjust}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      ) : null}
      {composer.kind === "strike" ? (
        <StrikeBar composer={composer} busy={busy} onConfirm={onConfirm} onCancel={onCancel} />
      ) : null}
      {composer.kind === "plan" ? (
        <PlanBar composer={composer} busy={busy} onConfirm={onConfirm} onCancel={onCancel} />
      ) : null}
    </div>
  );
}

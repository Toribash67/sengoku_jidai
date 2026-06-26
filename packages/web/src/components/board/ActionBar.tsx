import type { LegalPlacement, LegalPlan } from "@sengoku-jidai/engine";
import { cardLabel } from "./cardImages.js";
import { UNIT_NOUN, VERB, sumCounts, type ComposerState } from "./composer.js";
import type { VerbAvailability } from "./orders.js";

interface ActionBarProps {
  composer: ComposerState | null;
  isViewerActive: boolean;
  busy: boolean;
  /** The gold-outlined area; in a move/placement it is the one the stepper adjusts. */
  selectedAreaId: string | null;
  // Idle-mode inputs: the fixed verb palette + the active targeting banner.
  /** Which palette verbs are usable this turn (others render greyed). */
  availability: VerbAvailability;
  /** Banner shown while a move/strike verb is armed: its label + glow hint. Null when idle. */
  armedLabel: string | null;
  placements: LegalPlacement[];
  plans: LegalPlan[];
  onArmVerb: (verb: "advance" | "sail" | "bombard" | "shell") => void;
  onStartPlacement: (placement: LegalPlacement) => void;
  onStartPlan: (plan: LegalPlan) => void;
  onPass: () => void;

  // Compose-mode inputs.
  onAdjust: (areaId: string, delta: number) => void;
  /** Adjust the assault-card bonus (ground/river_assault) on a move composer. */
  onAdjustBonus: (delta: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A `[−] N [+]` stepper for the currently selected area's staged count. */
function Stepper({
  label,
  count,
  canDecrement,
  canIncrement,
  onAdjust
}: {
  label: string;
  count: number;
  canDecrement: boolean;
  canIncrement: boolean;
  onAdjust: (delta: number) => void;
}) {
  return (
    <span className="action-bar-stepper">
      <span className="stepper-label">{label}</span>
      <span className="stepper">
        <button
          type="button"
          onClick={() => onAdjust(-1)}
          disabled={!canDecrement}
          aria-label="Fewer"
        >
          &minus;
        </button>
        <span className="stepper-count">{count}</span>
        <button
          type="button"
          onClick={() => onAdjust(1)}
          disabled={!canIncrement}
          aria-label="More"
        >
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
  onAdjustBonus,
  onConfirm,
  onCancel
}: {
  composer: Extract<ComposerState, { kind: "move" }>;
} & Pick<
  ActionBarProps,
  "selectedAreaId" | "busy" | "onAdjust" | "onAdjustBonus" | "onConfirm" | "onCancel"
>) {
  const noun = UNIT_NOUN[composer.type === "advance" ? "troop" : "ship"];
  const total = sumCounts(composer.counts);
  const source = composer.sources.find((s) => s.areaId === selectedAreaId) ?? null;
  const count = source ? (composer.counts[source.areaId] ?? 0) : 0;
  const bonus = composer.bonus ?? 0;
  return (
    <>
      <span className="action-bar-info">
        <strong>{VERB[composer.type]}</strong>
        {composer.card ? <span className="action-bar-card">{cardLabel(composer.card)}</span> : null}
        <span className="action-bar-total">
          Moving {total + bonus} {noun}
        </span>
      </span>
      {source ? (
        <Stepper
          label="Selected source"
          count={count}
          canDecrement={!busy && count > 0}
          canIncrement={!busy && count < source.max}
          onAdjust={(delta) => onAdjust(source.areaId, delta)}
        />
      ) : (
        <span className="action-bar-hint">Tap a glowing area to add {noun} (each keeps one).</span>
      )}
      {composer.bonusMax !== undefined ? (
        <Stepper
          label="From reserve"
          count={bonus}
          canDecrement={!busy && bonus > 0}
          canIncrement={!busy && bonus < composer.bonusMax}
          onAdjust={onAdjustBonus}
        />
      ) : null}
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
        {composer.card ? <span className="action-bar-card">{cardLabel(composer.card)}</span> : null}
        <span className="action-bar-total">
          Placing {total} / {cap} {noun}
        </span>
      </span>
      {isTarget && selectedAreaId ? (
        <Stepper
          label="Selected area"
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
        {composer.card ? <span className="action-bar-card">{cardLabel(composer.card)}</span> : null}
        <span className="action-bar-hint">
          Rolls {composer.dice} {composer.dice === 1 ? "die" : "dice"}. Tap a glowing enemy area to
          target it.
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

/** A move/strike verb in the palette. Placement/Plan/Pass have their own handlers below. */
const MOVE_STRIKE_VERBS: { verb: "advance" | "sail" | "bombard" | "shell" }[] = [
  { verb: "advance" },
  { verb: "sail" },
  { verb: "bombard" },
  { verb: "shell" }
];

function IdleBar(props: ActionBarProps) {
  const {
    isViewerActive,
    busy,
    availability,
    armedLabel,
    placements,
    plans,
    onArmVerb,
    onStartPlacement,
    onStartPlan,
    onPass,
    onCancel
  } = props;

  if (!isViewerActive) {
    return <span className="action-bar-hint">Waiting for the other player…</span>;
  }

  // Targeting mode: a move/strike verb is armed and its candidate tiles glow on the map.
  if (armedLabel) {
    return (
      <>
        <span className="action-bar-info">
          <strong>{armedLabel}</strong>
          <span className="action-bar-hint">Tap a glowing area to choose its target.</span>
        </span>
        <span className="action-bar-buttons">
          <button type="button" className="secondary-action" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </span>
      </>
    );
  }

  // The fixed verb palette. Layout is stable; unusable verbs render disabled.
  return (
    <>
      <span className="action-bar-group order-palette">
        {MOVE_STRIKE_VERBS.map(({ verb }) => (
          <button
            key={verb}
            type="button"
            data-order-verb={verb}
            onClick={() => onArmVerb(verb)}
            disabled={busy || !availability[verb]}
          >
            {VERB[verb]}
          </button>
        ))}
        {placements.map((placement) => (
          <button
            key={placement.spaceId}
            type="button"
            data-order-verb={placement.type}
            onClick={() => onStartPlacement(placement)}
            disabled={busy}
          >
            {VERB[placement.type]}{" "}
            <span className="action-meta">up to {Math.min(placement.pool, placement.reserve)}</span>
          </button>
        ))}
        {plans.map((plan) => (
          <button
            key={plan.spaceId}
            type="button"
            data-order-verb="plan"
            onClick={() => onStartPlan(plan)}
            disabled={busy}
          >
            Plan {plan.initiative ? <span className="action-meta">★</span> : null}
          </button>
        ))}
        <button
          type="button"
          data-order-verb="pass"
          onClick={onPass}
          disabled={busy || !availability.pass}
        >
          Pass
        </button>
      </span>
    </>
  );
}

/** The bottom command bar: contextual + support actions when idle, or the active order's
 *  compose controls. All tile reference is via the map (glow + selection), never an id. */
export function ActionBar(props: ActionBarProps) {
  const { composer, selectedAreaId, busy, onAdjust, onAdjustBonus, onConfirm, onCancel } = props;

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
          onAdjustBonus={onAdjustBonus}
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

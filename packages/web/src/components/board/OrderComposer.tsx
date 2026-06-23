/** The in-progress order being composed in the side panel. One variant per action shape:
 *  movement (advance/sail) and placement (reinforce/embark) stage per-area counts; a strike
 *  (bombard/shell) picks a single enemy target; plan just deploys. */
export type ComposerState =
  | {
      kind: "move";
      spaceId: string;
      type: "advance" | "sail";
      targetAreaId: string;
      sources: { areaId: string; max: number }[];
      counts: Record<string, number>;
    }
  | {
      kind: "strike";
      spaceId: string;
      type: "bombard" | "shell";
      linkedAreaId: string;
      targets: string[];
      dice: number;
      targetAreaId: string | null;
    }
  | {
      kind: "placement";
      spaceId: string;
      type: "reinforce" | "embark";
      unit: "troop" | "ship";
      targets: string[];
      pool: number;
      reserve: number;
      counts: Record<string, number>;
    }
  | { kind: "plan"; spaceId: string; initiative: boolean };

interface OrderComposerProps {
  composer: ComposerState;
  busy: boolean;
  onAdjust: (areaId: string, delta: number) => void;
  onSelectTarget: (areaId: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

type ActionVerb = "advance" | "sail" | "bombard" | "shell" | "reinforce" | "embark";
const VERB: Record<ActionVerb, string> = {
  advance: "Advance",
  sail: "Sail",
  bombard: "Bombard",
  shell: "Shell",
  reinforce: "Reinforce",
  embark: "Embark"
};
const UNIT_NOUN: Record<"troop" | "ship", string> = { troop: "troops", ship: "ships" };

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

/** A +/- stepper row for one area's staged count. */
function StepperRow({
  areaId,
  count,
  canDecrement,
  canIncrement,
  onAdjust
}: {
  areaId: string;
  count: number;
  canDecrement: boolean;
  canIncrement: boolean;
  onAdjust: (areaId: string, delta: number) => void;
}) {
  return (
    <li data-source-row={areaId}>
      <span className="source-name">{areaId}</span>
      <span className="stepper">
        <button
          type="button"
          onClick={() => onAdjust(areaId, -1)}
          disabled={!canDecrement}
          aria-label={`Fewer at ${areaId}`}
        >
          &minus;
        </button>
        <span className="stepper-count">{count}</span>
        <button
          type="button"
          onClick={() => onAdjust(areaId, 1)}
          disabled={!canIncrement}
          aria-label={`More at ${areaId}`}
        >
          +
        </button>
      </span>
    </li>
  );
}

function MoveComposer({
  composer,
  busy,
  onAdjust,
  onConfirm,
  onCancel
}: {
  composer: Extract<ComposerState, { kind: "move" }>;
} & Pick<OrderComposerProps, "busy" | "onAdjust" | "onConfirm" | "onCancel">) {
  const unit = composer.type === "advance" ? "troop" : "ship";
  const total = sumCounts(composer.counts);
  return (
    <div className="order-composer">
      <h2>
        {VERB[composer.type]} into {composer.targetAreaId}
      </h2>
      <p className="muted">Choose how many {UNIT_NOUN[unit]} to move (each source keeps one).</p>
      <ul className="source-list">
        {composer.sources.map((source) => {
          const count = composer.counts[source.areaId] ?? 0;
          return (
            <StepperRow
              key={source.areaId}
              areaId={source.areaId}
              count={count}
              canDecrement={!busy && count > 0}
              canIncrement={!busy && count < source.max}
              onAdjust={onAdjust}
            />
          );
        })}
      </ul>
      <p className="composer-total">
        Moving {total} {UNIT_NOUN[unit]}
      </p>
      <ComposerActions
        busy={busy}
        confirmLabel={`Confirm ${VERB[composer.type]}`}
        confirmDisabled={busy || total < 1}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </div>
  );
}

function PlacementComposer({
  composer,
  busy,
  onAdjust,
  onConfirm,
  onCancel
}: {
  composer: Extract<ComposerState, { kind: "placement" }>;
} & Pick<OrderComposerProps, "busy" | "onAdjust" | "onConfirm" | "onCancel">) {
  const cap = Math.min(composer.pool, composer.reserve);
  const total = sumCounts(composer.counts);
  const noun = UNIT_NOUN[composer.unit];
  return (
    <div className="order-composer">
      <h2>{VERB[composer.type]}</h2>
      <p className="muted">
        Place up to {cap} {noun} ({composer.reserve} in reserve, limit {composer.pool}).
      </p>
      <ul className="source-list">
        {composer.targets.map((areaId) => {
          const count = composer.counts[areaId] ?? 0;
          return (
            <StepperRow
              key={areaId}
              areaId={areaId}
              count={count}
              canDecrement={!busy && count > 0}
              canIncrement={!busy && total < cap}
              onAdjust={onAdjust}
            />
          );
        })}
      </ul>
      <p className="composer-total">
        Placing {total} / {cap} {noun}
      </p>
      <ComposerActions
        busy={busy}
        confirmLabel={`Confirm ${VERB[composer.type]}`}
        confirmDisabled={busy || total < 1}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </div>
  );
}

function StrikeComposer({
  composer,
  busy,
  onSelectTarget,
  onConfirm,
  onCancel
}: {
  composer: Extract<ComposerState, { kind: "strike" }>;
} & Pick<OrderComposerProps, "busy" | "onSelectTarget" | "onConfirm" | "onCancel">) {
  return (
    <div className="order-composer">
      <h2>
        {VERB[composer.type]} from {composer.linkedAreaId}
      </h2>
      <p className="muted">
        Rolls {composer.dice} {composer.dice === 1 ? "die" : "dice"}. Choose a target.
      </p>
      <ul className="target-list">
        {composer.targets.map((areaId) => (
          <li key={areaId}>
            <button
              type="button"
              className={
                areaId === composer.targetAreaId ? "target-option is-selected" : "target-option"
              }
              onClick={() => onSelectTarget(areaId)}
              disabled={busy}
              aria-pressed={areaId === composer.targetAreaId}
            >
              {areaId}
            </button>
          </li>
        ))}
      </ul>
      <ComposerActions
        busy={busy}
        confirmLabel={`Confirm ${VERB[composer.type]}`}
        confirmDisabled={busy || composer.targetAreaId === null}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </div>
  );
}

function PlanComposer({
  composer,
  busy,
  onConfirm,
  onCancel
}: {
  composer: Extract<ComposerState, { kind: "plan" }>;
} & Pick<OrderComposerProps, "busy" | "onConfirm" | "onCancel">) {
  return (
    <div className="order-composer">
      <h2>Plan</h2>
      <p className="muted">
        {composer.initiative ? "Draw a card and seize next round's initiative." : "Draw a card."}
      </p>
      <ComposerActions
        busy={busy}
        confirmLabel="Confirm Plan"
        confirmDisabled={busy}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </div>
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
    <div className="composer-actions">
      <button type="button" onClick={onConfirm} disabled={confirmDisabled}>
        {confirmLabel}
      </button>
      <button type="button" className="secondary-action" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
    </div>
  );
}

export function OrderComposer({
  composer,
  busy,
  onAdjust,
  onSelectTarget,
  onConfirm,
  onCancel
}: OrderComposerProps) {
  switch (composer.kind) {
    case "move":
      return (
        <MoveComposer
          composer={composer}
          busy={busy}
          onAdjust={onAdjust}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );
    case "placement":
      return (
        <PlacementComposer
          composer={composer}
          busy={busy}
          onAdjust={onAdjust}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );
    case "strike":
      return (
        <StrikeComposer
          composer={composer}
          busy={busy}
          onSelectTarget={onSelectTarget}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );
    case "plan":
      return (
        <PlanComposer composer={composer} busy={busy} onConfirm={onConfirm} onCancel={onCancel} />
      );
  }
}

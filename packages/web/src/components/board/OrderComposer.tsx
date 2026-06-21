export interface ComposerState {
  spaceId: string;
  type: "advance" | "sail";
  targetAreaId: string;
  sources: { areaId: string; max: number }[];
  counts: Record<string, number>;
}

interface OrderComposerProps {
  composer: ComposerState;
  busy: boolean;
  onAdjust: (areaId: string, delta: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const VERB: Record<ComposerState["type"], string> = { advance: "Advance", sail: "Sail" };
const UNIT: Record<ComposerState["type"], string> = { advance: "troops", sail: "ships" };

export function OrderComposer({
  composer,
  busy,
  onAdjust,
  onConfirm,
  onCancel
}: OrderComposerProps) {
  const total = composer.sources.reduce(
    (sum, source) => sum + (composer.counts[source.areaId] ?? 0),
    0
  );

  return (
    <div className="order-composer">
      <h2>
        {VERB[composer.type]} into {composer.targetAreaId}
      </h2>
      <p className="muted">
        Choose how many {UNIT[composer.type]} to move (each source keeps one).
      </p>
      <ul className="source-list">
        {composer.sources.map((source) => {
          const count = composer.counts[source.areaId] ?? 0;
          return (
            <li key={source.areaId} data-source-row={source.areaId}>
              <span className="source-name">{source.areaId}</span>
              <span className="stepper">
                <button
                  type="button"
                  onClick={() => onAdjust(source.areaId, -1)}
                  disabled={busy || count <= 0}
                  aria-label={`Fewer from ${source.areaId}`}
                >
                  &minus;
                </button>
                <span className="stepper-count">{count}</span>
                <button
                  type="button"
                  onClick={() => onAdjust(source.areaId, 1)}
                  disabled={busy || count >= source.max}
                  aria-label={`More from ${source.areaId}`}
                >
                  +
                </button>
              </span>
              <span className="source-max">/ {source.max}</span>
            </li>
          );
        })}
      </ul>
      <p className="composer-total">
        Moving {total} {UNIT[composer.type]}
      </p>
      <div className="composer-actions">
        <button type="button" onClick={onConfirm} disabled={busy || total < 1}>
          Confirm {VERB[composer.type]}
        </button>
        <button type="button" className="secondary-action" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

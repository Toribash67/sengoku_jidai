import { useEffect, useRef, useState } from "react";
import type { PendingCombat } from "@sengoku-jidai/engine/client";
import { diceKey, randomFaces, shouldTumble } from "./diceReveal.js";

interface CombatPanelProps {
  pendingCombat: PendingCombat;
  /** Human label for the contested area (never a raw tile id). */
  areaLabel: string;
  /** True when the viewer may roll (dice not yet thrown). */
  canRoll: boolean;
  /** True when the dice are shown and the viewer may continue (apply casualties). */
  canResolve: boolean;
  /** True when the viewer holds a card they could discard to reroll. */
  canReroll: boolean;
  /** True when the viewer may play Ambush (+2 dice) before this defence roll. */
  canAmbush: boolean;
  /** True when the viewer defends this siege and may play Take Cover (ignore 2 damage). */
  canTakeCover: boolean;
  busy: boolean;
  onRoll: () => void;
  onRollAmbush: () => void;
  onResolve: () => void;
  onTakeCover: () => void;
}

/** Headline + sub-text describing a pending combat, with no tile ids. Pure + exported for
 *  testing. */
export function describeCombat(
  pendingCombat: PendingCombat,
  areaLabel: string
): { headline: string; detail: string; diceCount: number } {
  const { kind, attacker, defender, attackers, defenders, dice } = pendingCombat;
  if (kind === "advance" || kind === "sail") {
    return {
      headline: `Battle for ${areaLabel}`,
      detail: `${attacker} sends ${attackers} vs ${defender}'s ${defenders} — ${defender} rolls the defence die`,
      diceCount: 1
    };
  }
  const verb = kind === "bombard" ? "Bombard" : kind === "shell" ? "Shell" : "Siege";
  const cover =
    pendingCombat.phase === "awaiting-cover"
      ? ` — ${defender} may Take Cover to ignore 2 damage`
      : "";
  return {
    headline: `${verb} on ${areaLabel}`,
    detail: `${attacker} rolls ${dice} ${dice === 1 ? "die" : "dice"}${cover}`,
    diceCount: dice ?? 0
  };
}

/** Milliseconds the dice flicker through random faces before settling on the real roll. */
const TUMBLE_MS = 600;
/** Milliseconds between flicker frames during the tumble. */
const FLICKER_MS = 70;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/** Drives the reveal: when a roll we witness arrives, flicker random faces for ~600ms, then
 *  settle on the real values. Returns the faces to show plus whether we're mid-tumble. The
 *  decision to animate lives in the pure `shouldTumble`; this hook only owns the timers. */
function useDiceReveal(
  count: number,
  values?: number[]
): { faces: (number | null)[]; rolling: boolean } {
  const restFaces: (number | null)[] = values ?? Array.from({ length: count }, () => null);
  const [faces, setFaces] = useState<(number | null)[]>(restFaces);
  const [rolling, setRolling] = useState(false);
  const seenRef = useRef(false);
  const prevKeyRef = useRef<string | null>(null);
  const nextKey = diceKey(values);

  useEffect(() => {
    const seenBefore = seenRef.current;
    const prevKey = prevKeyRef.current;
    seenRef.current = true;
    prevKeyRef.current = nextKey;

    if (!shouldTumble({ seenBefore, reducedMotion: prefersReducedMotion(), prevKey, nextKey })) {
      setRolling(false);
      setFaces(values ?? Array.from({ length: count }, () => null));
      return;
    }

    setRolling(true);
    const flicker = setInterval(() => setFaces(randomFaces(count)), FLICKER_MS);
    const settle = setTimeout(() => {
      clearInterval(flicker);
      setRolling(false);
      setFaces(values ?? []);
    }, TUMBLE_MS);
    return () => {
      clearInterval(flicker);
      clearTimeout(settle);
    };
    // Keyed on the roll identity + count; `values` is captured via `nextKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextKey, count]);

  return { faces, rolling };
}

/** A row of dice: the rolled faces once thrown, else placeholders for the count to come.
 *  Fresh rolls tumble in via `useDiceReveal`. */
function DiceRow({ count, values }: { count: number; values?: number[] }) {
  const { faces, rolling } = useDiceReveal(count, values);
  return (
    <span className={`combat-dice${rolling ? " is-rolling" : ""}`} aria-hidden="true">
      {faces.map((face, i) => (
        <span
          key={i}
          className={
            face === null ? "die die-pending" : rolling ? "die die-rolling" : "die die-rolled"
          }
        >
          {face === null ? "?" : face}
        </span>
      ))}
    </span>
  );
}

/** The interactive combat step. Phase `awaiting-roll`: show the matchup and let the
 *  responsible seat roll. Phase `rolled`: show the dice and let them continue (apply
 *  casualties) or reroll with a card. Phase `awaiting-cover` (siege): the dice stay shown and
 *  the defender answers with Take Cover or accepts the damage. */
export function CombatPanel({
  pendingCombat,
  areaLabel,
  canRoll,
  canResolve,
  canReroll,
  canAmbush,
  canTakeCover,
  busy,
  onRoll,
  onRollAmbush,
  onResolve,
  onTakeCover
}: CombatPanelProps) {
  const { headline, detail, diceCount } = describeCombat(pendingCombat, areaLabel);
  const rolled = pendingCombat.phase !== "awaiting-roll";
  const awaitingCover = pendingCombat.phase === "awaiting-cover";
  const responsible = canRoll || canResolve;
  return (
    <div className="combat-panel" aria-label="Combat">
      <div className="combat-info">
        <strong>{headline}</strong>
        <span className="combat-detail">{detail}</span>
      </div>
      <DiceRow count={diceCount} values={rolled ? pendingCombat.rolls : undefined} />
      {rolled ? <span className="combat-total">= {pendingCombat.total}</span> : null}
      <span className="combat-buttons">
        {!responsible ? (
          <span className="action-bar-hint">
            Waiting for {pendingCombat.responsibleSeat} to{" "}
            {awaitingCover ? "answer the siege" : rolled ? "continue" : "roll"}…
          </span>
        ) : awaitingCover ? (
          <>
            {canTakeCover ? (
              <button type="button" onClick={onTakeCover} disabled={busy}>
                Take Cover (ignore 2 damage)
              </button>
            ) : null}
            <button
              type="button"
              className={canTakeCover ? "secondary-action" : undefined}
              onClick={onResolve}
              disabled={busy || !canResolve}
            >
              Accept damage
            </button>
          </>
        ) : rolled ? (
          <>
            <button type="button" onClick={onResolve} disabled={busy || !canResolve}>
              Continue
            </button>
            <span className="action-bar-hint">
              {canReroll
                ? "…or open a card below and discard it to reroll."
                : "No cards to reroll."}
            </span>
          </>
        ) : (
          <>
            <button type="button" onClick={onRoll} disabled={busy || !canRoll}>
              Roll
            </button>
            {canAmbush ? (
              <button type="button" onClick={onRollAmbush} disabled={busy}>
                Roll with Ambush (+2 dice)
              </button>
            ) : null}
          </>
        )}
      </span>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import type { SeatId } from "@sengoku-jidai/engine/client";
import type { GameSeatInfo } from "@sengoku-jidai/shared";

/** Copy text to the clipboard, falling back to a hidden-textarea `execCommand` when the async
 *  Clipboard API is unavailable — it is undefined in insecure (plain-HTTP / LAN-IP) contexts,
 *  which is exactly how this app is often reached. Returns whether the copy succeeded. */
async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path
    }
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

interface PlayersPanelProps {
  seatInfo: GameSeatInfo[];
  heldSeats: SeatId[];
  viewerSeat: SeatId;
  activeSeat: SeatId;
  inviteLink: string | null;
  busy: boolean;
  onSwitchSeat: (seat: SeatId) => void;
}

const sideLabel: Record<SeatId, string> = { red: "Red", black: "Black" };
const seatOrder: SeatId[] = ["red", "black"];

export function PlayersPanel({
  seatInfo,
  heldSeats,
  viewerSeat,
  activeSeat,
  inviteLink,
  busy,
  onSwitchSeat
}: PlayersPanelProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  // Clear any pending "Copied!" reset on unmount so it can't fire after the panel is gone.
  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) {
        window.clearTimeout(copiedTimer.current);
      }
    };
  }, []);
  const ordered = seatOrder
    .map((seat) => seatInfo.find((s) => s.seat === seat))
    .filter((s): s is GameSeatInfo => Boolean(s));

  async function handleCopy() {
    if (!inviteLink) {
      return;
    }
    const ok = await copyToClipboard(inviteLink);
    setCopied(ok);
    if (ok) {
      if (copiedTimer.current !== null) {
        window.clearTimeout(copiedTimer.current);
      }
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="players-panel" aria-label="Players">
      <ul className="player-list">
        {ordered.map((seat) => {
          const held = heldSeats.includes(seat.seat);
          const isViewer = seat.seat === viewerSeat;
          const isActive = seat.seat === activeSeat;
          const label =
            seat.name ?? (seat.status === "open" ? "Waiting to join…" : sideLabel[seat.seat]);
          return (
            <li key={seat.seat} className={`player-row${isActive ? " is-turn" : ""}`}>
              {held ? (
                <button
                  type="button"
                  data-seat={seat.seat}
                  className={`player-pill${isViewer ? " is-active" : ""}`}
                  onClick={() => onSwitchSeat(seat.seat)}
                  disabled={busy || isViewer}
                  aria-pressed={isViewer}
                >
                  <span className="player-side" data-seat={seat.seat}>
                    {sideLabel[seat.seat]}
                  </span>
                  <span className="player-name">{label}</span>
                </button>
              ) : (
                <span className="player-pill is-readonly" data-seat={seat.seat}>
                  <span className="player-side" data-seat={seat.seat}>
                    {sideLabel[seat.seat]}
                  </span>
                  <span className={`player-name${seat.status === "open" ? " is-open" : ""}`}>
                    {label}
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {inviteLink ? (
        <div className="invite-box">
          <p className="invite-hint">Share this link to invite your opponent:</p>
          <div className="invite-row">
            <input type="text" readOnly value={inviteLink} aria-label="Invite link" />
            <button type="button" className="secondary-action" onClick={handleCopy}>
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

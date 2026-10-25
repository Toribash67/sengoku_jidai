import { describe, expect, it } from "vitest";
import { PRESENCE_WINDOW_MS, SpectatorPresence } from "../src/sessions/spectatorPresence.js";

describe("SpectatorPresence", () => {
  it("counts distinct clients and ignores repeats", () => {
    const t = 1000;
    const p = new SpectatorPresence(() => t);
    p.touch("g", "client-a");
    p.touch("g", "client-b");
    expect(p.count("g")).toBe(2);
    p.touch("g", "client-a");
    expect(p.count("g")).toBe(2);
    const q = new SpectatorPresence(() => t);
    q.touch("g", "client-a");
    q.touch("g", "client-a");
    expect(q.count("g")).toBe(1);
  });

  it("expires clients after the window", () => {
    let t = 1000;
    const p = new SpectatorPresence(() => t);
    p.touch("g", "client-a");
    t += PRESENCE_WINDOW_MS + 1;
    expect(p.count("g")).toBe(0);
  });

  it("counts per game", () => {
    const p = new SpectatorPresence(() => 0);
    p.touch("A", "client-a");
    expect(p.count("A")).toBe(1);
    expect(p.count("B")).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@sengoku-jidai/shared";
import { buildLogEntries, mergeChat, type LoggedEvent } from "./gameLog.js";

const msg = (id: number, revision: number): ChatMessage => ({
  id,
  seat: "red",
  revision,
  text: `m${id}`,
  createdAt: "2026-01-01T00:00:00.000Z"
});

const passed = (revision: number): LoggedEvent => ({
  revision,
  event: { type: "passed", seat: "black" }
});

describe("buildLogEntries", () => {
  it("places chat after the events of its revision and before later ones", () => {
    const entries = buildLogEntries([passed(1), passed(2), passed(3)], [msg(1, 2), msg(2, 0)]);
    expect(entries.map((e) => e.key)).toEqual(["c2", "e0", "e1", "c1", "e2"]);
  });

  it("appends chat newer than every event at the end, in id order", () => {
    const entries = buildLogEntries([passed(1)], [msg(5, 1), msg(4, 1)]);
    expect(entries.map((e) => e.key)).toEqual(["e0", "c4", "c5"]);
  });

  it("turns a new round into a divider", () => {
    const entries = buildLogEntries(
      [passed(1), { revision: 2, event: { type: "recalled", round: 2, initiative: "red" } }],
      []
    );
    expect(entries.map((e) => e.kind)).toEqual(["event", "round"]);
  });
});

describe("mergeChat", () => {
  it("adds only unseen messages and keeps id order", () => {
    const merged = mergeChat([msg(1, 0), msg(3, 0)], [msg(3, 0), msg(2, 0)]);
    expect(merged.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it("returns the same array when nothing is new", () => {
    const held = [msg(1, 0)];
    expect(mergeChat(held, [msg(1, 0)])).toBe(held);
  });
});

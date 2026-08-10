import { describe, expect, it, vi } from "vitest";
import { withRetry } from "../src/ai/withRetry.js";

describe("withRetry", () => {
  it("resolves after attempts-1 failures", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error(`fail ${calls}`);
      return "ok";
    });
    await expect(withRetry(fn, { attempts: 3, delayMs: 0 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("rethrows the last error after exhausting attempts", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      throw new Error(`fail ${calls}`);
    });
    await expect(withRetry(fn, { attempts: 3, delayMs: 0 })).rejects.toThrow("fail 3");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry on first success", async () => {
    const fn = vi.fn(async () => "first");
    await expect(withRetry(fn, { attempts: 3, delayMs: 0 })).resolves.toBe("first");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

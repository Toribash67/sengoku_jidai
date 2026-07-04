import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDoc } from "../../src/editor/doc.js";
import { persistDoc } from "../../src/editor/save.js";

function stubFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body)
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("persistDoc", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects a blank name without calling the API", async () => {
    const mock = stubFetch(201, {});
    await expect(persistDoc({ ...emptyDoc(), name: "  " })).rejects.toThrow(
      "Name your map before saving."
    );
    expect(mock).not.toHaveBeenCalled();
  });

  it("POSTs new docs with the placeholder id", async () => {
    const mock = stubFetch(201, { id: "srv-1" });
    await persistDoc({ ...emptyDoc(), name: " Fresh " });
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe("/api/maps");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.id).toBe("new-map");
    expect(body.name).toBe("Fresh");
  });

  it("PUTs saved docs under their id", async () => {
    const mock = stubFetch(200, { id: "abc" });
    await persistDoc({ ...emptyDoc(), id: "abc", name: "Known" });
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe("/api/maps/abc");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string).id).toBe("abc");
  });
});

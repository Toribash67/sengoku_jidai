import { describe, expect, it, vi } from "vitest";
import { buildCandidateInput, generateCandidate } from "../src/matrixBackend.js";
import type { Candidate } from "../src/matrixProfile.js";

const baseUrl = "https://up/base.png";

function candidate(over: Partial<Candidate>): Candidate {
  return {
    label: "c",
    method: "flux-img2img",
    model: "fal-ai/x",
    prompt: "antique map",
    seed: 1568,
    guidanceScale: 3.5,
    numInferenceSteps: 34,
    enableSafetyChecker: false,
    ...over
  };
}

describe("buildCandidateInput", () => {
  it("img2img uses image_url + strength and omits image_size", () => {
    const input = buildCandidateInput(candidate({ method: "flux-img2img", strength: 0.9 }), {
      baseUrl
    });
    expect(input).toMatchObject({
      prompt: "antique map",
      image_url: baseUrl,
      strength: 0.9,
      seed: 1568
    });
    // These endpoints have no image_size param (output follows the input image).
    expect(input).not.toHaveProperty("image_size");
  });

  it("controlnet passes the base as both image_url and control_lora_image_url + control_lora_strength", () => {
    const input = buildCandidateInput(
      candidate({ method: "flux-controlnet-canny", conditioningScale: 0.4 }),
      { baseUrl }
    );
    expect(input).toMatchObject({
      image_url: baseUrl,
      control_lora_image_url: baseUrl,
      control_lora_strength: 0.4
    });
  });

  it("recraft-v3 passes a style and omits flux-only knobs", () => {
    const input = buildCandidateInput(
      candidate({ method: "recraft-v3", strength: 0.6, style: "digital_illustration" }),
      { baseUrl }
    );
    expect(input).toMatchObject({
      image_url: baseUrl,
      strength: 0.6,
      style: "digital_illustration"
    });
    expect(input).not.toHaveProperty("guidance_scale");
  });

  it("sdxl-map-lora passes a loras array", () => {
    const input = buildCandidateInput(
      candidate({ method: "sdxl-map-lora", strength: 0.7, loraUrl: "https://lora/x.safetensors" }),
      { baseUrl }
    );
    expect(input).toMatchObject({
      image_url: baseUrl,
      loras: [{ path: "https://lora/x.safetensors", scale: 1 }]
    });
  });
});

describe("generateCandidate", () => {
  it("subscribes with the candidate model and returns fetched bytes", async () => {
    const fal = {
      storage: { upload: vi.fn() },
      subscribe: vi.fn(async (_model: string, _opts: { input: Record<string, unknown> }) => ({
        data: { images: [{ url: "https://out/r.png" }] }
      }))
    };
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode("PNG").buffer
    }));
    const out = await generateCandidate(
      { fal, fetch },
      { candidate: candidate({ model: "fal-ai/test" }), baseUrl }
    );
    expect(fal.subscribe.mock.calls[0]![0]).toBe("fal-ai/test");
    expect(out.toString()).toBe("PNG");
  });

  it("throws (labelled) when the result fetch fails", async () => {
    const fal = {
      storage: { upload: vi.fn() },
      subscribe: vi.fn(async (_model: string, _opts: { input: Record<string, unknown> }) => ({
        data: { images: [{ url: "https://out/r.png" }] }
      }))
    };
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      arrayBuffer: async () => new ArrayBuffer(0)
    }));
    await expect(
      generateCandidate({ fal, fetch }, { candidate: candidate({ label: "boom" }), baseUrl })
    ).rejects.toThrow(/boom.*500|500.*boom/);
  });
});

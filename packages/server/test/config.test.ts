import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("falls back to the development default secret outside production", () => {
    const config = loadConfig({ NODE_ENV: "development" });
    expect(config.sessionSecret).toBe("development-only-change-me");
  });

  it("rejects a missing SESSION_SECRET in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/SESSION_SECRET/);
  });

  it("rejects placeholder secrets in production", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "production", SESSION_SECRET: "development-only-change-me" })
    ).toThrow(/SESSION_SECRET/);
    expect(() =>
      loadConfig({ NODE_ENV: "production", SESSION_SECRET: "please-change-me-later" })
    ).toThrow(/SESSION_SECRET/);
  });

  it("accepts a real secret in production", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      SESSION_SECRET: "f3b1c9d4e8a2476aa1905b3c7d2e6f10"
    });
    expect(config.sessionSecret).toBe("f3b1c9d4e8a2476aa1905b3c7d2e6f10");
  });

  it("leaves falKey undefined when FAL_KEY is absent", () => {
    const config = loadConfig({ NODE_ENV: "development" });
    expect(config.falKey).toBeUndefined();
  });

  it("sets falKey to the provided value", () => {
    const config = loadConfig({ NODE_ENV: "development", FAL_KEY: "test-key-123" });
    expect(config.falKey).toBe("test-key-123");
  });

  it("parses ADMIN_PASSWORD into adminPassword", () => {
    const config = loadConfig({ NODE_ENV: "development", ADMIN_PASSWORD: "hunter2" });
    expect(config.adminPassword).toBe("hunter2");
  });

  it("leaves adminPassword undefined when ADMIN_PASSWORD is unset", () => {
    const config = loadConfig({ NODE_ENV: "development" });
    expect(config.adminPassword).toBeUndefined();
  });
});

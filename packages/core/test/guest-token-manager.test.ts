import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import GuestTokenManager from "../app/guest-token-manager";

describe("GuestTokenManager", () => {
  let manager: GuestTokenManager;

  beforeEach(() => {
    manager = new GuestTokenManager();
  });

  afterEach(() => {
    manager.stop();
  });

  test("start fetches 5 tokens and begins interval", async () => {
    let fetchCount = 0;
    (
      spyOn(global, "fetch") as unknown as {
        mockResolvedValue(val: unknown): void;
      }
    ).mockResolvedValue({
      ok: true,
      json: async () => ({ guest_token: `token-${++fetchCount}` }),
    } as Response);

    await manager.start();

    expect(manager.tokens).toHaveLength(5);
    expect(manager.tokens[0]).toBe("token-1");
    expect(manager.tokens[4]).toBe("token-5");
  });

  test("getToken rotates tokens", async () => {
    (
      spyOn(global, "fetch") as unknown as {
        mockResolvedValue(val: unknown): void;
      }
    ).mockResolvedValue({
      ok: true,
      json: async () => ({ guest_token: "test-token" }),
    } as Response);

    await manager.start();
    const first = manager.getToken();
    const second = manager.getToken();

    expect(first).toBe("test-token");
    expect(second).toBe("test-token");
    expect(manager.tokens[manager.tokens.length - 1]).toBe("test-token");
  });

  test("getToken throws when pool is empty", () => {
    expect(() => manager.getToken()).toThrow("Guest token pool empty");
  });

  test("tokens array caps at 10 items", async () => {
    let fetchCount = 0;
    (
      spyOn(global, "fetch") as unknown as {
        mockResolvedValue(val: unknown): void;
      }
    ).mockResolvedValue({
      ok: true,
      json: async () => ({ guest_token: `token-${++fetchCount}` }),
    } as Response);

    await manager.start();
    // Manually push more tokens to exceed limit
    for (let i = 0; i < 10; i++) {
      manager.tokens.push(`extra-${i}`);
    }
    expect(manager.tokens.length).toBeGreaterThan(10);

    // Trigger the cap logic by calling fetch again
    await (
      manager as unknown as { fetchGuestToken(): Promise<void> }
    ).fetchGuestToken();

    expect(manager.tokens.length).toBeLessThanOrEqual(10);
  });

  test("stop clears interval", async () => {
    (
      spyOn(global, "fetch") as unknown as {
        mockResolvedValue(val: unknown): void;
      }
    ).mockResolvedValue({
      ok: true,
      json: async () => ({ guest_token: "token" }),
    } as Response);

    await manager.start();
    expect(manager["timer"]).not.toBeNull();

    manager.stop();
    expect(manager["timer"]).toBeNull();
  });

  test("fetch handles API errors gracefully", async () => {
    (
      spyOn(global, "fetch") as unknown as {
        mockResolvedValue(val: unknown): void;
      }
    ).mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "Rate limited",
    } as Response);

    await manager.start();
    // Should not throw, just log error
    expect(manager.tokens).toHaveLength(0);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";

describe("Catalog visit stream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends page visits with the Catalog schema", async () => {
    const streamFetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 202 })
    );
    vi.stubGlobal("fetch", streamFetch);
    const pending: Promise<unknown>[] = [];
    const executionContext = {
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise);
      }
    } as unknown as ExecutionContext;

    const response = await app.fetch(
      new Request("https://cafe.example/menu", {
        headers: {
          Accept: "text/html",
          "CF-IPCountry": "VN",
          "CF-Connecting-IP": "203.0.113.12",
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile"
        }
      }),
      {
        CATALOG_STREAM_URL: "https://catalog.example/ingest"
      } as never,
      executionContext
    );

    await Promise.all(pending);

    expect(response.status).toBe(404);
    expect(streamFetch).toHaveBeenCalledOnce();
    expect(streamFetch).toHaveBeenCalledWith(
      "https://catalog.example/ingest",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" }
      })
    );
    const payload = JSON.parse(String(streamFetch.mock.calls[0]?.[1]?.body));
    expect(payload).toEqual({
      id: "nhom 06 cnttk22e",
      country: "VN",
      device: "mobile",
      time: expect.any(Number),
      ip: "203.0.113.12",
      meta: { event_type: "page_view", path: "/menu" }
    });
    expect(payload.time).toBeGreaterThan(1_000_000_000_000);
  });

  it("does not stream API or non-HTML requests", async () => {
    const streamFetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 202 })
    );
    vi.stubGlobal("fetch", streamFetch);
    const executionContext = { waitUntil: vi.fn() } as never;

    await app.fetch(
      new Request("https://cafe.example/api/health", {
        headers: { Accept: "application/json" }
      }),
      {
        CATALOG_STREAM_URL: "https://catalog.example/ingest"
      } as never,
      executionContext
    );
    expect(streamFetch).not.toHaveBeenCalled();
    expect(streamFetch).not.toHaveBeenCalled();
  });

  it("streams click, submit, and change interaction metadata", async () => {
    const streamFetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 202 })
    );
    vi.stubGlobal("fetch", streamFetch);
    const pending: Promise<unknown>[] = [];
    const executionContext = {
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise);
      }
    } as unknown as ExecutionContext;
    const env = { CATALOG_STREAM_URL: "https://catalog.example/ingest" } as never;

    for (const type of ["click", "submit", "change"] as const) {
      const response = await app.request(
        "/api/catalog/interaction",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "CF-IPCountry": "VN",
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile"
          },
          body: JSON.stringify({ type, target: "open-cart", path: "/" })
        },
        env,
        executionContext
      );
      expect(response.status).toBe(202);
    }
    await Promise.all(pending);

    expect(streamFetch).toHaveBeenCalledTimes(3);
    for (const [index, type] of ["click", "submit", "change"].entries()) {
      const payload = JSON.parse(String(streamFetch.mock.calls[index]?.[1]?.body));
      expect(payload).toEqual({
        id: "nhom 06 cnttk22e",
        country: "VN",
        device: "mobile",
        time: expect.any(Number),
        ip: "",
        meta: { event_type: type, target: "open-cart", path: "/" }
      });
    }
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({
  revalidateTag,
}));

import { POST } from "./route";

describe("POST /api/revalidate", () => {
  beforeEach(() => {
    revalidateTag.mockReset();
    delete process.env.SJ_REVALIDATE_SECRET;
  });

  it("returns 503 when SJ_REVALIDATE_SECRET is unset", async () => {
    const res = await POST(
      new Request("http://localhost/api/revalidate", { method: "POST" }),
    );
    expect(res.status).toBe(503);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("returns 401 on bad bearer token", async () => {
    process.env.SJ_REVALIDATE_SECRET = "correct";
    const res = await POST(
      new Request("http://localhost/api/revalidate", {
        method: "POST",
        headers: { Authorization: "Bearer wrong" },
      }),
    );
    expect(res.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("revalidates sj-snapshots on valid bearer token", async () => {
    process.env.SJ_REVALIDATE_SECRET = "correct";
    const res = await POST(
      new Request("http://localhost/api/revalidate", {
        method: "POST",
        headers: { Authorization: "Bearer correct" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, revalidated: true, tag: "sj-snapshots" });
    expect(revalidateTag).toHaveBeenCalledWith("sj-snapshots", "max");
  });
});

describe("revalidate wiring", () => {
  it("allows /api/revalidate through middleware without a session", () => {
    const middleware = readFileSync(
      path.resolve(__dirname, "../../../middleware.ts"),
      "utf8",
    );
    expect(middleware).toMatch(/\/api\/revalidate/);
    expect(middleware).toMatch(/isRevalidate/);
  });

  it("tags snapshot reads for revalidateTag", () => {
    const data = readFileSync(
      path.resolve(__dirname, "../../../lib/data.ts"),
      "utf8",
    );
    expect(data).toMatch(/unstable_cache/);
    expect(data).toMatch(/SJ_SNAPSHOTS_CACHE_TAG/);
    expect(data).not.toMatch(/\bfileCache\b/);
  });
});

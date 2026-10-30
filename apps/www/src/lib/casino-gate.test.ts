import { describe, expect, it } from "vitest";

import {
  casinoSignedOutResponse,
  isCasinoNavigation,
} from "./casino-gate";

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`http://portal.test${path}`, init);
}

describe("isCasinoNavigation", () => {
  it("treats document loads as navigations", () => {
    expect(
      isCasinoNavigation("GET", "/casino", new Headers({ "sec-fetch-dest": "document" })),
    ).toBe(true);
    expect(
      isCasinoNavigation("GET", "/casino", new Headers({ accept: "text/html,*/*;q=0.8" })),
    ).toBe(true);
    expect(isCasinoNavigation("GET", "/casino", new Headers())).toBe(true);
  });

  it("treats assets, fetches and writes as non-navigations", () => {
    expect(
      isCasinoNavigation("GET", "/casino/cards/x.jpg", new Headers({ "sec-fetch-dest": "document" })),
    ).toBe(false);
    expect(isCasinoNavigation("GET", "/casino/assets/app.js", new Headers())).toBe(false);
    expect(
      isCasinoNavigation("GET", "/casino/api/state", new Headers({ "sec-fetch-dest": "empty" })),
    ).toBe(false);
    expect(
      isCasinoNavigation("GET", "/casino/img", new Headers({ "sec-fetch-dest": "image" })),
    ).toBe(false);
    expect(isCasinoNavigation("POST", "/casino", new Headers())).toBe(false);
  });
});

describe("casinoSignedOutResponse", () => {
  it("redirects page requests to /login with the original path and query", () => {
    const res = casinoSignedOutResponse(
      req("/casino/lobby?table=3", { headers: { accept: "text/html" } }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      `/login?callbackUrl=${encodeURIComponent("/casino/lobby?table=3")}`,
    );
  });

  it("makes the redirect absolute for middleware", () => {
    const res = casinoSignedOutResponse(
      req("/casino", { headers: { accept: "text/html" } }),
      { absolute: true },
    );
    const location = res.headers.get("location") ?? "";
    expect(new URL(location).pathname).toBe("/login");
    expect(new URL(location).searchParams.get("callbackUrl")).toBe("/casino");
  });

  it("returns 401 for images and other assets", () => {
    const res = casinoSignedOutResponse(req("/casino/cards/x.jpg"));
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  casinoIdentityHeaders,
  casinoUserId,
  casinoUserName,
  withGoogleSub,
} from "./casino-identity";

const SALT = "test-salt-value";

describe("casinoUserId", () => {
  it("HMACs the sub with the salt: 24 hex chars, stable, salt-dependent", () => {
    const a = casinoUserId({ id: "1234567890" }, { CASINO_USER_ID_SALT: SALT });
    expect(a).toMatch(/^[0-9a-f]{24}$/);
    expect(casinoUserId({ id: "1234567890" }, { CASINO_USER_ID_SALT: SALT })).toBe(a);
    expect(casinoUserId({ id: "1234567890" }, { CASINO_USER_ID_SALT: "other" })).not.toBe(a);
    expect(casinoUserId({ id: "999" }, { CASINO_USER_ID_SALT: SALT })).not.toBe(a);
  });

  it("never contains the sub or the email", () => {
    const id = casinoUserId(
      { id: "1234567890", email: "pat@example.com" },
      { CASINO_USER_ID_SALT: SALT },
    );
    expect(id).not.toContain("1234567890");
    expect(id).not.toContain("pat");
  });

  it("falls back to the email under a salt when there is no sub", () => {
    const id = casinoUserId({ email: "Pat@Example.com" }, { CASINO_USER_ID_SALT: SALT });
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    expect(casinoUserId({ email: "pat@example.com" }, { CASINO_USER_ID_SALT: SALT })).toBe(id);
  });

  it("uses a plain SHA-256 of the sub without a salt", () => {
    // sha256("1234567890") = c775e7b757ede630cd0aa1113bd102661ab38829ca52a6422ab782862f268646
    expect(casinoUserId({ id: "1234567890" }, {})).toBe("c775e7b757ede630cd0aa111");
    expect(casinoUserId({ id: "1234567890" }, { CASINO_USER_ID_SALT: "  " })).toBe(
      "c775e7b757ede630cd0aa111",
    );
  });

  it("refuses to hash an email without a salt", () => {
    expect(casinoUserId({ email: "pat@example.com" }, {})).toBeNull();
    expect(casinoUserId({}, { CASINO_USER_ID_SALT: SALT })).toBeNull();
  });
});

/** Same formula as the casino repo's scripts/mod-id.mjs (HMAC-SHA256, "sj:" + input, hex, 24). */
function modIdFormat(salt: string, input: string): string {
  return createHmac("sha256", salt).update(`sj:${input}`).digest("hex").slice(0, 24);
}

describe("casinoUserId (stable Google subject)", () => {
  const env = { CASINO_USER_ID_SALT: SALT };

  it("uses the Google subject, not the per-sign-in Auth.js sub", () => {
    const first = casinoUserId(
      { googleSub: "1234567890", id: "uuid-one", email: "pat@example.com" },
      env,
    );
    const second = casinoUserId(
      { googleSub: "1234567890", id: "uuid-two", email: "pat@example.com" },
      env,
    );
    expect(first).toBe(second);
    expect(first).toBe("80169f74dd16f6167b146d5b");
  });

  it("matches the mod-id.mjs format for the subject and for the email", () => {
    expect(casinoUserId({ googleSub: "1234567890", id: "uuid" }, env)).toBe(
      modIdFormat(SALT, "1234567890"),
    );
    // Sessions minted before the subject was captured: email fallback, never the random sub.
    expect(casinoUserId({ id: "uuid-one", email: "pat@example.com" }, env)).toBe(
      modIdFormat(SALT, "pat@example.com"),
    );
    expect(casinoUserId({ id: "uuid-two", email: "pat@example.com" }, env)).toBe(
      "aeeb0825924c2cf5316949cf",
    );
  });

  it("normalises the email (trim, lowercase) in the fallback", () => {
    expect(casinoUserId({ id: "uuid", email: "  Pat@Example.COM " }, env)).toBe(
      modIdFormat(SALT, "pat@example.com"),
    );
  });

  it("uses the random Auth.js sub only when there is no subject and no email", () => {
    expect(casinoUserId({ id: "dev-bypass" }, env)).toBe(modIdFormat(SALT, "dev-bypass"));
  });

  it("without a salt, hashes the subject in preference to the Auth.js sub", () => {
    expect(casinoUserId({ googleSub: "1234567890", id: "uuid" }, {})).toBe(
      "c775e7b757ede630cd0aa111",
    );
    expect(casinoUserId({ id: "uuid", email: "pat@example.com" }, {})).not.toBeNull();
  });
});

describe("withGoogleSub", () => {
  const account = { provider: "google", providerAccountId: "1234567890" };

  it("stores the Google subject on sign-in and keeps the id stable across sign-ins", () => {
    // Auth.js hands every sign-in a fresh random token.sub.
    const a = withGoogleSub({ sub: "uuid-one", email: "pat@example.com" }, account);
    const b = withGoogleSub({ sub: "uuid-two", email: "pat@example.com" }, account);
    expect(a.sub).not.toBe(b.sub);
    expect(a.googleSub).toBe("1234567890");
    const env = { CASINO_USER_ID_SALT: SALT };
    expect(casinoUserId({ googleSub: a.googleSub, id: a.sub }, env)).toBe(
      casinoUserId({ googleSub: b.googleSub, id: b.sub }, env),
    );
  });

  it("leaves the token alone when there is no account (later session reads)", () => {
    const token = { sub: "uuid", googleSub: "1234567890" };
    expect(withGoogleSub(token, undefined)).toBe(token);
    expect(withGoogleSub(token, null)).toBe(token);
  });

  it("ignores other providers and empty ids", () => {
    expect(withGoogleSub({ sub: "u" }, { provider: "github", providerAccountId: "9" })).toEqual({
      sub: "u",
    });
    expect(withGoogleSub({ sub: "u" }, { provider: "google", providerAccountId: " " })).toEqual({
      sub: "u",
    });
  });
});

describe("casinoUserName", () => {
  it("prefers name, then username, then Player", () => {
    expect(casinoUserName({ name: "Pat Jay", username: "pj" })).toBe("Pat%20Jay");
    expect(casinoUserName({ name: " ", username: "pj" })).toBe("pj");
    expect(casinoUserName({})).toBe("Player");
  });

  it("never uses the email or its local part", () => {
    const email = "pat.jay@example.com";
    expect(casinoUserName({ name: email, email })).toBe("Player");
    expect(casinoUserName({ name: "pat.jay", email })).toBe("Player");
    expect(casinoUserName({ name: "PAT.JAY", username: "pj", email })).toBe("pj");
    expect(casinoUserName({ name: "someone@else.com" })).toBe("Player");
  });

  it("trims to 40 characters and URI-encodes UTF-8", () => {
    expect(decodeURIComponent(casinoUserName({ name: "x".repeat(60) }))).toBe("x".repeat(40));
    expect(casinoUserName({ name: "Zoë 🎲" })).toBe(encodeURIComponent("Zoë 🎲"));
    const emoji = casinoUserName({ name: "🎲".repeat(60) });
    expect(Array.from(decodeURIComponent(emoji))).toHaveLength(40);
  });
});

describe("casinoIdentityHeaders", () => {
  it("returns only id and name; omits the id when none can be derived", () => {
    const withId = casinoIdentityHeaders(
      { id: "42", name: "Pat", email: "pat@example.com" },
      { CASINO_USER_ID_SALT: SALT },
    );
    expect(Object.keys(withId).sort()).toEqual(["x-sj-user-id", "x-sj-user-name"]);
    expect(casinoIdentityHeaders({ name: "Pat" }, {})).toEqual({
      "x-sj-user-name": "Pat",
    });
  });
});

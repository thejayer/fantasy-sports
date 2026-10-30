import { describe, expect, it } from "vitest";

import {
  casinoIdentityHeaders,
  casinoUserId,
  casinoUserName,
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
    expect(casinoIdentityHeaders({ name: "Pat" }, {})).toEqual({ "x-sj-user-name": "Pat" });
  });
});

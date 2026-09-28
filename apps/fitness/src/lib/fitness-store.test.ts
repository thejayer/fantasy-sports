import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FitnessActor } from "./session";

const ada: FitnessActor = {
  email: "ada@sj.com",
  name: "Ada",
  image: null,
  source: "session",
};

const bob: FitnessActor = {
  email: "bob@sj.com",
  name: "Bob",
  image: null,
  source: "session",
};

async function loadStore() {
  return import("./fitness-store");
}

describe("per-user fitness store isolation", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "sj-fitness-"));
    process.env.SJ_FITNESS_DIR = root;
  });

  afterEach(() => {
    delete process.env.SJ_FITNESS_DIR;
  });

  it("creates a profile on first ensure and keeps members on separate files", async () => {
    const { ensureAthleteDocument, athleteDocumentPath } = await loadStore();
    const adaDoc = await ensureAthleteDocument(ada);
    const bobDoc = await ensureAthleteDocument(bob);

    expect(adaDoc.email).toBe("ada@sj.com");
    expect(bobDoc.email).toBe("bob@sj.com");
    expect(athleteDocumentPath("ada@sj.com")).not.toBe(
      athleteDocumentPath("bob@sj.com"),
    );

    const adaRaw = JSON.parse(
      await readFile(athleteDocumentPath("ada@sj.com"), "utf8"),
    ) as { email: string };
    expect(adaRaw.email).toBe("ada@sj.com");
  });

  it("does not let Bob read Ada's sessions", async () => {
    const { ensureAthleteDocument, readAthleteDocument, saveAthleteSlices } =
      await loadStore();

    await saveAthleteSlices(ada, {
      sessions: [{ id: "ada-secret", type: "Golf Range Session" }],
    });
    await ensureAthleteDocument(bob);

    const adaRead = await readAthleteDocument("ada@sj.com");
    const bobRead = await readAthleteDocument("bob@sj.com");

    expect(adaRead?.slices.sessions).toEqual([
      { id: "ada-secret", type: "Golf Range Session" },
    ]);
    expect(bobRead?.slices.sessions).toEqual([]);
    expect(JSON.stringify(bobRead)).not.toContain("ada-secret");
  });

  it("migrates anonymous data once into that member's store", async () => {
    const { saveAthleteSlices } = await loadStore();
    const first = await saveAthleteSlices(
      ada,
      { sessions: [{ id: "from-phone" }] },
      { migrate: true },
    );
    expect(first.migrated_from_anonymous).toBe(true);
    expect(first.slices.sessions).toEqual([{ id: "from-phone" }]);

    await expect(
      saveAthleteSlices(ada, { sessions: [{ id: "second-try" }] }, { migrate: true }),
    ).rejects.toThrow(/already migrated/);
  });

  it("ignores a spoofed email in the payload path by keying only the actor", async () => {
    const { readAthleteDocument, saveAthleteSlices } = await loadStore();
    await saveAthleteSlices(bob, {
      email: "ada@sj.com",
      userId: "ada@sj.com",
      sessions: [{ id: "bob-only" }],
    });

    const adaRead = await readAthleteDocument("ada@sj.com");
    const bobRead = await readAthleteDocument("bob@sj.com");
    expect(adaRead).toBeNull();
    expect(bobRead?.slices.sessions).toEqual([{ id: "bob-only" }]);
  });
});

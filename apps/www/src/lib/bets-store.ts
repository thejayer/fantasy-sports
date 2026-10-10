/**
 * Read bets/bets.json from the GCS mount, else committed www fixtures.
 * Missing files are empty (EmptyState), not a 500.
 */

import { promises as fs } from "fs";
import path from "path";

import type { BetsDocument, BetRow } from "@/lib/bets";
import { betsDataRoots } from "@/lib/paths";
import { getBetsActor } from "@/lib/session";

function isBetRow(value: unknown): value is BetRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.who === "string";
}

function parseDocument(raw: string): BetsDocument | null {
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) {
    return { bets: parsed.filter(isBetRow) };
  }
  if (!parsed || typeof parsed !== "object") return null;
  const doc = parsed as BetsDocument;
  const bets = Array.isArray(doc.bets) ? doc.bets.filter(isBetRow) : [];
  return { ...doc, bets };
}

export async function getBetsDocument(): Promise<BetsDocument> {
  const empty: BetsDocument = { bets: [] };
  if (!(await getBetsActor())) {
    return empty;
  }
  for (const root of betsDataRoots()) {
    const filePath = path.join(root, "bets.json");
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return parseDocument(raw) ?? empty;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      throw err;
    }
  }
  return empty;
}

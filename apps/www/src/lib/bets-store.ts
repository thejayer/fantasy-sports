/**
 * Read bets/*.json from the GCS mount, else committed www fixtures.
 * Missing files are empty (EmptyState), not a 500.
 */

import { promises as fs } from "fs";
import path from "path";

import type { BetsDocument, BetRow } from "@/lib/bets";
import type { ParlayDocument, ParlayLeg } from "@/lib/bets-parlay";
import type { PublicDocument, PublicWarning } from "@/lib/bets-public";
import { betsDataRoots } from "@/lib/paths";
import { getBetsActor } from "@/lib/session";

function isBetRow(value: unknown): value is BetRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.who === "string";
}

function isParlayLeg(value: unknown): value is ParlayLeg {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.who === "string";
}

function isPublicWarning(value: unknown): value is PublicWarning {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string";
}

async function readFirstFile(name: string): Promise<string | null> {
  for (const root of betsDataRoots()) {
    const filePath = path.join(root, name);
    try {
      return await fs.readFile(filePath, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      throw err;
    }
  }
  return null;
}

function parseBetsDocument(raw: string): BetsDocument | null {
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) {
    return { bets: parsed.filter(isBetRow) };
  }
  if (!parsed || typeof parsed !== "object") return null;
  const doc = parsed as BetsDocument;
  const bets = Array.isArray(doc.bets) ? doc.bets.filter(isBetRow) : [];
  return { ...doc, bets };
}

function parseParlayDocument(raw: string): ParlayDocument | null {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") return null;
  const doc = parsed as ParlayDocument;
  const legs = Array.isArray(doc.legs) ? doc.legs.filter(isParlayLeg) : [];
  return { ...doc, legs };
}

function parsePublicDocument(raw: string): PublicDocument | null {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") return null;
  const doc = parsed as PublicDocument;
  const warnings = Array.isArray(doc.warnings) ? doc.warnings.filter(isPublicWarning) : [];
  return { ...doc, warnings };
}

export async function getBetsDocument(): Promise<BetsDocument> {
  const empty: BetsDocument = { bets: [] };
  if (!(await getBetsActor())) return empty;
  const raw = await readFirstFile("bets.json");
  return raw ? (parseBetsDocument(raw) ?? empty) : empty;
}

export async function getParlayDocument(): Promise<ParlayDocument> {
  const empty: ParlayDocument = { legs: [] };
  if (!(await getBetsActor())) return empty;
  const raw = await readFirstFile("parlay_legs.json");
  return raw ? (parseParlayDocument(raw) ?? empty) : empty;
}

export async function getPublicDocument(): Promise<PublicDocument> {
  const empty: PublicDocument = { warnings: [] };
  if (!(await getBetsActor())) return empty;
  const raw = await readFirstFile("public_warnings.json");
  return raw ? (parsePublicDocument(raw) ?? empty) : empty;
}

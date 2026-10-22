/**
 * Read bets/*.json from the GCS mount (fs) or the bucket (gcs), else
 * committed www fixtures. Missing files are empty (EmptyState), not a 500.
 */

import type { BetsDocument, BetRow } from "@/lib/bets";
import type { ParlayDocument, ParlayLeg } from "@/lib/bets-parlay";
import type { PublicDocument, PublicWarning } from "@/lib/bets-public";
import { isSplitCheck, type SplitRow, type SplitsDocument } from "@/lib/bets-splits";
import type { TailLeg, TailView, TailingDocument } from "@/lib/bets-tailing";
import { readBetsText } from "@/lib/data-source";
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

function isSplitRow(value: unknown): value is SplitRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.who === "string" && typeof row.kind === "string";
}

async function readFirstFile(name: string): Promise<string | null> {
  return readBetsText(name);
}

function parseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function parseBetsDocument(raw: string): BetsDocument | null {
  const parsed = parseJson(raw);
  if (Array.isArray(parsed)) {
    return { bets: parsed.filter(isBetRow) };
  }
  if (!parsed || typeof parsed !== "object") return null;
  const doc = parsed as BetsDocument;
  const bets = Array.isArray(doc.bets) ? doc.bets.filter(isBetRow) : [];
  return { ...doc, bets };
}

function parseParlayDocument(raw: string): ParlayDocument | null {
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== "object") return null;
  const doc = parsed as ParlayDocument;
  const legs = Array.isArray(doc.legs) ? doc.legs.filter(isParlayLeg) : [];
  return { ...doc, legs };
}

function parsePublicDocument(raw: string): PublicDocument | null {
  const parsed = parseJson(raw);
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

function parseSplitsDocument(raw: string): SplitsDocument | null {
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== "object") return null;
  const doc = parsed as SplitsDocument;
  const splits = Array.isArray(doc.splits) ? doc.splits.filter(isSplitRow) : [];
  const sports = Array.isArray(doc.sports) ? doc.sports.filter(isSplitRow) : [];
  const checks = Array.isArray(doc.checks) ? doc.checks.filter(isSplitCheck) : [];
  return { ...doc, splits, sports, checks };
}

export async function getSplitsDocument(): Promise<SplitsDocument> {
  const empty: SplitsDocument = { splits: [], sports: [], checks: [] };
  if (!(await getBetsActor())) return empty;
  const raw = await readFirstFile("record_splits.json");
  return raw ? (parseSplitsDocument(raw) ?? empty) : empty;
}

function isTailLeg(value: unknown): value is TailLeg {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.who === "string";
}

function isTailView(value: unknown): value is TailView {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.who === "string" && row.overall != null && typeof row.overall === "object";
}

function parseTailingDocument(raw: string): TailingDocument | null {
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== "object") return null;
  const doc = parsed as TailingDocument;
  const legs = Array.isArray(doc.legs) ? doc.legs.filter(isTailLeg) : [];
  const views = Array.isArray(doc.views) ? doc.views.filter(isTailView) : [];
  return { ...doc, legs, views };
}

export async function getTailingDocument(): Promise<TailingDocument> {
  const empty: TailingDocument = { views: [], legs: [] };
  if (!(await getBetsActor())) return empty;
  const raw = await readFirstFile("tailing_legs.json");
  return raw ? (parseTailingDocument(raw) ?? empty) : empty;
}

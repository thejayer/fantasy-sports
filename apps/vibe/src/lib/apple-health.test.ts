import { readFileSync } from "fs";
import path from "path";
import { deflateRawSync } from "zlib";
import { describe, expect, it } from "vitest";

import {
  createAppleHealthWorkoutScanner,
  extractExportXmlFromZip,
  humanizeAppleType,
  parseAppleHealthWorkouts,
} from "./apple-health";

const xml = readFileSync(
  path.join(__dirname, "../fixtures/export.xml"),
  "utf8",
);

describe("Apple Health export.xml", () => {
  it("parses Workout start tags from the fixture", () => {
    const rows = parseAppleHealthWorkouts(xml);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.name).toBe("Traditional Strength Training");
    expect(rows[0]?.start).toBe("2026-10-05T11:00:00.000Z");
    expect(rows[0]?.active_energy_kcal).toBe(412.5);
    expect(rows[1]?.name).toBe("Functional Strength Training");
  });

  it("humanizes HKWorkoutActivityType names", () => {
    expect(humanizeAppleType("HKWorkoutActivityTypeIndoorCycle")).toBe(
      "Indoor Cycle",
    );
  });

  it("survives a Workout tag split across chunks", () => {
    const scanner = createAppleHealthWorkoutScanner();
    const idx = xml.indexOf("<Workout");
    scanner.push(xml.slice(0, idx + 12));
    scanner.push(xml.slice(idx + 12));
    expect(scanner.finish()).toHaveLength(2);
  });

  it("extracts export.xml from a stored zip", () => {
    const name = Buffer.from("export.xml");
    const data = Buffer.from(xml, "utf8");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(0, 8);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    const zip = Buffer.concat([header, name, data]);
    expect(extractExportXmlFromZip(zip)).toContain(
      "TraditionalStrengthTraining",
    );
  });

  it("inflates a deflated export.xml", () => {
    const name = Buffer.from("apple_health_export/export.xml");
    const data = deflateRawSync(Buffer.from(xml, "utf8"));
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(xml.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    const zip = Buffer.concat([header, name, data]);
    const extracted = extractExportXmlFromZip(zip);
    expect(parseAppleHealthWorkouts(extracted ?? "")).toHaveLength(2);
  });
});

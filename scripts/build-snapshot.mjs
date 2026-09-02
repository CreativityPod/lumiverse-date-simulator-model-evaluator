import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(projectRoot, "benchmark-source", "Date_Simulator_CCv3_v1.5.5.json");
const outputPath = join(projectRoot, "src", "generated", "date-simulator-v1.5.5.js");
const EXPECTED_SOURCE_SHA256 = "ec859dc21fc2af4bc662c5f3e5de07b72fbf2194e44b4e9324d8a868327c2634";

const raw = await readFile(sourcePath);
const sourceSha256 = createHash("sha256").update(raw).digest("hex");
if (sourceSha256 !== EXPECTED_SOURCE_SHA256) {
  throw new Error(`Date Simulator v1.5.5 source hash changed: ${sourceSha256}`);
}

const card = JSON.parse(raw.toString("utf8"));
const data = card?.data ?? {};
if (card.spec !== "chara_card_v3" || card.spec_version !== "3.0") {
  throw new Error("Expected a chara_card_v3 3.0 source card.");
}
if (data.name !== "Date Simulator" || data.character_version !== "1.5.5") {
  throw new Error("Expected Date Simulator character version 1.5.5.");
}
for (const field of ["description", "post_history_instructions", "first_mes", "mes_example"]) {
  if (typeof data[field] !== "string" || !data[field].trim()) {
    throw new Error(`Required card field is missing: ${field}`);
  }
}

const normalize = (value) => String(value).replace(/\r\n?/g, "\n").trim();
const snapshot = {
  schemaVersion: 1,
  snapshotVersion: "date-simulator-v1.5.5-headless.1",
  compilerVersion: "1.0.0",
  source: {
    name: data.name,
    creator: data.creator,
    characterVersion: data.character_version,
    spec: card.spec,
    specVersion: card.spec_version,
    sha256: sourceSha256,
  },
  description: normalize(data.description),
  postHistoryInstructions: normalize(data.post_history_instructions),
  firstMessage: normalize(data.first_mes),
  alternateGreetings: (data.alternate_greetings ?? []).map(normalize),
  messageExample: normalize(data.mes_example),
};
const normalizedForFingerprint = JSON.stringify(snapshot);
snapshot.fingerprint = createHash("sha256").update(normalizedForFingerprint).digest("hex");

await writeFile(
  outputPath,
  `// Generated from the canonical Date Simulator v1.5.5 card. Do not edit.\nexport const DATE_SIMULATOR_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};\n`,
  "utf8",
);
console.log(`Built canonical snapshot ${snapshot.fingerprint.slice(0, 12)} from ${sourceSha256.slice(0, 12)}`);

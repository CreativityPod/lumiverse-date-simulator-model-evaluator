import { DATE_SIMULATOR_SNAPSHOT } from "./generated/date-simulator-v1.5.5.js";

const INACTIVE_UNLESS = "{{unless::{{eq::{{getchatvar::date_simulator.phase}}::active}}}}";
const END_UNLESS = "{{/unless}}";

export function normalizeText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

export function resolveInactiveBlocks(source, active) {
  let output = normalizeText(source);
  let cursor = 0;
  while (true) {
    const start = output.indexOf(INACTIVE_UNLESS, cursor);
    if (start < 0) break;
    const end = output.indexOf(END_UNLESS, start + INACTIVE_UNLESS.length);
    if (end < 0) throw new Error("Unclosed Date Simulator inactive-phase block.");
    const body = output.slice(start + INACTIVE_UNLESS.length, end);
    output = `${output.slice(0, start)}${active ? "" : body}${output.slice(end + END_UNLESS.length)}`;
    cursor = start + (active ? 0 : body.length);
  }
  return output;
}

export function resolveCardMacros(source, { active = false, savedCase = "INACTIVE" } = {}) {
  const resolved = resolveInactiveBlocks(source, active)
    .replaceAll("{{char}}", "Date Simulator")
    .replaceAll("{{user}}", "Benchmark User")
    .replaceAll("{{getchatvar::date_simulator.phase}}", active ? "active" : "setup")
    .replaceAll("{{getchatvar::date_simulator.case}}", active ? savedCase : "INACTIVE");
  if (/\{\{(?:unless|\/unless|getchatvar|eq)::?/.test(resolved)) {
    throw new Error("Unresolved control macro remained in the compiled card prompt.");
  }
  return normalizeText(resolved);
}

export function cardSystemPrompt({ active = false, savedCase = "INACTIVE" } = {}) {
  const description = resolveCardMacros(DATE_SIMULATOR_SNAPSHOT.description, { active, savedCase });
  const postHistory = resolveCardMacros(DATE_SIMULATOR_SNAPSHOT.postHistoryInstructions, {
    active,
    savedCase,
  });
  return [
    `# Canonical headless character snapshot\nSnapshot: ${DATE_SIMULATOR_SNAPSHOT.snapshotVersion}\nYou are Date Simulator. Follow the character card below exactly. Benchmark User alone controls the male participant.`,
    description,
    postHistory,
  ].join("\n\n");
}

function cloneMessages(messages) {
  return (messages ?? []).map((message) => ({
    role: message.role,
    content: normalizeText(message.content),
  }));
}

export function compileBenchmark(test) {
  if (!test || typeof test !== "object") throw new Error("A benchmark definition is required.");
  if (test.promptKind === "original") {
    return cloneMessages(test.messages);
  }
  const active = test.phase === "active";
  const messages = [{
    role: "system",
    content: cardSystemPrompt({ active, savedCase: test.savedCase ?? "INACTIVE" }),
  }];
  if (test.includeGreeting) {
    messages.push({ role: "assistant", content: DATE_SIMULATOR_SNAPSHOT.firstMessage });
  }
  messages.push(...cloneMessages(test.messages));
  return messages;
}

export function snapshotMetadata() {
  return {
    snapshotVersion: DATE_SIMULATOR_SNAPSHOT.snapshotVersion,
    compilerVersion: DATE_SIMULATOR_SNAPSHOT.compilerVersion,
    fingerprint: DATE_SIMULATOR_SNAPSHOT.fingerprint,
    sourceSha256: DATE_SIMULATOR_SNAPSHOT.source.sha256,
    characterVersion: DATE_SIMULATOR_SNAPSHOT.source.characterVersion,
  };
}

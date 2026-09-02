import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("spindle.json", root), "utf8"));
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

check(/^\d+\.\d+\.\d+$/.test(manifest.version), "Manifest version is semver");
check(manifest.version === packageJson.version, "Manifest and package versions match");
check(/^[a-z0-9_]+$/.test(manifest.identifier), "Manifest identifier is valid");
check(manifest.permissions?.length === 2, "Only two permissions are requested");
for (const permission of ["generation", "ui_panels"]) {
  check(manifest.permissions?.includes(permission), `${permission} permission is requested`);
}
for (const forbidden of ["interceptor", "chat_mutation", "chats"]) {
  check(!manifest.permissions?.includes(forbidden), `${forbidden} permission is not requested`);
}
check(manifest.entry_backend === "dist/backend.js", "Backend entry is correct");
check(manifest.entry_frontend === "dist/frontend.js", "Frontend entry is correct");

for (const entry of [manifest.entry_backend, manifest.entry_frontend]) {
  try { await access(new URL(entry, root)); } catch { failures.push(`${entry} exists`); }
}

const backend = await readFile(new URL(manifest.entry_backend, root), "utf8");
const frontend = await readFile(new URL(manifest.entry_frontend, root), "utf8");
check(!/^import\s/m.test(backend), "Backend bundle has no imports");
check(!/^export\s/m.test(backend), "Backend bundle has no exports");
check(backend.includes("spindleApi.generate.raw"), "Backend uses raw generation");
check(backend.includes("spindle.connections.list"), "Backend lists connection profiles");
check(backend.includes("DATE_SIMULATOR_SNAPSHOT"), "Backend bundles the canonical card snapshot");
check(backend.includes("DATE_SIM_CASE"), "Backend validates the private profile capsule");
check(backend.includes("evaluator_delete_run"), "Backend supports individual report deletion");
check(backend.includes("evaluator_clear_reports"), "Backend supports clearing all reports");
check(frontend.includes("export function setup"), "Frontend exports setup");
check(frontend.includes("mountModelCombobox"), "Frontend uses native model comboboxes");
check(frontend.includes("showModal"), "Frontend contains the graphical report modal");
check(frontend.includes("registerDrawerTab"), "Frontend registers a drawer tab");
check(frontend.includes("Delete this report"), "Report modal exposes individual deletion");
check(!frontend.includes('button("Delete",'), "Recent Reports rows do not duplicate the report deletion action");
check(frontend.includes("Clear all reports"), "Drawer exposes confirmed bulk deletion");

if (failures.length) {
  console.error(`Package validation failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("Package validation passed.");

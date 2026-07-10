#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;
type ResourceType = "extensions" | "skills" | "prompts" | "themes";
type PackageConfig = JsonObject & {
  source: string;
  autoload?: boolean;
  extensions?: string[];
  skills?: string[];
  prompts?: string[];
  themes?: string[];
};
type PackageEntry = string | PackageConfig;
type Catalog = { version: 1; packages: string[] };
type Selection = { version: 1; packages: PackageEntry[] };
type Settings = JsonObject & { packages?: unknown[] };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = join(root, "catalog.json");
const localPath = join(root, "catalog.local.json");
const agentDir = process.env.PI_CODING_AGENT_DIR
  ? resolve(expandHome(process.env.PI_CODING_AGENT_DIR))
  : join(homedir(), ".pi", "agent");
const settingsPath = join(agentDir, "settings.json");
const resourceTypes: ResourceType[] = ["extensions", "skills", "prompts", "themes"];
const disableAllPattern = "!**/*";

const [command = "help", ...args] = process.argv.slice(2);

try {
  switch (command) {
    case "apply":
      await applyCatalog();
      break;
    case "capture":
      await captureSelection();
      break;
    case "config":
      await configureCatalog();
      break;
    case "status":
      await showStatus();
      break;
    case "add":
      await addPackage(args[0]);
      break;
    case "remove":
      await removePackage(args[0]);
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(`catalog: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

async function applyCatalog() {
  const catalog = await readCatalog();
  const local = await readSelection();
  const settings = await readJson(settingsPath, {});
  assertSettings(settings, settingsPath);

  const livePackages = normalizePackageEntries(settings.packages ?? [], settingsPath);
  const liveBySource = new Map(livePackages.map((entry) => [getSource(entry), entry]));
  const localBySource = new Map(local.packages.map((entry) => [getSource(entry), entry]));
  const managedSources = new Set([
    ...catalog.packages,
    ...local.packages.map(getSource),
  ]);

  const selectedPackages = catalog.packages.map((source) =>
    clonePackageEntry(localBySource.get(source) ?? liveBySource.get(source) ?? disabledPackage(source)),
  );
  const unmanagedPackages = livePackages.filter((entry) => !managedSources.has(getSource(entry)));

  await writeJson(settingsPath, {
    ...settings,
    packages: [...unmanagedPackages, ...selectedPackages],
  });
  await writeSelection(selectedPackages);

  console.log(`Applied ${catalog.packages.length} catalog package(s) to ${settingsPath}`);
  if (unmanagedPackages.length > 0) {
    console.log(`Preserved ${unmanagedPackages.length} unmanaged package(s)`);
  }
}

async function captureSelection() {
  const catalog = await readCatalog();
  const settings = await readJson(settingsPath, {});
  assertSettings(settings, settingsPath);

  const livePackages = normalizePackageEntries(settings.packages ?? [], settingsPath);
  const liveBySource = new Map(livePackages.map((entry) => [getSource(entry), entry]));
  const selectedPackages = catalog.packages.map((source) =>
    clonePackageEntry(liveBySource.get(source) ?? disabledPackage(source)),
  );

  await writeSelection(selectedPackages);
  console.log(`Captured local choices for ${catalog.packages.length} package(s) in ${localPath}`);
}

async function configureCatalog() {
  await applyCatalog();

  const result = spawnSync("pi", ["config"], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`pi config exited with status ${result.status ?? "unknown"}`);
  }

  await captureSelection();
  console.log("Local choices captured; catalog.json was not changed");
}

async function showStatus() {
  const catalog = await readCatalog();
  const local = await readSelection();
  const localBySource = new Map(local.packages.map((entry) => [getSource(entry), entry]));

  if (catalog.packages.length === 0) {
    console.log("Package catalog is empty");
    return;
  }

  for (const source of catalog.packages) {
    const entry = localBySource.get(source) ?? disabledPackage(source);
    console.log(`${isEnabled(entry) ? "enabled " : "disabled"}  ${source}`);
  }
}

async function addPackage(source: string | undefined) {
  assertSourceArgument(source, "add");
  const catalog = await readCatalog();
  if (catalog.packages.includes(source)) {
    console.log(`Already in catalog: ${source}`);
    return;
  }

  catalog.packages.push(source);
  await writeJson(catalogPath, catalog);
  await applyCatalog();
  console.log(`Added to catalog (disabled by default): ${source}`);
  console.log("Commit catalog.json to share the catalog");
}

async function removePackage(source: string | undefined) {
  assertSourceArgument(source, "remove");
  const catalog = await readCatalog();
  if (!catalog.packages.includes(source)) {
    throw new Error(`Package is not in catalog: ${source}`);
  }

  catalog.packages = catalog.packages.filter((entry) => entry !== source);
  await writeJson(catalogPath, catalog);
  await applyCatalog();
  console.log(`Removed from catalog: ${source}`);
  console.log("Commit catalog.json to share the catalog change");
}

async function readCatalog(): Promise<Catalog> {
  const value = await readJson(catalogPath);
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.packages)) {
    throw new Error(`Invalid package catalog: ${catalogPath}`);
  }
  if (!value.packages.every((source) => typeof source === "string" && source.length > 0)) {
    throw new Error(`Catalog packages must be non-empty source strings: ${catalogPath}`);
  }
  if (new Set(value.packages).size !== value.packages.length) {
    throw new Error(`Catalog contains duplicate package sources: ${catalogPath}`);
  }
  return { version: 1, packages: [...value.packages] };
}

async function readSelection(): Promise<Selection> {
  if (!existsSync(localPath)) return { version: 1, packages: [] };
  const value = await readJson(localPath);
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.packages)) {
    throw new Error(`Invalid local catalog selection: ${localPath}`);
  }
  return {
    version: 1,
    packages: normalizePackageEntries(value.packages, localPath),
  };
}

async function writeSelection(packages: PackageEntry[]) {
  await writeJson(localPath, { version: 1, packages });
}

function normalizePackageEntries(entries: unknown[], sourcePath: string): PackageEntry[] {
  return entries.map((entry) => {
    if (typeof entry === "string" && entry.length > 0) return entry;
    if (isObject(entry) && typeof entry.source === "string" && entry.source.length > 0) {
      return structuredClone(entry) as PackageConfig;
    }
    throw new Error(`Invalid package entry in ${sourcePath}`);
  });
}

function assertSettings(value: unknown, sourcePath: string): asserts value is Settings {
  if (!isObject(value)) throw new Error(`Invalid settings object: ${sourcePath}`);
  if (value.packages !== undefined && !Array.isArray(value.packages)) {
    throw new Error(`Invalid packages setting: ${sourcePath}`);
  }
}

function disabledPackage(source: string): PackageConfig {
  return {
    source,
    ...Object.fromEntries(resourceTypes.map((type) => [type, [disableAllPattern]])),
  };
}

function getSource(entry: PackageEntry): string {
  return typeof entry === "string" ? entry : entry.source;
}

function clonePackageEntry(entry: PackageEntry): PackageEntry {
  if (typeof entry === "string") return entry;

  // `autoload: false` without resource patterns resolves no files, so `pi config`
  // has nothing to display or enable. Migrate entries created by older versions to
  // explicit exclude-all filters: Pi can then show every resource as unchecked.
  if (entry.autoload === false && !resourceTypes.some((type) => Array.isArray(entry[type]) && entry[type].length > 0)) {
    return disabledPackage(entry.source);
  }

  return structuredClone(entry);
}

function isEnabled(entry: PackageEntry): boolean {
  if (typeof entry === "string") return true;
  if (entry.autoload === false) {
    return resourceTypes.some((type) =>
      Array.isArray(entry[type]) && entry[type].some((pattern) => !pattern.startsWith("!") && !pattern.startsWith("-")),
    );
  }
  return !resourceTypes.every((type) =>
    Array.isArray(entry[type]) && entry[type].length === 1 && entry[type][0] === disableAllPattern,
  );
}

function assertSourceArgument(source: string | undefined, commandName: string): asserts source is string {
  if (!source) throw new Error(`Usage: pi-package-catalog ${commandName} <package-source>`);
}

async function readJson(path: string, fallback?: unknown): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT" && fallback !== undefined) {
      return fallback;
    }
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON in ${path}: ${error.message}`);
    throw error;
  }
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function printHelp() {
  console.log(`Pi package catalog with machine-local resource choices

Usage:
  pi-package-catalog add <source>     Add a package to the shared catalog
  pi-package-catalog remove <source>  Remove a package from the shared catalog
  pi-package-catalog apply            Merge catalog and local choices into Pi settings
  pi-package-catalog config           Apply, run 'pi config', then capture local choices
  pi-package-catalog capture          Capture choices after running 'pi config' directly
  pi-package-catalog status           Show local package enablement

Shared: ${catalogPath}
Local:  ${localPath}
Pi:     ${settingsPath}`);
}

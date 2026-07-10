#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = join(root, "toolbox.json");
const localPath = join(root, "toolbox.local.json");
const agentDir = process.env.PI_CODING_AGENT_DIR
  ? resolve(expandHome(process.env.PI_CODING_AGENT_DIR))
  : join(homedir(), ".pi", "agent");
const settingsPath = join(agentDir, "settings.json");

const [command = "help", ...args] = process.argv.slice(2);

try {
  switch (command) {
    case "apply":
      await applyToolbox();
      break;
    case "capture":
      await captureSelection();
      break;
    case "config":
      await configureToolbox();
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
  console.error(`toolbox: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

async function applyToolbox() {
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

  console.log(`Applied ${catalog.packages.length} toolbox package(s) to ${settingsPath}`);
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

async function configureToolbox() {
  await applyToolbox();

  const result = spawnSync("pi", ["config"], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`pi config exited with status ${result.status ?? "unknown"}`);
  }

  await captureSelection();
  console.log("Local choices captured; toolbox.json was not changed");
}

async function showStatus() {
  const catalog = await readCatalog();
  const local = await readSelection();
  const localBySource = new Map(local.packages.map((entry) => [getSource(entry), entry]));

  if (catalog.packages.length === 0) {
    console.log("Toolbox catalog is empty");
    return;
  }

  for (const source of catalog.packages) {
    const entry = localBySource.get(source) ?? disabledPackage(source);
    console.log(`${isEnabled(entry) ? "enabled " : "disabled"}  ${source}`);
  }
}

async function addPackage(source) {
  assertSourceArgument(source, "add");
  const catalog = await readCatalog();
  if (catalog.packages.includes(source)) {
    console.log(`Already in toolbox: ${source}`);
    return;
  }

  catalog.packages.push(source);
  await writeJson(catalogPath, catalog);
  await applyToolbox();
  console.log(`Added to toolbox (disabled by default): ${source}`);
  console.log("Commit toolbox.json to share the catalog");
}

async function removePackage(source) {
  assertSourceArgument(source, "remove");
  const catalog = await readCatalog();
  if (!catalog.packages.includes(source)) {
    throw new Error(`Package is not in toolbox: ${source}`);
  }

  catalog.packages = catalog.packages.filter((entry) => entry !== source);
  await writeJson(catalogPath, catalog);
  await applyToolbox();
  console.log(`Removed from toolbox: ${source}`);
  console.log("Commit toolbox.json to share the catalog change");
}

async function readCatalog() {
  const value = await readJson(catalogPath);
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.packages)) {
    throw new Error(`Invalid toolbox catalog: ${catalogPath}`);
  }
  if (!value.packages.every((source) => typeof source === "string" && source.length > 0)) {
    throw new Error(`Toolbox catalog packages must be non-empty source strings: ${catalogPath}`);
  }
  if (new Set(value.packages).size !== value.packages.length) {
    throw new Error(`Toolbox catalog contains duplicate package sources: ${catalogPath}`);
  }
  return { version: 1, packages: [...value.packages] };
}

async function readSelection() {
  if (!existsSync(localPath)) return { version: 1, packages: [] };
  const value = await readJson(localPath);
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.packages)) {
    throw new Error(`Invalid local toolbox selection: ${localPath}`);
  }
  return {
    version: 1,
    packages: normalizePackageEntries(value.packages, localPath),
  };
}

async function writeSelection(packages) {
  await writeJson(localPath, { version: 1, packages });
}

function normalizePackageEntries(entries, sourcePath) {
  return entries.map((entry) => {
    if (typeof entry === "string" && entry.length > 0) return entry;
    if (isObject(entry) && typeof entry.source === "string" && entry.source.length > 0) {
      return structuredClone(entry);
    }
    throw new Error(`Invalid package entry in ${sourcePath}`);
  });
}

function assertSettings(value, sourcePath) {
  if (!isObject(value)) throw new Error(`Invalid settings object: ${sourcePath}`);
  if (value.packages !== undefined && !Array.isArray(value.packages)) {
    throw new Error(`Invalid packages setting: ${sourcePath}`);
  }
}

function disabledPackage(source) {
  return { source, autoload: false };
}

function getSource(entry) {
  return typeof entry === "string" ? entry : entry.source;
}

function clonePackageEntry(entry) {
  return typeof entry === "string" ? entry : structuredClone(entry);
}

function isEnabled(entry) {
  if (typeof entry === "string") return true;
  if (entry.autoload !== false) return true;
  return [entry.extensions, entry.skills, entry.prompts, entry.themes]
    .some((patterns) => Array.isArray(patterns) && patterns.length > 0);
}

function assertSourceArgument(source, commandName) {
  if (!source) throw new Error(`Usage: toolbox ${commandName} <package-source>`);
}

async function readJson(path, fallback) {
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

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function expandHome(path) {
  if (path === "~") return homedir();
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function printHelp() {
  console.log(`Pi toolbox catalog with machine-local resource choices

Usage:
  toolbox add <source>     Add a package to the shared catalog
  toolbox remove <source>  Remove a package from the shared catalog
  toolbox apply            Merge catalog and local choices into Pi settings
  toolbox config           Apply, run 'pi config', then capture local choices
  toolbox capture          Capture choices after running 'pi config' directly
  toolbox status           Show local package enablement

Shared: ${catalogPath}
Local:  ${localPath}
Pi:     ${settingsPath}`);
}

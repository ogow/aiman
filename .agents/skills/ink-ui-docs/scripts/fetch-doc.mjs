#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const docs = [
  ["readme", {label: "README", file: "README.md"}],
  ["alert", {label: "Alert", file: "alert.md"}],
  ["badge", {label: "Badge", file: "badge.md"}],
  ["confirm-input", {label: "ConfirmInput", file: "confirm-input.md"}],
  ["email-input", {label: "EmailInput", file: "email-input.md"}],
  ["multi-select", {label: "MultiSelect", file: "multi-select.md"}],
  ["ordered-list", {label: "OrderedList", file: "ordered-list.md"}],
  ["password-input", {label: "PasswordInput", file: "password-input.md"}],
  ["progress-bar", {label: "ProgressBar", file: "progress-bar.md"}],
  ["select", {label: "Select", file: "select.md"}],
  ["spinner", {label: "Spinner", file: "spinner.md"}],
  ["status-message", {label: "StatusMessage", file: "status-message.md"}],
  ["text-input", {label: "TextInput", file: "text-input.md"}],
  ["unordered-list", {label: "UnorderedList", file: "unordered-list.md"}],
];

const docsBySlug = new Map(docs);
const aliases = new Map();

for (const [slug, doc] of docs) {
  aliases.set(slug, slug);
  aliases.set(doc.label.toLowerCase(), slug);
  aliases.set(doc.label.replace(/[^a-z0-9]/gi, "").toLowerCase(), slug);
}

function printUsage() {
  console.error("Usage: node scripts/fetch-doc.mjs --list");
  console.error("   or: node scripts/fetch-doc.mjs <doc-name> [--save <path>]");
}

function normalizeName(value) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const kebab = trimmed
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
  const compact = trimmed.replace(/[^a-z0-9]/gi, "").toLowerCase();

  return aliases.get(kebab) ?? aliases.get(compact) ?? "";
}

async function writeOutput(content, outputPath) {
  const resolvedPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolvedPath), {recursive: true});
  await fs.writeFile(resolvedPath, content, "utf8");
  console.error(`Saved ${resolvedPath}`);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(scriptDir, "..", "references", "upstream-docs");

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  if (args.includes("--list")) {
    for (const [slug, doc] of docs) {
      console.log(`${slug}\t${doc.label}`);
    }
    return;
  }

  const saveIndex = args.indexOf("--save");
  let savePath;
  if (saveIndex !== -1) {
    savePath = args[saveIndex + 1];
    if (!savePath) {
      throw new Error("--save requires a path");
    }
    args.splice(saveIndex, 2);
  }

  const requestedName = args[0];
  const slug = normalizeName(requestedName);
  if (!slug) {
    throw new Error(`Unknown doc "${requestedName}". Use --list to see supported names.`);
  }

  const doc = docsBySlug.get(slug);
  const content = await fs.readFile(path.join(docsDir, doc.file), "utf8");
  if (savePath) {
    await writeOutput(content, savePath);
    return;
  }

  process.stdout.write(content);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});

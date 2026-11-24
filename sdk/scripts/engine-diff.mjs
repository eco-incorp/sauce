#!/usr/bin/env node
// Whether the engine of one releases.json row is the engine of another with only its fixed-Router
// constant changed (`scripts/lib/engine-diff.mjs`): the check that lets every dynamic Pot move to an
// engine built for a new Router.
//
//   node sdk/scripts/engine-diff.mjs \
//     --before 2.6.3=node_modules/.cache/sauce-engine-releases/v12-evm-v1.4.0/.report/runtime.creation.hex \
//     --after 2.6.4=node_modules/.cache/sauce-engine-releases/v12-evm-v<B>/.report/runtime.creation.hex
//
// The two files are what `sync-engine-artifacts --report <compiler>` downloads. Each is held to its
// row's pinned digest first (the sync's own hash of that asset), so a file the row does not pin is
// never compared. Prints `engine diff: <before> and <after> differ only in the fixed Router, at N
// site(s): <offsets>` and exits 0, or `engine diff: <problem>` and exits 1. Exits 2 on a bad
// invocation.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { hexToBytes, keccak256, toBytes } from "viem";

import { routerOnlyDiff } from "./lib/engine-diff.mjs";

const RELEASES_JSON = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "deployments",
  "releases.json",
);

const USAGE =
  "usage: node sdk/scripts/engine-diff.mjs --before <compiler>=<file> --after <compiler>=<file>";

function invocation(argv) {
  const given = {};
  for (let at = 0; at < argv.length; at += 2) {
    const flag = argv[at];
    const value = argv[at + 1];
    if ((flag !== "--before" && flag !== "--after") || value === undefined || flag in given) {
      return undefined;
    }
    const split = value.indexOf("=");
    if (split <= 0 || split === value.length - 1) return undefined;
    given[flag] = { compiler: value.slice(0, split), file: value.slice(split + 1) };
  }

  return given["--before"] && given["--after"]
    ? { before: given["--before"], after: given["--after"] }
    : undefined;
}

const stop = (message, code) => {
  console.error(message);
  process.exit(code);
};

const given = invocation(process.argv.slice(2));
if (given === undefined) stop(USAGE, 2);

const rows = JSON.parse(readFileSync(RELEASES_JSON, "utf8")).releases;

/** One side: the row of `compiler`, and its creation code once held to the row's digest. */
function side({ compiler, file }) {
  const row = rows.find((candidate) => candidate.compiler === compiler);
  const router = row?.["kitchen-evm"]?.fixedRouter;
  const digest = row?.["v12-evm"]?.assets?.["runtime.creation.hex"];
  if (typeof router !== "string" || typeof digest !== "string") {
    stop(
      `engine diff: releases.json's ${compiler} row has no fixedRouter and runtime.creation.hex digest`,
      1,
    );
  }
  const text = readFileSync(resolve(file), "utf8").trim();
  const actual = keccak256(toBytes(text));
  if (actual !== digest) {
    stop(`engine diff: ${file} hashes to ${actual}, not the ${compiler} row's pinned ${digest}`, 1);
  }

  return { engine: row["v12-evm"].engine, router, code: hexToBytes(text) };
}

const before = side(given.before);
const after = side(given.after);
const result = routerOnlyDiff(before.code, after.code, before.router, after.router);
if (!result.ok) stop(`engine diff: ${result.problem}`, 1);

console.log(
  `engine diff: ${before.engine} and ${after.engine} differ only in the fixed Router, at ` +
    `${result.sites.length} site(s): ${result.sites.join(", ")}`,
);

#!/usr/bin/env node
// The same compiles in Node and in a real browser, byte for byte.
//
//   node sdk/scripts/check-browser-compile.mjs [--package-root <dir>] [--consumer <dir>]
//
// `browser/cases.mjs` imports the package by name and compiles: the README's route example (read
// out of the README, as `docs:check` does), a raw `compile()` with `compactArgs` on both targets,
// the settle recipe through `resolveSdkModule`, a swap and a deposit builder, and an actions
// program. This script runs it in Node, then bundles it with esbuild for the browser, loads it into
// headless Chromium (Playwright) and requires the browser's results to equal Node's. The page runs
// three times, once per way `ready()` gets the wasm: resolved beside the bundle (what a bundler
// arranges), handed the bytes, and handed a URL. Each also checks that compiling BEFORE `ready()`
// fails with the SDK's own message.
//
// `--package-root` names the package (default: this repository) and `--consumer` the directory the
// package resolves from by name (default: the package root, through its self-reference).
// `check-packed-package.mjs` runs this against the installed tarball. Chromium comes from
// Playwright: `pnpm exec playwright-core install chromium` (CI adds `--with-deps`).
import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as esbuild from "esbuild";
import { chromium } from "playwright-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} requires a directory`);

  return resolve(value);
}

const packageRoot = realpathSync(argument("--package-root", REPO));
const consumer = realpathSync(argument("--consumer", packageRoot));

/** The README's TypeScript route example, as JavaScript that exports what it built. */
function readmeRoute() {
  const readme = readFileSync(join(packageRoot, "README.md"), "utf8");
  const fence = [...readme.matchAll(/```ts\n([^]*?)```/g)].map((match) => match[1]);
  const example = fence.find((code) => code.includes("Base.Portal"));
  assert.ok(example, "the README has no TypeScript `Base.Portal` route example");
  const { code } = esbuild.transformSync(example, { loader: "ts", format: "esm" });

  return `${code}\nexport { built };\n`;
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm" };

function serve(dir) {
  const server = createServer((request, response) => {
    const path = join(dir, new URL(request.url, "http://localhost").pathname);
    if (!path.startsWith(dir)) return response.writeHead(404).end();
    try {
      const body = readFileSync(path);
      response.writeHead(200, {
        "content-type": MIME[extname(path)] ?? "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });

  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

const work = mkdtempSync(join(consumer, ".sauce-browser-check-"));
let server;
let browser;
try {
  copyFileSync(join(HERE, "browser", "cases.mjs"), join(work, "cases.mjs"));
  writeFileSync(join(work, "readme-route.mjs"), readmeRoute());

  // ---- Node ---------------------------------------------------------------------------------
  const cases = await import(pathToFileURL(join(work, "cases.mjs")).href);
  const nodeBefore = cases.beforeReady();
  assert.deepEqual(
    nodeBefore,
    { compile: "compiled", route: "compiled" },
    "Node compiles without ready()",
  );
  const expected = await cases.run();

  // ---- the browser bundle -------------------------------------------------------------------
  writeFileSync(
    join(work, "page.mjs"),
    `import { beforeReady, run } from "./cases.mjs";
const mode = new URL(location.href).searchParams.get("source");
window.__sauce = (async () => {
  const before = beforeReady();
  const wasm = new URL("./sauce_wasm_bg.wasm", location.href);
  const source =
    mode === "bytes" ? await (await fetch(wasm)).arrayBuffer() : mode === "url" ? wasm : undefined;
  return { before, result: await run(source) };
})().catch((error) => ({ error: String((error && error.stack) || error) }));
`,
  );
  writeFileSync(
    join(work, "index.html"),
    '<!doctype html><meta charset="utf-8"><script type="module" src="./page.js"></script>',
  );
  const bundle = await esbuild.build({
    entryPoints: [join(work, "page.mjs")],
    outfile: join(work, "page.js"),
    absWorkingDir: consumer,
    bundle: true,
    platform: "browser",
    format: "esm",
    metafile: true,
    logLevel: "warning",
  });
  const inputs = Object.keys(bundle.metafile.inputs);
  const glue = inputs.find((path) => /sauce-compiler\/web\/sauce_wasm\.js$/.test(path));
  assert.ok(glue, "the browser bundle does not contain the compiler's web build");
  assert.ok(
    !inputs.some((path) => /sauce-compiler\/node\//.test(path)),
    "the browser bundle pulled in the compiler's Node build",
  );
  // What a bundler does with the glue's `new URL("sauce_wasm_bg.wasm", import.meta.url)`: the asset
  // lands beside the bundle.
  copyFileSync(
    join(resolve(consumer, dirname(glue)), "sauce_wasm_bg.wasm"),
    join(work, "sauce_wasm_bg.wasm"),
  );
  const bundleBytes = readFileSync(join(work, "page.js")).length;

  // ---- headless Chromium --------------------------------------------------------------------
  server = await serve(work);
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  let notReady;
  for (const mode of ["default", "bytes", "url"]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(`${origin}/index.html?source=${mode}`);
    await page.waitForFunction(() => globalThis.__sauce !== undefined, undefined, {
      timeout: 120_000,
    });
    const outcome = await page.evaluate(() => globalThis.__sauce);
    assert.deepEqual(errors, [], `page errors (${mode})`);
    assert.equal(outcome.error, undefined, `the browser run failed (${mode}): ${outcome.error}`);
    for (const [name, message] of Object.entries(outcome.before)) {
      assert.match(message, /await ready\(\)/, `a ${name} before ready() (${mode})`);
    }
    notReady ??= outcome.before.compile;
    assert.deepEqual(outcome.result, expected, `browser compiles differ from Node's (${mode})`);
    await page.close();
  }

  console.log(
    `check-browser-compile: headless Chromium ${browser.version()} compiled the same bytes as Node ` +
      `${process.version}, with ready() given no source, the bytes and a URL ` +
      `(${(bundleBytes / 1e6).toFixed(1)} MB bundle):\n` +
      `  README route  ${expected.readme.bytecode[0].length / 2} bytes, intent ${expected.readme.intentHash}\n` +
      `  settle        ${expected.settle.length / 2} bytes\n` +
      `  swap/deposit  ${expected.swap[0].length / 2} / ${expected.deposit[0].length / 2} bytes\n` +
      `  compact       evm ${expected.raw.evm.bytecode.length / 2}, svm ${expected.raw.svm.bytecode.length / 2} bytes\n` +
      `  actions       ${expected.action.length / 2} bytes; by names on base ${expected.actionNamed.length / 2} bytes\n` +
      `  before ready() a compile throws: ${notReady}`,
  );
} finally {
  await browser?.close();
  server?.close();
  rmSync(work, { recursive: true, force: true });
}

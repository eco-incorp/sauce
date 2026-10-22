#!/usr/bin/env node
// Exercise the published entry points from a clean consumer, without workspace
// dependencies or a separately installed compiler hiding a broken bundle.
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { documentedExports } from "../../actions/scripts/documented-exports.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Taken from the SDK's own devDependency rather than written out here, so this consumer typechecks
// the shipped examples against the same typings the repo builds them with and a bump moves both.
const TYPES_NODE_VERSION = JSON.parse(readFileSync(resolve(root, "sdk/package.json"), "utf8"))
  .devDependencies["@types/node"];
// The package needs no TypeScript at run time, and depends on none: a consumer that typechecks
// installs its own, as the project `sauce init` writes does, at the range the package is built with
// (its devDependency), which is the one this consumer takes.
const TYPESCRIPT_VERSION = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))
  .devDependencies.typescript;
// What only the `sauce` command loads, for one command each: optional peer dependencies, which no
// install of the package brings. The command takes the user's own copies at the versions pinned,
// else installs them for itself into ~/.sauce/runtime/<version> (`sdk/src/cli/optional.ts`).
const RUNTIME = ["@modelcontextprotocol/sdk", "litesvm", "zod"];
// What a plain install of the package never brings: those, the web servers the MCP SDK brings, and
// TypeScript and dotenv, which it once depended on and nothing of it imports.
const NEVER_IN_A_LIBRARY_INSTALL = [...RUNTIME, "express", "hono", "typescript", "dotenv"];
// The Solana packages a project writing Solana code installs itself — Kit and the program clients
// for the System and Token programs — at the ranges the package depends on them by: the current
// majors, so a project on today's Kit shares the package's one copy.
const SOLANA_PROJECT = ["@solana/kit", "@solana-program/system", "@solana-program/token"].map(
  (dependency) =>
    `${dependency}@${JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).dependencies[dependency]}`,
);
// The runtime packages' own install, as the package ships it: the versions it pins.
const RUNTIME_PINS = JSON.parse(
  readFileSync(resolve(root, "sdk/runtime/package.json"), "utf8"),
).dependencies;
// The SVM engine binaries ship only when a `--fetch-v12-engines` sync has placed them (CI does; a
// bare local checkout may not). Assert they resolve from the clean install when they are here, and
// skip that check otherwise rather than failing a credential-less local run.
const shipsEngine = existsSync(join(root, "sdk/dist/artifacts/svm/engine-devnet.so"));
// The deployed addresses (V12Deployments.json) come from the always-run sync, but that still needs the
// private-repo credential to fetch each addresses.json — so a credential-less local checkout may lack
// them too. Same treatment as the engine binaries: verify from the clean install when present.
const shipsAddresses = existsSync(join(root, "sdk/dist/artifacts/V12Deployments.json"));
// A silent skip is the trap: a maintainer running this locally to "verify the package" would get a
// green that never checked the shipped binaries. In CI the engine fetch always precedes this, so an
// absent binary there is a real failure, not a skip; locally, say loudly which half ran.
if (!shipsEngine) {
  if (process.env.CI)
    throw new Error(
      "check-packed: sdk/dist/artifacts/svm/engine-devnet.so is missing in CI — the " +
        "`--fetch-v12-engines` sync must run before this step so the packaged-engine check is not skipped.",
    );
  console.warn(
    "\n⚠️  check-packed: no SVM engine binaries in this tree — the compiler/codec exports will be " +
      "verified but the shipped-engine check is SKIPPED. Run `pnpm --filter './sdk' sync-engine-artifacts " +
      "--fetch-v12-engines` first to exercise it.\n",
  );
}
if (!shipsAddresses) {
  if (process.env.CI)
    throw new Error(
      "check-packed: sdk/dist/artifacts/V12Deployments.json is missing in CI — the sync must run (with " +
        "the private-repo token) before this step so the deployed-addresses export check is not skipped.",
    );
  console.warn(
    "\n⚠️  check-packed: no deployed addresses in this tree — the ./deployments export check is SKIPPED. " +
      "Run `pnpm --filter './sdk' sync-engine-artifacts` (with credentials) first to exercise it.\n",
  );
}
const work = mkdtempSync(join(tmpdir(), "sauce-package-check-"));
// A library install of the same tarball, a plain `npm install` of it and nothing else: outside
// `work`, so nothing installed there resolves from it.
const library = mkdtempSync(join(tmpdir(), "sauce-library-install-"));
// The homes every `sauce` this check runs is given, one per state of ~/.sauce/runtime it needs, so
// the check never writes the developer's own; npm keeps its cache where it is.
const homes = mkdtempSync(join(tmpdir(), "sauce-homes-"));
const home = (name) => {
  const dir = join(homes, name);
  mkdirSync(dir);

  return dir;
};
const npmCache = execFileSync("npm", ["config", "get", "cache"], { encoding: "utf8" }).trim();
/** The packages an install put on disk (its lockfile's, where each landed) and their bytes. */
const installedSize = (dir) => {
  const lock = JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8"));
  const packages = Object.keys(lock.packages).filter(
    (path) => path !== "" && existsSync(join(dir, path, "package.json")),
  ).length;
  const bytes = readdirSync(join(dir, "node_modules"), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .reduce((sum, entry) => sum + statSync(join(entry.parentPath, entry.name)).size, 0);

  return { packages, bytes, text: `${packages} packages, ${(bytes / 2 ** 20).toFixed(1)} MiB` };
};
try {
  const output = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", work],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const [{ filename }] = JSON.parse(output);
  writeFileSync(join(work, "package.json"), JSON.stringify({ private: true, type: "module" }));
  execFileSync(
    "npm",
    [
      "install",
      "--engine-strict",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      join(work, filename),
      // Node typings, because the shipped examples are Node programs: `docs/examples`'s
      // `router-swap.ts` reads its SauceScript sibling off disk, which is the property that
      // keeps the README and the compiled file from drifting. A real consumer typechecking a Node
      // example has these -- the package declares Node >= 24.
      //
      // This cannot weaken the check. `@types/node` ships no runtime code, so it cannot stand in
      // for anything missing from the tarball; a broken bundle still fails here exactly as before.
      `@types/node@${TYPES_NODE_VERSION}`,
      // And the consumer's own TypeScript, which typechecks the examples below and serves the
      // editor on the project `sauce init` writes: no module of the package imports it.
      `typescript@${TYPESCRIPT_VERSION}`,
    ],
    {
      cwd: work,
      stdio: "inherit",
    },
  );
  const name = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name;
  const installedRoot = join(work, "node_modules", name);
  const installedManifest = JSON.parse(readFileSync(join(installedRoot, "package.json"), "utf8"));
  execFileSync(
    process.execPath,
    [join(root, "docs/scripts/check-docs.mjs"), "--package-root", installedRoot],
    { cwd: work, stdio: "inherit" },
  );
  assert.equal(installedManifest.license, "SEE LICENSE IN LICENSE.md");
  assert.equal(
    readFileSync(join(installedRoot, "LICENSE.md"), "utf8"),
    readFileSync(join(root, "LICENSE.md"), "utf8"),
    "the installed package must ship the repository license verbatim",
  );
  console.log("Clean package install: license metadata and full license text ship");

  // What a library import loads is a dependency; what only the `sauce` command loads, for one
  // command each, is an optional peer of any version, which no install brings and no project's own
  // version conflicts with (the mismatched MCP SDK below installs beside it).
  assert.equal(installedManifest.optionalDependencies, undefined);
  for (const each of RUNTIME) {
    assert.equal(installedManifest.peerDependencies[each], "*");
    assert.deepEqual(installedManifest.peerDependenciesMeta[each], { optional: true });
  }
  for (const each of NEVER_IN_A_LIBRARY_INSTALL) {
    assert.equal(installedManifest.dependencies[each], undefined, `${each} is not a dependency`);
  }
  writeFileSync(join(library, "package.json"), JSON.stringify({ private: true, type: "module" }));
  execFileSync(
    "npm",
    [
      "install",
      "--engine-strict",
      "--ignore-scripts",
      "--prefer-offline",
      "--no-audit",
      "--no-fund",
      join(work, filename),
    ],
    { cwd: library, stdio: "inherit" },
  );
  for (const each of NEVER_IN_A_LIBRARY_INSTALL) {
    assert.ok(!existsSync(join(library, "node_modules", each)), `a plain install has no ${each}`);
    if (each !== "typescript") {
      assert.ok(!existsSync(join(work, "node_modules", each)), `nor does the consumer's: ${each}`);
    }
  }
  // Every export of the package loads there, a protocol's for each protocol, and each works.
  const librarySubpaths = Object.entries(installedManifest.exports).flatMap(([key, value]) => {
    const target = typeof value === "string" ? value : value.default;
    if (target === undefined || !target.endsWith(".js")) return [];
    if (!key.includes("*")) return [key];
    const [before, after] = target.split("*");

    return readdirSync(join(installedRoot, before))
      .filter((dir) => existsSync(join(installedRoot, before, dir + after)))
      .map((dir) => key.replace("*", dir));
  });
  assert.ok(
    librarySubpaths.includes("./protocols/uniswap-v3"),
    "the protocols' exports are listed",
  );
  writeFileSync(
    join(library, "library.mjs"),
    `
    import assert from 'node:assert/strict';
    for (const subpath of ${JSON.stringify(librarySubpaths)}) {
      await import(subpath === '.' ? '${name}' : '${name}' + subpath.slice(1));
    }
    const { Base } = await import('${name}');
    assert.equal(Base.chain.id, 8453);
    const { compile } = await import('${name}/compiler');
    const source = new TextEncoder().encode('function main(x: Uint256): Uint256 { return x + 1; }');
    assert.ok(compile({ target: 'evm', resolve: () => source }).bytecode.length > 0);
    const { chainBySlug } = await import('${name}/chains');
    assert.equal(chainBySlug('solana').kind, 'svm');
    const { protocolInfo, deployments } = await import('${name}/protocols/uniswap-v3');
    assert.ok(protocolInfo && Object.keys(deployments).length > 0);
    const actions = await import('${name}/actions');
    const program = actions.parseProgram({
      version: 1,
      chainId: 1,
      actions: [{ type: 'approve', amount: '1', token: '0x1000000000000000000000000000000000000001', spender: '0x2000000000000000000000000000000000000001' }],
    });
    assert.ok(actions.compileProgram(program).bytecode.length > 0);
    ${
      shipsAddresses
        ? `const { v12KitchenAddress } = await import('${name}/deployments');
    assert.match(v12KitchenAddress(), /^0x[0-9a-fA-F]{40}$/);`
        : ""
    }
  `,
  );
  execFileSync(process.execPath, [join(library, "library.mjs")], {
    cwd: library,
    stdio: "inherit",
  });
  console.log(
    `Clean package install: a plain npm install is ${installedSize(library).text}, with no ` +
      `${NEVER_IN_A_LIBRARY_INSTALL.join(", ")}, and every one of its ${librarySubpaths.length} ` +
      "exports loads and works",
  );

  // Public consumers cannot rely on this private repository. Verify the actual
  // tarball includes the complete manual and all of its local navigation targets.
  const manualFiles = readdirSync(join(root, "docs"), { recursive: true }).filter(
    (file) => !file.startsWith("scripts/") && /\.(md|ts)$/.test(file),
  );
  for (const file of manualFiles) {
    const installed = join(installedRoot, "docs", file);
    const content = readFileSync(installed, "utf8");
    assert.ok(
      content === readFileSync(join(root, "docs", file), "utf8"),
      `Packaged manual differs from the working tree: ${file}`,
    );
  }
  console.log(
    `Clean package install: all ${manualFiles.length} manual/example files ship verbatim`,
  );

  // Every export the actions pages name — read by the same module `actions/tests/docs.unit.test.ts`
  // holds `src/index.ts` to, so there is no list here to drift — must be one the PACKED `./actions`
  // declares. The installed declarations then split them: each runtime value must resolve from the
  // subpath when imported (smoke.mjs), and every name must typecheck from it (actions-exports.ts).
  const documented = documentedExports(root);
  const ts = createRequire(join(work, "package.json"))("typescript");
  const actionsDeclarations = join(installedRoot, installedManifest.exports["./actions"].types);
  const declarations = ts.createProgram([actionsDeclarations], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = declarations.getTypeChecker();
  const actionsModule = checker.getSymbolAtLocation(
    declarations.getSourceFile(actionsDeclarations),
  );
  assert.ok(actionsModule, `${actionsDeclarations} did not resolve as a module`);
  const isValue = new Map(
    checker.getExportsOfModule(actionsModule).map((symbol) => {
      const target =
        symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      return [symbol.name, (target.flags & ts.SymbolFlags.Value) !== 0];
    }),
  );
  assert.deepEqual(
    documented.filter((export_) => !isValue.has(export_)),
    [],
    `exports the actions pages name that the packed ${name}/actions does not declare`,
  );
  const actionValues = documented.filter((export_) => isValue.get(export_));
  const actionTypes = documented.filter((export_) => !isValue.get(export_));
  assert.ok(actionValues.length > 0, "the actions pages name no runtime export");
  assert.ok(actionTypes.length > 0, "the actions pages name no type export");
  console.log(
    `Clean package install: ./actions declares all ${documented.length} exports its pages name ` +
      `(${actionValues.length} runtime, ${actionTypes.length} type-only)`,
  );

  writeFileSync(
    join(work, "smoke.mjs"),
    `
    import assert from 'node:assert/strict';
    import { createHash } from 'node:crypto';
    import { existsSync, readFileSync } from 'node:fs';
    import { dirname, join, resolve } from 'node:path';
    import { fileURLToPath } from 'node:url';
    import { keccak256 } from 'viem';
    import { compile, encodeCompactArguments, decodeCompactArguments, resolveSdkModule } from '${name}/compiler';
    import { settleSource } from '${name}/recipes';
    import { SETTLE_PROGRAM, SETTLE_WIRE } from '${name}/verify';
    const source = new TextEncoder().encode('function main(x: Uint256): Uint256 { return x + 1; }');
    for (const target of ['evm', 'svm']) {
      const a = compile({ target, compactArgs: true, resolve: () => source });
      assert.equal(a.isaRevision, 'stack-compact-v2');
      assert.equal(a.entryEncoding, 'compact-v1');
      const data = encodeCompactArguments(a.entrySchema, [7n]);
      assert.deepEqual(decodeCompactArguments(a.entrySchema, data), [7n]);
      assert.throws(() => decodeCompactArguments(a.entrySchema, data.slice(0, -1)));
    }
    console.log('Clean package install: the compact compiler and codec resolve and round-trip');

    // The settle recipe, compiled the way ./recipes documents it to partners, from the shipped
    // source and the shipped IERC20 artifact. A pin the tarball cannot reproduce rejects every
    // settle a consumer builds, so this is checked here and not only against src/.
    const settleText = new TextEncoder().encode(settleSource());
    const { bytecode: settle } = compile({
      target: 'evm',
      entry: 'settle.sauce.ts',
      resolve: (path) => (path === 'settle.sauce.ts' ? settleText : resolveSdkModule(path)),
    });
    // The embedded source is the shipped asset, byte for byte.
    const settleAsset = fileURLToPath(import.meta.resolve('${name}/recipes/settle.sauce.ts'));
    assert.equal(settleSource(), readFileSync(settleAsset, 'utf8'), 'settleSource() is the shipped settle.sauce.ts');
    assert.equal(settle.length, SETTLE_WIRE.PROGRAM_BYTES, 'settle program length matches its pin');
    assert.equal(keccak256(settle), SETTLE_WIRE.PROGRAM_HASH, 'settle program hash matches its pin');
    assert.equal('0x' + Buffer.from(settle).toString('hex'), SETTLE_PROGRAM, 'settle program bytes match SETTLE_PROGRAM');
    console.log('Clean package install: the shipped settle recipe compiles to its pin (' + settle.length + ' bytes, ' + SETTLE_WIRE.PROGRAM_HASH + ')');

    // @sauce/router's Solana account orders ship through ./svm, for a code generator to import at
    // codegen time (eco-incorp/sauce-recipes' does) rather than keep its own copy.
    const { routerSvmAccounts, routerSvmDataTemplate, ROUTER_SVM_VENUES } = await import('${name}/svm');
    const defituna = ['tokenProgramA', 'tokenProgramB', 'memo', 'authority', 'pool', 'mintA', 'mintB',
      'source', 'recipient', 'vaultA', 'vaultB', 'tickArray0', 'tickArray1', 'tickArray2'];
    const listed = routerSvmAccounts('defituna', { aToB: true },
      Object.fromEntries(defituna.map((role) => [role, role])));
    assert.deepEqual(listed.map((account) => account.ref), defituna, 'routerSvmAccounts orders DefiTuna');
    assert.equal(ROUTER_SVM_VENUES.defituna.data, 'defitunaData');
    const written = routerSvmDataTemplate('defituna', { aToB: true, minOut: 1n });
    assert.equal(Buffer.from(written.prefix).toString('hex'), 'f8c69e91e17587c8', 'routerSvmDataTemplate writes DefiTuna');
    console.log('Clean package install: the Solana router account orders and data templates resolve through ./svm');
    ${
      shipsEngine
        ? `
    // The gated SVM engine + kitchen must ship in the package (eco-incorp/v12 is private, so this is
    // the only way a consumer gets them) and resolve from the install with no SAUCE_* env set.
    const { svmEnginePath, svmKitchenPath } = await import('${name}/svm/engine-artifacts');
    for (const p of [svmEnginePath('devnet'), svmEnginePath('mainnet'), svmKitchenPath()]) {
      const bytes = readFileSync(p);
      assert.ok(bytes.length > 1024, 'shipped SVM binary present and non-trivial: ' + p);
      assert.deepEqual([...bytes.subarray(0, 4)], [0x7f, 0x45, 0x4c, 0x46], 'a real ELF, not a stub: ' + p);
    }
    console.log('Clean package install: the gated SVM engine + kitchen binaries ship and resolve');`
        : `console.log('Clean package install: SVM engine binaries not in this tree (no --fetch-v12-engines) — skipped');`
    }
    ${
      shipsAddresses
        ? `
    // The deployed addresses must ship and resolve through the ./deployments export from a clean install.
    const dep = await import('${name}/deployments');
    assert.match(dep.v12EngineAddress(), /^0x[0-9a-fA-F]{40}$/, 'evm engine address resolves');
    assert.match(dep.v12KitchenAddress(), /^0x[0-9a-fA-F]{40}$/, 'evm kitchen address resolves');
    assert.match(dep.v12SvmEngineProgramId(), /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'svm engine program id resolves');
    assert.match(dep.v12SvmKitchenProgramId(), /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'svm kitchen program id resolves');
    assert.ok(dep.v12PotDerivation().initCodeHash, 'pot derivation resolves');
    console.log('Clean package install: the deployed addresses ship and resolve through ./deployments');`
        : `console.log('Clean package install: deployed addresses not in this tree (no credential to fetch addresses.json) — skipped');`
    }
    // The actions subpath reads the SDK's registry through a RELATIVE path into sdk/dist, and only a
    // clean install of the tarball proves that path exists in the published layout.
    const actions = await import('${name}/actions');
    const program = actions.parseProgram({
      version: 1,
      chainId: 1,
      actions: [{ type: 'approve', amount: '1', token: '0x1000000000000000000000000000000000000001', spender: '0x2000000000000000000000000000000000000001' }],
    });
    assert.ok(actions.compileProgram(program).bytecode.length > 0, 'an action program compiles');
    const { createRequire } = await import('node:module');
    const schemaPath = createRequire(import.meta.url).resolve('${name}/actions/action-program.schema.json');
    assert.deepEqual(JSON.parse(readFileSync(schemaPath, 'utf8')), JSON.parse(JSON.stringify(actions.programSchema())));
    console.log('Clean package install: actions compile, and the shipped JSON Schema matches the parser');
    const documentedValues = ${JSON.stringify(actionValues)};
    for (const export_ of documentedValues) {
      assert.notEqual(typeof actions[export_], 'undefined', export_ + ' does not resolve from ${name}/actions');
    }
    console.log('Clean package install: ./actions resolves every runtime export its pages name: ' + documentedValues.join(', '));
    // The testing kit reaches sdk/dist by a RELATIVE path and spawns its recorder from beside
    // itself: an import proves the first, and a cook on an anvil the stack it reads from the
    // packaged artifacts.
    const testing = await import('${name}/testing');
    assert.equal(typeof testing.fork, 'function', 'fork resolves from ${name}/testing');
    assert.ok(existsSync(fileURLToPath(new URL('./recorder.mjs', import.meta.resolve('${name}/testing')))), 'the recorder ships beside the testing kit');
    const { execFileSync } = await import('node:child_process');
    let anvil = true;
    try { execFileSync('anvil', ['--version'], { stdio: 'ignore' }); } catch { anvil = false; }
    if (anvil && ${shipsAddresses}) {
      const chain = await testing.local();
      try {
        const result = await chain.run({ source: 'function main(a: Uint256): Uint256 {\\n  return a * 2;\\n}\\n' }, { args: [21n] });
        assert.equal(result.returned, 42n, 'a program cooks on the testing kit from a clean install');
      } finally {
        await chain.stop();
      }
      console.log('Clean package install: ./testing runs a program on a local chain with the packaged stack');
    } else {
      console.log('Clean package install: ./testing resolves (no anvil, or no engine artifacts, to run it here)');
    }
    // Solana runs in the project's own LiteSVM, which no install of the package brings: the kit
    // names what to install.
    await assert.rejects(
      testing.local({ chain: 'solana' }),
      /this project does not have: npm i -D litesvm@${RUNTIME_PINS.litesvm}/,
    );
    console.log('Clean package install: ./testing on Solana names the LiteSVM to install');
  `,
  );
  // Force the packaged path: the resolvers read no environment, and scrubbing CI's SAUCE_* paths
  // keeps this smoke proving the shipped binary resolves (what a credential-less consumer sees) even
  // if an env read ever crept back in.
  // And a home of its own: a `sauce` that installs its runtime packages does so there.
  const smokeEnv = { ...process.env, HOME: home("default"), npm_config_cache: npmCache };
  for (const k of [
    "SAUCE_ENGINE_SO",
    "SAUCE_RUST_ENGINE_SO",
    "SAUCE_RUST_ENGINE_MAINNET_SO",
    "SAUCE_KITCHEN_SO",
    "SAUCE_KITCHEN_IDL_JSON",
  ])
    delete smokeEnv[k];
  execFileSync(process.execPath, [join(work, "smoke.mjs")], {
    cwd: work,
    stdio: "inherit",
    env: smokeEnv,
  });
  // Check emitted declarations from a real install, not src/. Bare source globals and builtins
  // must survive declaration emit and the root package's side-effect import.
  // USDC and Uniswap are SauceScript globals the compiler resolves in a program — declared types
  // with no runtime value, so importing them would be wrong. A typed closure checks against them.
  // This fixture is the packaged surface a consumer actually gets.
  const consumer = `
    import { routes } from '${name}';
    import { compileProgram, parseProgram, type ActionProgram } from '${name}/actions';
    const owner = '0x3333333333333333333333333333333333333333' as const;
    const typed = routes.compileSauceProgram('base', routes.sauceBodyToSource(() => {
      USDC.approve(Uniswap.UniversalRouter, 1000000n);
      // The language's builtins are declared for a typed closure too (builtins.generated.ts).
      require(ctx.timestamp() > 0n, "stale");
      log(crypto.keccak256(hex\`01\`).toBytesBe(32n));
    }));
    if (typed.bytecode.length === 0) throw new Error('Empty program');
    // The actions declarations reference the SDK's by relative path; this checks they resolve.
    const program: ActionProgram = parseProgram({ version: 1, chainId: 8453, actions: [
      { type: 'approve', amount: '1', token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', spender: owner },
    ] });
    if (compileProgram(program).bytecode.length === 0) throw new Error('Empty action program');
  `;
  writeFileSync(join(work, "consumer.ts"), consumer);
  // Every export the actions pages name, typechecked from the installed package: the runtime ones as
  // values, the rest as types. A name the declarations stop exporting fails the compile below.
  writeFileSync(
    join(work, "actions-exports.ts"),
    `
    import { ${actionValues.join(", ")} } from '${name}/actions';
    import type { ${actionTypes.join(", ")} } from '${name}/actions';
    export const values = [${actionValues.join(", ")}] as const;
    export type Types = [${actionTypes.join(", ")}];
  `,
  );
  // A signature over what a cook returns, typed by the testing kit's own exports: each must resolve
  // through the installed declarations to its real type, not to an unresolved `any`.
  writeFileSync(
    join(work, "testing-exports.ts"),
    `
    import type { CookResult, Effects, Movement } from '${name}/testing';
    type IsAny<T> = 0 extends 1 & T ? true : false;
    export const resolved: [IsAny<CookResult>, IsAny<Effects>, IsAny<Movement>] = [false, false, false];
    export const transfers = (result: CookResult): readonly Movement[] => result.transfers;
    export const effects = (result: CookResult): Effects => result.effects;
  `,
  );
  execFileSync(
    process.execPath,
    [
      join(work, "node_modules/typescript/bin/tsc"),
      join(work, "consumer.ts"),
      join(work, "actions-exports.ts"),
      join(work, "testing-exports.ts"),
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--strict",
      "--skipLibCheck",
      "--outDir",
      join(work, "compiled"),
    ],
    { cwd: work, stdio: "inherit" },
  );
  execFileSync(process.execPath, [join(work, "compiled/consumer.js")], {
    cwd: work,
    stdio: "inherit",
    env: smokeEnv,
  });
  console.log(
    "Clean package install: typed token/protocol closure compiles through the public API",
  );
  console.log(
    `Clean package install: all ${documented.length} exports the actions pages name typecheck ` +
      `from ./actions, the type-only ones being ${actionTypes.join(", ")}`,
  );
  console.log("Clean package install: ./testing's CookResult, Effects and Movement types resolve");

  // The `sauce` bin, run the way a consumer runs it — through npx, from the install, with nothing
  // but the tarball's files. It compiles the example its own agent skill ships, builds the Pot and
  // the transaction, and scaffolds a project whose skills then report up to date. Each run passes
  // --no-update-check, so none starts a refresh that would read the npm registry.
  const sauce = (...args) =>
    execFileSync("npx", ["--no", "--", "sauce", "--no-update-check", ...args], {
      cwd: work,
      encoding: "utf8",
      env: smokeEnv,
    });
  assert.equal(
    execFileSync("npx", ["--no", "--", name, "--no-update-check", "--version"], {
      cwd: work,
      encoding: "utf8",
      env: smokeEnv,
    }),
    `${name} ${installedManifest.version}\n`,
    `npx ${name} runs the package's sauce bin`,
  );
  // The update check, from the install: a fresh cache in a home of its own naming a newer version
  // is noticed on stderr, after stdout's own output, and starts no refresh (the cache is a minute
  // old), so nothing reads the registry. The refresh's script ships beside the bin.
  assert.ok(
    existsSync(join(installedRoot, "sdk/dist/cli/update-refresh.js")),
    "the update check's refresh script ships",
  );
  {
    const updateHome = home("update-check");
    const cache = join(updateHome, ".sauce", "update-check.json");
    mkdirSync(dirname(cache), { recursive: true, mode: 0o700 });
    const fresh = JSON.stringify({
      checkedAt: new Date(Date.now() - 60_000).toISOString(),
      latest: "999.0.0",
      version: installedManifest.version,
    });
    writeFileSync(cache, fresh, { mode: 0o600 });
    const ran = spawnSync("npx", ["--no", "--", "sauce", "--version"], {
      cwd: work,
      encoding: "utf8",
      env: { ...smokeEnv, HOME: updateHome, USERPROFILE: updateHome },
    });
    assert.equal(ran.stdout, `${name} ${installedManifest.version}\n`);
    assert.equal(
      ran.stderr,
      `sauce ${installedManifest.version} → 999.0.0 is available: run \`sauce update\`\n`,
      "the installed sauce notices a newer version from its cache",
    );
    assert.equal(readFileSync(cache, "utf8"), fresh, "a fresh cache starts no refresh");
  }
  console.log("Clean package install: sauce notices a newer version from its update cache");
  // The skill's `buy.sauce.ts` names no chain, starts with a `#!` line, imports `@sauce/router`
  // and takes `main(token, budget, sqrtPriceLimitX96, minOut, recipient)` at run time.
  // `--offline`: the bin reads a chain through its built-in public endpoints otherwise, and this
  // check reaches no network.
  const example = join(installedRoot, "skills/sauce-cli/examples/buy.sauce.ts");
  const recipient = "0x6666666666666666666666666666666666666666";
  const owner = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  const chain = ["--chain", "base"];
  const args = [
    "--args",
    "0x4200000000000000000000000000000000000006",
    "100000000",
    "4116816085950893928074568",
    "37000000000000000",
    recipient,
  ];
  const bytecode = sauce("compile", example, ...chain).trim();
  assert.match(bytecode, /^0x[0-9a-f]+$/, "sauce compile prints the program as hex");
  const compiled = JSON.parse(sauce("compile", example, ...chain, "--json"));
  const installedCompiler = JSON.parse(
    readFileSync(join(work, "node_modules/sauce-compiler/package.json"), "utf8"),
  );
  assert.equal(compiled.bytecode, bytecode);
  assert.equal(compiled.chain, "base", "--chain chose the chain");
  assert.deepEqual(
    compiled.entryParams.map((param) => param.name),
    ["token", "budget", "sqrtPriceLimitX96", "minOut", "recipient"],
    "main's parameters, as --args takes them",
  );
  assert.equal(compiled.compiler.version, installedCompiler.version);
  assert.equal(compiled.engine.release, "v12-evm");
  const pot = JSON.parse(sauce("pot", "--owner", owner, "--chain", "base", "--offline"));
  assert.equal(pot.to, pot.kitchen, "sauce pot prints the Kitchen.deployPot transaction");
  const tx = JSON.parse(
    sauce("tx", example, ...chain, "--owner", owner, "--value", "0", "--offline", ...args),
  );
  assert.deepEqual(
    Object.keys(tx),
    ["chainId", "to", "data", "value", "sendCalls"],
    "sauce tx prints the tx, and the batch a wallet's send_calls takes",
  );
  assert.equal(tx.value, "0x0", "its value a hex quantity, as a wallet's send tool takes it");
  assert.deepEqual(
    tx.sendCalls,
    { chain: "base", calls: [{ to: tx.to, value: tx.value, data: tx.data }] },
    "the batch is the one transaction",
  );
  assert.equal(tx.to, pot.pot, "sauce tx cooks on the Pot sauce pot predicts");
  assert.ok(tx.data.includes(bytecode.slice(2)), "the cook carries the compiled program");
  assert.ok(tx.data.includes(recipient.slice(2)), "and main's arguments after it");
  assert.equal(
    sauce(
      "tx",
      example,
      ...chain,
      "--owner",
      owner,
      "--value",
      "0",
      "--offline",
      "--format",
      "cast",
      ...args,
    ),
    `cast send ${tx.to} ${tx.data} --value 0 --rpc-url <RPC_URL> --private-key <PRIVATE_KEY>\n`,
  );
  console.log(
    `Clean package install: the sauce bin compiles the shipped example (${compiled.size} bytes) ` +
      `and builds its Pot and cook transactions`,
  );

  // The plain install runs every command that builds: none of them needs a runtime package.
  const librarySauce = (...args) =>
    execFileSync("npx", ["--no", "--", "sauce", "--no-update-check", ...args], {
      cwd: library,
      encoding: "utf8",
      env: smokeEnv,
    });
  assert.equal(librarySauce("compile", example, ...chain).trim(), bytecode);
  assert.deepEqual(
    JSON.parse(
      librarySauce("tx", example, ...chain, "--owner", owner, "--value", "0", "--offline", ...args),
    ),
    tx,
  );
  const libraryGlobals = JSON.parse(librarySauce("globals", "--chain", "base", "--json"));
  assert.equal(libraryGlobals.chain.id, 8453);
  assert.ok(libraryGlobals.tokens.some((token) => token.symbol === "USDC"));
  assert.ok(!existsSync(join(smokeEnv.HOME, ".sauce")), "and installs nothing for itself");
  console.log(
    "Clean package install: a plain install's sauce compile, tx and globals print what the " +
      "consumer's do, and install nothing",
  );
  // `sauce`, run by this Node.js with no npx in between, so PATH can lack npm.
  const bin = join(installedRoot, installedManifest.bin.sauce);
  const runtimeOf = (dir) => join(dir, ".sauce", "runtime", installedManifest.version);
  // A command that cannot have its runtime packages ends on one line that says why: exit 1, nothing
  // on stdout, never a stack trace, and nothing half-installed.
  const refusal = ({ status, stdout, stderr }, what, homeDir) => {
    assert.equal(status, 1, `${what} exits 1: ${stderr}`);
    assert.equal(stdout, "", `${what} prints nothing on stdout`);
    assert.doesNotMatch(stderr, /^\s+at /m, `${what} prints no stack trace`);
    const runtimeRoot = dirname(runtimeOf(homeDir));
    assert.deepEqual(
      existsSync(runtimeRoot) ? readdirSync(runtimeRoot) : [],
      [],
      `${what} leaves nothing in ${runtimeRoot}`,
    );

    return stderr.trimEnd().split("\n").at(-1);
  };
  const needsMcp =
    `the MCP server needs @modelcontextprotocol/sdk ${RUNTIME_PINS["@modelcontextprotocol/sdk"]} ` +
    `and zod ${RUNTIME_PINS.zod}, not installed for this sauce yet`;

  // A Solana cook rehearsed in the local copy from the tarball alone: no install brings LiteSVM, so
  // the first rehearsal installs this version's runtime folder, npm picking LiteSVM's binary for this
  // platform, and runs in it. The endpoint is a loopback stub holding the Rent sysvar at mainnet's
  // rent, the Kitchen's fee config and USDC's mint (`solana-rpc-stub.mjs`); --assume-balance takes
  // the rehearsal into the copy, as a cook too large for one transaction does. The command runs
  // asynchronously: the stub answers from this process.
  // The loopback endpoint a Solana rehearsal reads (with the engine binaries only).
  const solanaStub = async () => {
    writeFileSync(
      join(work, "solana-ids.mjs"),
      `export { deriveExecutionFeeConfigPda } from "${name}/svm";\n` +
        `export { v12SvmKitchenProgramId } from "${name}/deployments";\n`,
    );
    const ids = await import(pathToFileURL(join(work, "solana-ids.mjs")).href);
    const kitchen = ids.v12SvmKitchenProgramId();
    const { address: feeConfig } = await ids.deriveExecutionFeeConfigPda(kitchen);
    const usdc = JSON.parse(
      readFileSync(
        join(
          root,
          "sdk/test/svm/fixtures/raydium-clmm/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v.json",
        ),
        "utf8",
      ),
    );
    const { solanaRpcStub } = await import(
      pathToFileURL(join(root, "sdk/scripts/solana-rpc-stub.mjs")).href
    );

    return solanaRpcStub({
      kitchen,
      feeConfig,
      fee: 85_672n,
      accounts: {
        [usdc.address]: { owner: usdc.owner, data: Buffer.from(usdc.base64Data, "base64") },
      },
    });
  };
  const solanaProgram = "function main(x: Uint256): Uint256 {\n  return x + 1;\n}\n";
  const solanaOwner = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
  if (shipsEngine) {
    assert.ok(!existsSync(join(work, "node_modules/litesvm")), "no install brings LiteSVM");
    const rehearsalHome = home("rehearsal");
    const stub = await solanaStub();
    try {
      writeFileSync(join(work, "solana-check.sauce.ts"), solanaProgram);
      const rehearse = (cwd) =>
        promisify(execFile)(
          "npx",
          [
            ...["--no", "--", "sauce", "--no-update-check", "simulate"],
            join(work, "solana-check.sauce.ts"),
            ...["--chain", "solana", "--rpc-url", stub.url],
            ...["--owner", solanaOwner],
            ...["--assume-balance", "USDC:1", "--args", "1", "--json"],
          ],
          { cwd, encoding: "utf8", env: { ...smokeEnv, HOME: rehearsalHome } },
        ).then(
          ({ stdout, stderr }) => ({ status: 0, stdout, stderr }),
          ({ code, stdout, stderr }) => ({ status: code, stdout, stderr }),
        );
      const { stdout, stderr } = await rehearse(work);
      assert.ok(
        stderr.includes(`Installing them into ${runtimeOf(rehearsalHome)}, once for this version`),
        `the first simulation installs its runtime folder: ${stderr}`,
      );
      const rehearsal = JSON.parse(stdout);
      assert.equal(rehearsal.ok, true, `the simulation succeeds: ${rehearsal.reason}`);
      assert.equal(rehearsal.path, "local copy (LiteSVM)", "in the local copy");
      assert.equal(String(rehearsal.returned), "2", "and main's return comes back");
      assert.ok(
        stub.methods.has("getMultipleAccounts"),
        "the copy read its accounts from the stub",
      );
    } finally {
      await stub.close();
    }
    // The folder: owner-only, LiteSVM at its pin, and its native binary, exactly this platform's.
    const folder = runtimeOf(rehearsalHome);
    if (process.platform !== "win32") {
      assert.equal(statSync(folder).mode & 0o777, 0o700, "the runtime folder is owner-only");
    }
    const litesvm = JSON.parse(
      readFileSync(join(folder, "node_modules/litesvm/package.json"), "utf8"),
    );
    assert.equal(litesvm.version, RUNTIME_PINS.litesvm);
    const binaries = readdirSync(join(folder, "node_modules")).filter((each) =>
      each.startsWith("litesvm-"),
    );
    assert.equal(binaries.length, 1, `one LiteSVM binary: ${binaries}`);
    const binary = JSON.parse(
      readFileSync(join(folder, "node_modules", binaries[0], "package.json"), "utf8"),
    );
    assert.ok(
      binary.os.includes(process.platform) && binary.cpu.includes(process.arch),
      `${binaries[0]} is ${process.platform}-${process.arch}'s`,
    );
    console.log(
      "Clean package install: npx sauce simulate installs its runtime folder " +
        `(${installedSize(folder).text}, ${binaries[0]} among it) and simulates a Solana cook in ` +
        "its local copy",
    );
  }

  // The testing kit on Solana from a clean install: the tarball and the LiteSVM it pins, and nothing
  // else, a Solana cook in LiteSVM with the packaged engine and Kitchen, staged too.
  if (shipsEngine && shipsAddresses) {
    const kit = mkdtempSync(join(tmpdir(), "sauce-solana-kit-"));
    try {
      writeFileSync(join(kit, "package.json"), JSON.stringify({ private: true, type: "module" }));
      execFileSync(
        "npm",
        [
          ...["install", "--engine-strict", "--ignore-scripts", "--prefer-offline"],
          ...["--no-audit", "--no-fund", join(work, filename), `litesvm@${RUNTIME_PINS.litesvm}`],
        ],
        { cwd: kit, stdio: "inherit" },
      );
      writeFileSync(
        join(kit, "solana-kit.mjs"),
        `
        import assert from 'node:assert/strict';
        import { CookReverted, local } from '${name}/testing';
        const solana = await local({ chain: 'solana' });
        try {
          const twice = await solana.run({ source: 'function main(a: Uint256): Uint256 {\\n  return a * 2;\\n}\\n' }, { args: [21n] });
          assert.equal(twice.returned, 42n, 'a Solana cook returns what main returned');
          await assert.rejects(
            solana.simulate({ source: 'function main(a: Uint256) {\\n  require(a < 10, "too big");\\n}\\n' }, { args: [11n] }),
            (error) => error instanceof CookReverted && error.reason === 'too big',
          );
          let body = '  let x = a;\\n';
          for (let i = 0; i < 300; i++) body += '  x = (x * ' + (i + 3) + ' + ' + (i + 1) + ') % 1000003;\\n';
          const staged = await solana.run({ source: 'function main(a: Uint256): Uint256 {\\n' + body + '  return x;\\n}\\n' }, { args: [7n] });
          assert.equal(staged.staged, true, 'a program past one transaction is staged');
          const to = solana.account(1).address;
          await solana.fund(solana.account(0).pot, { WSOL: '1' });
          const paid = await solana.run({ source: 'function main(to: Address, amount: Uint256) {\\n  WSOL.transfer(to, amount);\\n}\\n' }, { args: [to, 1000n] });
          assert.equal(paid.delta(to, 'WSOL'), 1000n, 'the token methods move wrapped SOL');
        } finally {
          await solana.stop();
        }
        `,
      );
      execFileSync(process.execPath, [join(kit, "solana-kit.mjs")], {
        cwd: kit,
        stdio: "inherit",
        env: smokeEnv,
      });
      console.log(
        "Clean package install: ./testing runs Solana cooks in the project's LiteSVM, with the " +
          "packaged engine and Kitchen",
      );
    } finally {
      rmSync(kit, { recursive: true, force: true });
    }
  }

  // `sauce update` tells a copy's install from its real path. This one is a project's own (the
  // consumer's node_modules): it prints the project's command and installs nothing. The same
  // tarball installed globally by npm, under a prefix of its own, is npm's global install there.
  // Both read the registry's latest; neither installs anything (--check for the global one).
  const projectUpdate = JSON.parse(sauce("update", "--json"));
  assert.deepEqual(
    [projectUpdate.installation.kind, projectUpdate.installation.manager],
    ["project", "npm"],
    "sauce update knows a project's own copy",
  );
  assert.equal(realpathSync(projectUpdate.installation.project), realpathSync(work));
  assert.match(projectUpdate.command, /^npm install --save-exact @eco-incorp\/sauce@latest$/);
  const prefix = mkdtempSync(join(tmpdir(), "sauce-global-"));
  try {
    execFileSync(
      "npm",
      [
        "install",
        "--global",
        "--prefix",
        prefix,
        "--prefer-offline",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        join(work, filename),
      ],
      { cwd: work, stdio: ["ignore", "ignore", "inherit"] },
    );
    const globalUpdate = JSON.parse(
      execFileSync(join(prefix, "bin", "sauce"), ["update", "--check", "--json"], {
        cwd: prefix,
        encoding: "utf8",
        env: smokeEnv,
      }),
    );
    assert.deepEqual(
      [globalUpdate.installation.kind, globalUpdate.installation.manager, globalUpdate.updated],
      ["global", "npm", false],
      "sauce update knows npm's global install",
    );
    assert.equal(globalUpdate.installation.prefix, realpathSync(prefix));
    assert.equal(globalUpdate.current, installedManifest.version);
    assert.match(
      globalUpdate.command,
      new RegExp(`^npm install --global --prefix \\S+ @eco-incorp/sauce@${globalUpdate.target}$`),
    );
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
  console.log(
    "Clean package install: sauce update knows the project's own copy and npm's global install, " +
      "and installs nothing to say so",
  );

  // `sauce actions` loads the actions package from beside the SDK's build, by a path relative to
  // the bin: only the installed tarball proves the two land where it looks. The sauce-actions
  // skill's document names no chain and no address, so it lowers for two chains to one source.
  const document = join(installedRoot, "skills/sauce-actions/examples/swap-by-key.json");
  const lowered = ["ethereum", "base"].map((slug) =>
    JSON.parse(sauce("actions", document, "--chain", slug, "--json")),
  );
  assert.equal(lowered[0].source, lowered[1].source, "one source for every chain");
  assert.notEqual(lowered[0].bytecode, lowered[1].bytecode, "each chain's own addresses");
  assert.match(lowered[0].source, /UniswapV3\.Factory\.getPool\(USDC, WETH, 500\)/);
  const actionsTx = JSON.parse(
    sauce(
      "tx",
      document,
      "--chain",
      "ethereum",
      "--owner",
      owner,
      "--value",
      "0",
      "--offline",
      "--args",
      "1000000",
    ),
  );
  assert.ok(
    actionsTx.data.includes(lowered[0].bytecode.slice(2)),
    "sauce tx cooks an actions document as it cooks a program",
  );
  console.log(
    "Clean package install: sauce actions lowers the shipped document for two chains, and sauce tx " +
      "cooks it",
  );

  const project = join(work, "scaffolded");
  sauce("init", project);
  const scaffoldedManifest = JSON.parse(readFileSync(join(project, "package.json"), "utf8"));
  // viem as the installed package resolves it: the one its TypeScript API is typed in.
  const installedViem = JSON.parse(
    readFileSync(
      createRequire(join(installedRoot, "package.json")).resolve("viem/package.json"),
      "utf8",
    ),
  ).version;
  assert.deepEqual(
    scaffoldedManifest.dependencies,
    { [name]: installedManifest.version, viem: installedViem },
    "sauce init pins the package to exactly the version that ran it, and viem to the one beside it",
  );
  for (const file of [
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    ".gitignore",
    "sauce.config.example.json",
    "programs/tsconfig.json",
  ]) {
    assert.ok(existsSync(join(project, file)), `sauce init writes ${file}`);
  }
  // Every agent skill in the repository ships, byte for byte, and nothing else does.
  const skillFiles = (dir) =>
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"))
      .sort();
  const shippedSkills = skillFiles(join(installedRoot, "skills"));
  assert.deepEqual(shippedSkills, skillFiles(join(root, "skills")), "the package ships skills/");
  for (const file of shippedSkills) {
    assert.ok(
      readFileSync(join(installedRoot, "skills", file)).equals(
        readFileSync(join(root, "skills", file)),
      ),
      `skills/${file} ships verbatim`,
    );
  }
  for (const skill of ["sauce-overview", "sauce-cli", "sauce-protocols", "sauce-examples"]) {
    assert.ok(shippedSkills.includes(`${skill}/SKILL.md`), `the package ships the ${skill} skill`);
  }
  // The per-protocol documents the /skills export serves are the sauce-protocols skill's files.
  const protocolSkills = await import(
    pathToFileURL(join(installedRoot, installedManifest.exports["./skills"].default)).href
  );
  for (const slug of protocolSkills.listSkillSlugs()) {
    assert.equal(
      protocolSkills.getProtocolSkill(slug),
      readFileSync(join(installedRoot, "skills/sauce-protocols/references", `${slug}.md`), "utf8"),
      `getProtocolSkill("${slug}") is the shipped sauce-protocols reference`,
    );
  }
  // Claude Code reads .claude/skills; Codex, Cursor, Copilot and Gemini CLI read .agents/skills.
  for (const dir of [".claude/skills", ".agents/skills"]) {
    for (const file of shippedSkills) {
      assert.equal(
        readFileSync(join(project, dir, file), "utf8"),
        readFileSync(join(installedRoot, "skills", file), "utf8"),
        `sauce init installs ${file} verbatim into ${dir}`,
      );
    }
    // And beside them the programs' TypeScript project, as init writes it into programs/.
    assert.equal(
      readFileSync(join(project, dir, "tsconfig.json"), "utf8"),
      readFileSync(join(project, "programs/tsconfig.json"), "utf8"),
      `sauce init types the skills' programs in ${dir} as it types programs/`,
    );
  }
  // status exits non-zero on anything outdated, so execFileSync throwing is the failure.
  const status = sauce("skills", "status", "--dir", project);
  assert.equal(status.match(/: up to date \(/g)?.length, 2, `every target is current:\n${status}`);
  assert.match(sauce("skills", "install", "--dir", project), /^skills are up to date \(/);
  console.log(
    `Clean package install: sauce init scaffolds a project pinned to ${installedManifest.version}, ` +
      `whose ${shippedSkills.length} skill files then check clean for every agent`,
  );

  // An editor on that project, asked through its own tsserver from the installed TypeScript: the
  // programs in programs/ — an agent's two, as it wrote them, and every one the skills ship —
  // show no error, a real mistake does, the skills' programs where the init installed them show
  // none either, and the project's other TypeScript is untouched.
  const { checkEditor } = await import(
    pathToFileURL(join(root, "sdk/scripts/check-editor.mjs")).href
  );
  const demo = join(root, "sdk/test/fixtures/sauce-script/demo");
  const editorPrograms = [
    join(demo, "usdc-to-weth.sauce.ts"),
    join(demo, "solana/pay-usdc-keep-minimum.sauce.ts"),
    ...shippedSkills
      .filter((file) => file.endsWith(".sauce.ts"))
      .map((file) => join(project, ".claude/skills", file)),
  ];
  const shown = await checkEditor({
    project,
    tsserverPath: join(work, "node_modules/typescript/lib/tsserver.js"),
    programs: editorPrograms,
  });
  console.log(
    `Clean package install: in the project sauce init wrote, an editor's tsserver shows the ` +
      `${shown} programs in programs/ no error, a mistake one, the installed skills' none, and a ` +
      "Node file beside them none",
  );

  // `sauce skills install` on its own, for one agent: only the directory that agent reads, every
  // shipped file verbatim, and the record `update` and `status` read.
  const codexProject = join(work, "codex-project");
  sauce("skills", "install", "--agent", "codex", "--dir", codexProject);
  assert.ok(!existsSync(join(codexProject, ".claude")), "--agent codex writes no .claude/skills");
  for (const file of shippedSkills) {
    assert.ok(
      readFileSync(join(codexProject, ".agents/skills", file)).equals(
        readFileSync(join(installedRoot, "skills", file)),
      ),
      `sauce skills install --agent codex writes ${file} verbatim`,
    );
  }
  const record = JSON.parse(
    readFileSync(join(codexProject, ".agents/skills/.sauce-skills.json"), "utf8"),
  );
  assert.equal(record.version, installedManifest.version, "the install records the version");
  assert.deepEqual(
    Object.keys(record.files).sort(),
    [...shippedSkills, "tsconfig.json"].sort(),
    "and every file it wrote: the skills, and their programs' tsconfig.json",
  );
  assert.match(
    sauce("skills", "status", "--dir", codexProject),
    /: up to date \(/,
    "status: the codex install is current",
  );
  console.log(
    `Clean package install: sauce skills install --agent codex writes the ${shippedSkills.length} ` +
      "skill files to .agents/skills and nothing else",
  );

  // The skills as that install left them, checked against the INSTALLED package as the repository
  // checks its own: every program compiled through the installed bin, every command line, every
  // runner executed offline from the project, the way an agent runs one.
  execFileSync(
    process.execPath,
    [join(root, "sdk/scripts/check-skills.mjs"), "--skills", join(codexProject, ".agents/skills")],
    { cwd: work, stdio: "inherit", env: smokeEnv },
  );
  assert.match(
    sauce("skills", "status", "--dir", codexProject),
    /: up to date \(/,
    "the check leaves the installed skills as they were",
  );

  // The same runners in a project whose package manager installs a package's own dependencies
  // beside it rather than at the project's root (pnpm's default): only the project's direct
  // dependencies resolve from it — what `sauce init` writes: the package, viem and Node's typings
  // (its TypeScript runs the check) — and the package's own only from beside the package. Outside
  // `work`, so nothing hoisted there is reached either. Every runner must typecheck there; a probe
  // that imports one of the package's own dependencies must not.
  const projectDependencies = [
    ...Object.keys(scaffoldedManifest.dependencies),
    ...Object.keys(scaffoldedManifest.devDependencies).filter((each) => each !== "typescript"),
  ];
  assert.deepEqual(
    projectDependencies,
    [name, "viem", "@types/node"],
    "what sauce init depends on",
  );
  const isolated = mkdtempSync(join(tmpdir(), "sauce-isolated-project-"));
  try {
    writeFileSync(
      join(isolated, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    for (const dependency of projectDependencies) {
      const at = join(isolated, "node_modules", dependency);
      mkdirSync(dirname(at), { recursive: true });
      symlinkSync(join(work, "node_modules", dependency), at, "dir");
    }
    sauce("skills", "install", "--agent", "codex", "--dir", isolated);
    const installedRunners = shippedSkills
      .filter((file) => file.endsWith(".mts"))
      .map((file) => join(isolated, ".agents/skills", file));
    const probe = join(isolated, ".agents/skills/probe.mts");
    writeFileSync(probe, 'import { address } from "@solana/kit";\nconsole.log(address);\n');
    const options = {
      target: ts.ScriptTarget.ES2022,
      lib: ["lib.es2023.d.ts"],
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      types: ["node"],
      typeRoots: [join(isolated, "node_modules/@types")],
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      verbatimModuleSyntax: true,
      erasableSyntaxOnly: true,
      allowImportingTsExtensions: true,
    };
    const diagnostics = ts.getPreEmitDiagnostics(
      ts.createProgram([...installedRunners, probe], options),
    );
    const where = (d) =>
      `${d.file === undefined ? "" : `${relative(isolated, d.file.fileName)}: `}` +
      ts.flattenDiagnosticMessageText(d.messageText, " ");
    assert.deepEqual(
      diagnostics.filter((d) => d.file?.fileName !== probe).map(where),
      [],
      "every installed runner typechecks with only the project's own dependencies",
    );
    assert.ok(
      diagnostics.some((d) => d.file?.fileName === probe && d.code === 2307),
      "the project does not resolve the package's own dependencies (@solana/kit)",
    );
    console.log(
      `Clean package install: the ${installedRunners.length} installed runners typecheck in a ` +
        `project that resolves only what sauce init makes it depend on (${projectDependencies.join(", ")})`,
    );
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }

  // `sauce mcp`, from the install, the way `sauce mcp setup` launches it — `npx @eco-incorp/sauce
  // mcp`, here with `--no` so nothing is fetched — over both transports: the tools, a compile, and
  // every shipped skill file as a resource. Nothing here reaches a chain, nor (--no-update-check)
  // starts an update check's refresh. No install brought the MCP SDK: the first start installs this
  // version's runtime folder, and later ones take it as is.
  const mcpLaunch = ["--no", "--", name, "mcp", "--no-update-check"];
  const mcpProgram =
    "function main(recipient: Address, amount: Uint256) {\n  USDC.transfer(recipient, amount);\n}\n";
  writeFileSync(join(work, "mcp-check.sauce.ts"), mcpProgram);
  const mcpRequests = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "check-packed", version: "0" },
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "sauce_compile",
        arguments: {
          source: mcpProgram,
          chain: "ethereum",
        },
      },
    },
    { jsonrpc: "2.0", id: 4, method: "resources/list" },
  ];
  // Each server runs in a process group of its own — npx, the shell it may start, node — so it is
  // stopped whole: killing npx alone can leave the server running, holding this script's pipes
  // open, and the check would never end. Every wait is bounded for the same reason.
  // `direct`: the bin run by this Node.js, with no npx, so PATH may lack npm.
  // `launch`: npx's arguments in place of `mcpLaunch`.
  const mcpServer = (
    args,
    stdio,
    { cwd = work, env = smokeEnv, direct = false, launch = mcpLaunch } = {},
  ) =>
    direct
      ? spawn(process.execPath, [bin, "mcp", "--no-update-check", ...args], {
          cwd,
          env,
          stdio,
          detached: true,
        })
      : spawn("npx", [...launch, ...args], { cwd, env, stdio, detached: true });
  const stopServer = async (child) => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // The group is gone already.
      }
      await exited;
    }
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // Nothing of it is left.
    }
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.destroy();
  };
  const within = (promise, what, ms = 120_000) => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what}: nothing within ${ms / 1000}s`)), ms);
    });

    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  };
  // Over stdio: one JSON-RPC message per line in, one per line out, and EOF ends the server; what it
  // says besides goes to stderr, which is kept.
  const overStdio = async ({ requests = mcpRequests, args = [], ...options } = {}) => {
    const asked = requests.filter((message) => message.id !== undefined).length;
    const stdio = mcpServer(args, ["pipe", "pipe", "pipe"], options);
    let stdout = "";
    let stderr = "";
    const answers = new Map();
    stdio.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    try {
      const answered = new Promise((resolveAll, rejectAll) => {
        stdio.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
          for (let at = stdout.indexOf("\n"); at >= 0; at = stdout.indexOf("\n")) {
            const message = JSON.parse(stdout.slice(0, at));
            stdout = stdout.slice(at + 1);
            if (message.id !== undefined) answers.set(message.id, message);
            if (answers.size === asked) resolveAll();
          }
        });
        stdio.once("exit", (code) =>
          rejectAll(new Error(`sauce mcp exited ${code} before answering: ${stderr}`)),
        );
      });
      for (const message of requests) stdio.stdin.write(`${JSON.stringify(message)}\n`);
      await within(answered, "sauce mcp over stdio");
      stdio.stdin.end();
      await within(once(stdio, "exit"), "sauce mcp ending at EOF", 30_000).catch(() => {});
    } finally {
      await stopServer(stdio);
    }

    return { answers, stderr };
  };
  // The first start, in a home with no runtime folder: it installs one, saying so on stderr alone.
  const mcpHome = home("mcp");
  const first = await overStdio({ env: { ...smokeEnv, HOME: mcpHome } });
  const answers = first.answers;
  assert.ok(
    first.stderr.includes(`${needsMcp}. Installing them into ${runtimeOf(mcpHome)}`),
    `the first sauce mcp installs its runtime folder: ${first.stderr}`,
  );
  assert.equal(answers.get(1).result.serverInfo.version, installedManifest.version);
  const toolNames = answers.get(2).result.tools.map((tool) => tool.name);
  for (const tool of [
    "sauce_compile",
    "sauce_actions",
    "sauce_tx",
    "sauce_pot",
    "sauce_simulate",
    "sauce_skills",
    "sauce_skill",
  ]) {
    assert.ok(toolNames.includes(tool), `sauce mcp lists ${tool}`);
  }
  assert.deepEqual(
    toolNames.filter((tool) => tool.startsWith("sauce_intent_")),
    [],
    "sauce mcp lists no intent tool",
  );
  assert.equal(
    answers.get(3).result.structuredContent.bytecode,
    JSON.parse(sauce("compile", join(work, "mcp-check.sauce.ts"), "--chain", "ethereum", "--json"))
      .bytecode,
    "sauce_compile compiles what sauce compile does",
  );
  const resourceUris = answers.get(4).result.resources.map((resource) => resource.uri);
  for (const file of shippedSkills) {
    assert.ok(resourceUris.includes(`sauce://skills/${file}`), `sauce mcp serves skills/${file}`);
  }
  const sameTools = (other, what) =>
    assert.deepEqual(
      other.get(2).result.tools.map((tool) => tool.name),
      toolNames,
      `${what}: the same tools`,
    );
  // The second start takes the folder as it is, with npm unreachable: not on PATH, and its
  // registry a closed port.
  const noPath = home("no-path");
  const unreachable = { npm_config_registry: "http://127.0.0.1:9/", PATH: noPath };
  const second = await overStdio({
    env: { ...smokeEnv, HOME: mcpHome, ...unreachable },
    direct: true,
  });
  sameTools(second.answers, "a second start with no npm");
  assert.equal(second.stderr, "", "a second start installs nothing");
  console.log(
    `Clean package install: the first sauce mcp installs its runtime folder ` +
      `(${installedSize(runtimeOf(mcpHome)).text}), and the second needs no npm`,
  );
  // A project that already has its own zod 3 and MCP SDK 1.29.0, both outside the pins, then
  // installs the package. That is the case where an exact optional peer made npm refuse the install
  // (ERESOLVE); the peers are any version's, so it installs beside them, and the command passes those
  // copies over for the pinned ones.
  const mismatch = mkdtempSync(join(tmpdir(), "sauce-mismatch-"));
  try {
    writeFileSync(join(mismatch, "package.json"), JSON.stringify({ private: true }));
    const npmInstall = (...specs) =>
      execFileSync(
        "npm",
        ["install", "--ignore-scripts", "--prefer-offline", "--no-audit", "--no-fund", ...specs],
        { cwd: mismatch, stdio: "inherit" },
      );
    npmInstall("zod@3.25.76", "@modelcontextprotocol/sdk@1.29.0");
    npmInstall(join(work, filename));
    const env = { ...smokeEnv, HOME: mcpHome };
    const status = JSON.parse(
      execFileSync(
        process.execPath,
        [
          join(mismatch, "node_modules", name, installedManifest.bin.sauce),
          ...["--no-update-check", "runtime", "--json"],
        ],
        {
          cwd: mismatch,
          encoding: "utf8",
          env,
        },
      ),
    );
    assert.equal(status.packages["@modelcontextprotocol/sdk"].own.version, "1.29.0");
    assert.equal(status.packages.zod.own.version, "3.25.76");
    assert.equal(status.uses["sauce mcp"], "runtime", "the runtime folder's, not the user's");
    sameTools((await overStdio({ cwd: mismatch, env })).answers, "beside a mismatched MCP SDK");
  } finally {
    rmSync(mismatch, { recursive: true, force: true });
  }
  // A project on Solana's Kit adds the package, and a project with the package adds Kit and the
  // program clients: either way npm resolves the one Kit both use and refuses nothing. With a Kit
  // a major behind, the second was refused (ERESOLVE): today's program clients peer-require
  // today's Kit, and the package's older copy stood at the project's root.
  for (const packageFirst of [false, true]) {
    const solana = mkdtempSync(join(tmpdir(), "sauce-solana-project-"));
    try {
      writeFileSync(join(solana, "package.json"), JSON.stringify({ private: true }));
      const npmInstall = (...specs) =>
        execFileSync(
          "npm",
          ["install", "--ignore-scripts", "--prefer-offline", "--no-audit", "--no-fund", ...specs],
          { cwd: solana, stdio: "inherit" },
        );
      const steps = [[join(work, filename)], SOLANA_PROJECT];
      for (const specs of packageFirst ? steps : steps.reverse()) npmInstall(...specs);
      assert.equal(
        existsSync(join(solana, "node_modules", name, "node_modules", "@solana", "kit")),
        false,
        "the package and the project share one Kit",
      );
    } finally {
      rmSync(solana, { recursive: true, force: true });
    }
  }
  console.log(
    `Clean package install: a project on Solana's Kit adds the package, and one with the package ` +
      `adds Kit and its program clients (${SOLANA_PROJECT.join(", ")}): one Kit, no conflict`,
  );
  // Where it may not install, it refuses on one line: --offline; no npm; npm with no registry.
  const offlineHome = home("offline");
  const offline = spawnSync(process.execPath, [bin, "mcp", "--offline"], {
    cwd: work,
    env: { ...smokeEnv, HOME: offlineHome },
    encoding: "utf8",
    input: "",
  });
  assert.equal(
    refusal(offline, "sauce mcp --offline", offlineHome),
    `sauce mcp: ${needsMcp}, and --offline installs nothing: run \`sauce runtime install\``,
  );
  // An --offline server is offline to its last tool: one whose runtime folder holds the MCP SDK and
  // zod but not LiteSVM refuses a Solana sauce_simulate, and installs nothing for it.
  if (shipsEngine) {
    const offlineServerHome = home("offline-server");
    mkdirSync(dirname(runtimeOf(offlineServerHome)), { recursive: true, mode: 0o700 });
    cpSync(runtimeOf(mcpHome), runtimeOf(offlineServerHome), { recursive: true });
    // Owner-only, as an install leaves it: the command loads from no other.
    chmodSync(runtimeOf(offlineServerHome), 0o700);
    rmSync(join(runtimeOf(offlineServerHome), "node_modules/litesvm"), { recursive: true });
    const stub = await solanaStub();
    try {
      const { answers: simulated } = await overStdio({
        args: ["--offline"],
        env: { ...smokeEnv, HOME: offlineServerHome },
        requests: [
          ...mcpRequests.slice(0, 2),
          {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
              name: "sauce_simulate",
              arguments: {
                source: solanaProgram,
                chain: "solana",
                rpcUrl: stub.url,
                owner: solanaOwner,
                assumeBalance: ["USDC:1"],
                args: ["1"],
              },
            },
          },
        ],
      });
      const result = simulated.get(2).result;
      assert.equal(result.isError, true, JSON.stringify(result));
      assert.match(
        JSON.stringify(result.content),
        /needs litesvm \S+, not installed for this sauce yet, and --offline installs nothing/,
      );
    } finally {
      await stub.close();
    }
    assert.ok(
      !existsSync(join(runtimeOf(offlineServerHome), "node_modules/litesvm")),
      "the --offline server installed nothing",
    );
  }
  const noNpmHome = home("no-npm");
  const noNpm = spawnSync(process.execPath, [bin, "mcp", "--no-update-check"], {
    cwd: work,
    env: { ...smokeEnv, HOME: noNpmHome, PATH: noPath },
    encoding: "utf8",
    input: "",
  });
  assert.equal(
    refusal(noNpm, "sauce mcp with no npm", noNpmHome),
    `sauce mcp: ${needsMcp}, and installing them into ${runtimeOf(noNpmHome)} failed: npm is ` +
      "not on PATH. Nothing was left half-installed: `sauce runtime install` tries again",
  );
  const noRegistryHome = home("no-registry");
  const noRegistry = spawnSync(process.execPath, [bin, "mcp", "--no-update-check"], {
    cwd: work,
    env: {
      ...smokeEnv,
      HOME: noRegistryHome,
      npm_config_registry: unreachable.npm_config_registry,
      npm_config_cache: home("empty-npm-cache"),
      npm_config_fetch_retries: "0",
    },
    encoding: "utf8",
    input: "",
  });
  assert.match(
    refusal(noRegistry, "sauce mcp with no registry", noRegistryHome),
    /failed: npm ci exited with status \d+ \(.*ECONNREFUSED.*\)\. Nothing was left half-installed/,
  );
  // `sauce mcp setup` installs the folder before any agent starts the server.
  const setupHome = home("setup");
  const setupProject = mkdtempSync(join(tmpdir(), "sauce-mcp-setup-"));
  try {
    execFileSync(
      process.execPath,
      [bin, "--no-update-check", "mcp", "setup", "--agent", "claude", "--dir", setupProject],
      {
        cwd: setupProject,
        env: { ...smokeEnv, HOME: setupHome },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    assert.ok(existsSync(join(setupProject, ".mcp.json")), "sauce mcp setup writes .mcp.json");
    assert.ok(
      existsSync(join(runtimeOf(setupHome), "node_modules/@modelcontextprotocol/sdk")),
      "and installs the server's runtime folder",
    );
  } finally {
    rmSync(setupProject, { recursive: true, force: true });
  }
  console.log(
    "Clean package install: a project with its own zod 3 and MCP SDK 1.29.0 installs the " +
      "package, and its copies are passed over; --offline (a server's Solana sauce_simulate " +
      "included), no npm and no registry each refuse on one line, leaving nothing; sauce mcp " +
      "setup installs the folder",
  );
  // Over Streamable HTTP, self-hosted with the same one command and a port it picks: initialize
  // and tools/list, each a POST of its own to the stateless /mcp.
  const http = mcpServer(["--http", "0"], ["ignore", "ignore", "pipe"], {
    env: { ...smokeEnv, HOME: mcpHome },
  });
  try {
    let httpLog = "";
    const url = await within(
      new Promise((resolveUrl, rejectUrl) => {
        http.stderr.on("data", (chunk) => {
          httpLog += chunk.toString();
          const found = /Streamable HTTP at (http:\/\/\S+)/.exec(httpLog);
          if (found !== null) resolveUrl(found[1]);
        });
        http.once("exit", (code) =>
          rejectUrl(new Error(`sauce mcp --http exited ${code}: ${httpLog}`)),
        );
      }),
      "sauce mcp --http starting",
    );
    const post = async (message) => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
          connection: "close",
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(60_000),
      });
      assert.equal(response.status, 200, `${message.method} over HTTP`);

      return response.json();
    };
    assert.equal((await post(mcpRequests[0])).result.serverInfo.name, "sauce");
    // The same tools, but for the wallets' and the stores', which a server serves and keeps over
    // stdio only (by default): the HTTP server never signs, and keeps nothing.
    const stdioOnly = [
      "sauce_wallet_enable",
      "sauce_wallet_create",
      "sauce_wallet_import",
      "sauce_wallet_list",
      "sauce_wallet_address",
      "sauce_wallet_send",
      "sauce_pot_list",
      "sauce_pot_import",
    ];
    for (const tool of stdioOnly) assert.ok(toolNames.includes(tool), `stdio lists ${tool}`);
    assert.deepEqual(
      (await post(mcpRequests[2])).result.tools.map((tool) => tool.name),
      toolNames.filter((tool) => !stdioOnly.includes(tool)),
      "the same tools over HTTP as over stdio, but for the wallets' and stores' over stdio only",
    );
  } finally {
    await stopServer(http);
  }
  console.log(
    `Clean package install: npx ${name} mcp serves its ${toolNames.length} tools and the ` +
      `${shippedSkills.length} skill files over stdio and Streamable HTTP`,
  );

  // `npx -y` in a directory with nothing in it, as an agent launches the server: npx installs the
  // tarball into its own cache, as plainly as any install, and its `sauce mcp` takes the runtime
  // folder of its version, which the first start above installed. That npx install is found by the
  // tarball it names and removed after.
  const empty = mkdtempSync(join(tmpdir(), "sauce-npx-"));
  const npxDir = join(npmCache, "_npx");
  const npxInstalls = () =>
    (existsSync(npxDir) ? readdirSync(npxDir) : []).filter((dir) => {
      const manifest = join(npxDir, dir, "package.json");

      return (
        existsSync(manifest) &&
        JSON.parse(readFileSync(manifest, "utf8"))._npx?.packages?.includes(join(work, filename))
      );
    });
  try {
    const npxLaunch = [
      ...["-y", "--prefer-offline", "--package", join(work, filename), "--", "sauce"],
      "--no-update-check",
    ];
    const npx = (...args) =>
      execFileSync("npx", [...npxLaunch, ...args], { cwd: empty, encoding: "utf8", env: smokeEnv });
    assert.match(npx("mcp", "--help"), /^Serve the commands and the agent skills to coding agents/);
    writeFileSync(join(empty, "mcp-check.sauce.ts"), mcpProgram);
    assert.equal(
      npx("compile", "mcp-check.sauce.ts", "--chain", "ethereum").trim(),
      sauce("compile", join(work, "mcp-check.sauce.ts"), "--chain", "ethereum").trim(),
    );
    const [npxInstall] = npxInstalls();
    assert.ok(npxInstall !== undefined, `npx installed the tarball under ${npxDir}`);
    for (const each of NEVER_IN_A_LIBRARY_INSTALL) {
      assert.ok(!existsSync(join(npxDir, npxInstall, "node_modules", each)), `npx has no ${each}`);
    }
    const npxServer = await overStdio({
      cwd: empty,
      env: { ...smokeEnv, HOME: mcpHome },
      launch: [...npxLaunch, "mcp"],
    });
    sameTools(npxServer.answers, "npx -y's sauce mcp");
    assert.equal(npxServer.stderr, "", "npx -y's sauce mcp takes the version's runtime folder");
    console.log(
      `Clean package install: npx -y runs sauce mcp --help, sauce compile and sauce mcp from an ` +
        `empty directory, its own install ${installedSize(join(npxDir, npxInstall)).text}`,
    );
  } finally {
    for (const dir of npxInstalls()) rmSync(join(npxDir, dir), { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  }

  // The same browser gates the repository runs, against the INSTALLED package and resolved from
  // this consumer by name, so what they prove is the shipped `exports` map: every browser-facing
  // export bundles for the browser without Node, and compiles in headless Chromium to the bytes
  // this installed package compiles in Node.
  for (const script of ["check-browser-bundles.mjs", "check-browser-compile.mjs"]) {
    execFileSync(
      process.execPath,
      [join(root, "sdk/scripts", script), "--package-root", installedRoot, "--consumer", work],
      // The real home: no `sauce` runs here, and Playwright keeps its browser under it.
      { cwd: work, stdio: "inherit", env: { ...smokeEnv, HOME: process.env.HOME } },
    );
  }
} finally {
  rmSync(work, { recursive: true, force: true });
  rmSync(library, { recursive: true, force: true });
  rmSync(homes, { recursive: true, force: true });
}

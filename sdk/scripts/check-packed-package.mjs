#!/usr/bin/env node
// Exercise the published entry points from a clean consumer, without workspace
// dependencies or a separately installed compiler hiding a broken bundle.
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
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
// What only the `sauce` command loads, for one command each (`sdk/src/cli/optional.ts`): installed
// by default, left out by a library install with --omit=optional.
const OPTIONAL = ["@modelcontextprotocol/sdk", "litesvm", "zod"];
// What none of the package's code imports, so no install of it brings: TypeScript and dotenv, which
// it once depended on, and the web servers the MCP SDK brings.
const NEVER_IN_A_LIBRARY_INSTALL = [...OPTIONAL, "typescript", "dotenv", "express", "hono"];
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
// A library install of the same tarball, with --omit=optional: outside `work`, so nothing of the
// default install there resolves from it.
const library = mkdtempSync(join(tmpdir(), "sauce-library-install-"));
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
      // `cross-chain-intent.ts` reads its SauceScript sibling off disk, which is the property that
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
  // command each, is optional: a default install brings it, a library install leaves it out.
  assert.deepEqual(Object.keys(installedManifest.optionalDependencies ?? {}).sort(), OPTIONAL);
  for (const each of NEVER_IN_A_LIBRARY_INSTALL) {
    assert.equal(installedManifest.dependencies[each], undefined, `${each} is not a dependency`);
  }
  for (const each of OPTIONAL) {
    assert.ok(
      existsSync(join(work, "node_modules", each, "package.json")),
      `a default install installs ${each}`,
    );
  }
  writeFileSync(join(library, "package.json"), JSON.stringify({ private: true, type: "module" }));
  execFileSync(
    "npm",
    [
      "install",
      "--omit=optional",
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
    assert.ok(
      !existsSync(join(library, "node_modules", each)),
      `--omit=optional leaves out ${each}`,
    );
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
  const defaultSize = installedSize(work);
  const librarySize = installedSize(library);
  console.log(
    `Clean package install: with --omit=optional, ${librarySize.text} (by default ` +
      `${defaultSize.text}, the consumer's TypeScript and Node typings included), and every one ` +
      `of its ${librarySubpaths.length} exports loads and works without what it left out`,
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
  `,
  );
  // Force the packaged path: the resolvers read no environment, and scrubbing CI's SAUCE_* paths
  // keeps this smoke proving the shipped binary resolves (what a credential-less consumer sees) even
  // if an env read ever crept back in.
  const smokeEnv = { ...process.env };
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
  // Base is a named export; USDC and Uniswap are SauceScript globals the compiler resolves
  // inside the route body — declared types with no runtime value, so importing them would be
  // wrong. This fixture is the packaged surface a consumer actually gets.
  const consumer = `
    import { Base } from '${name}';
    import { parseProgram, programIntent, type ActionProgram } from '${name}/actions';
    const options = {
      pot: '0x1111111111111111111111111111111111111111' as const,
      engine: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as const,
      deadline: 2000000000n,
      portal: '0x2222222222222222222222222222222222222222' as const,
      source: 'ethereum' as const,
      creator: '0x3333333333333333333333333333333333333333' as const,
      prover: '0x4444444444444444444444444444444444444444' as const,
    };
    const built = Base(() => {
      USDC.approve(Uniswap.UniversalRouter, 1000000n);
      // The language's builtins are declared for a typed closure too (builtins.generated.ts).
      require(ctx.timestamp() > 0n, "stale");
      log(crypto.keccak256(hex\`01\`).toBytesBe(32n));
    }, options).reward(0n);
    if (built.compiled.bytecode[0].length === 0) throw new Error('Empty route');
    // The actions declarations reference the SDK's by relative path; this checks they resolve.
    const program: ActionProgram = parseProgram({ version: 1, chainId: 8453, actions: [
      { type: 'approve', amount: '1', token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', spender: options.pot },
    ] });
    const intent = programIntent(program, options).reward(0n);
    if (intent.compiled.bytecode[0].length === 0) throw new Error('Empty action route');
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
  execFileSync(
    process.execPath,
    [
      join(work, "node_modules/typescript/bin/tsc"),
      join(work, "consumer.ts"),
      join(work, "actions-exports.ts"),
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

  // The `sauce` bin, run the way a consumer runs it — through npx, from the install, with nothing
  // but the tarball's files. It compiles the example its own agent skill ships, builds the Pot and
  // the transaction, and scaffolds a project whose skills then report up to date.
  const sauce = (...args) =>
    execFileSync("npx", ["--no", "--", "sauce", ...args], {
      cwd: work,
      encoding: "utf8",
      env: smokeEnv,
    });
  assert.equal(
    execFileSync("npx", ["--no", "--", name, "--version"], {
      cwd: work,
      encoding: "utf8",
      env: smokeEnv,
    }),
    `${name} ${installedManifest.version}\n`,
    `npx ${name} runs the package's sauce bin`,
  );
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
  assert.deepEqual(Object.keys(tx), ["chainId", "to", "data", "value"], "sauce tx prints the tx");
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

  // The library install runs every command that builds: none needs what it left out.
  const librarySauce = (...args) =>
    execFileSync("npx", ["--no", "--", "sauce", ...args], {
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
  console.log(
    "Clean package install: with --omit=optional, sauce compile, tx and globals print what they " +
      "print by default",
  );
  // A command that needs what it left out says so, on one line, with the line that installs it:
  // exit 1, never a stack trace.
  const pinned = installedManifest.optionalDependencies;
  const leftOut = ({ status, stdout, stderr }, what, needs) => {
    assert.equal(status, 1, `${what} exits 1: ${stderr}`);
    assert.equal(stdout, "", `${what} prints nothing on stdout`);
    assert.doesNotMatch(stderr, /^\s+at /m, `${what} prints no stack trace`);
    assert.equal(stderr.trimEnd().split("\n").length, 1, `${what} prints one line: ${stderr}`);
    assert.ok(
      stderr.includes(
        `needs ${needs.join(" and ")}, ${needs.length === 1 ? "an optional dependency" : "optional dependencies"} ` +
          `of ${name} that this install left out (--omit=optional): install`,
      ),
      `${what} names what it needs and why it is not here: ${stderr}`,
    );
    for (const each of needs) {
      assert.ok(stderr.includes(`${each}@${pinned[each]}`), `${what} pins ${each}: ${stderr}`);
    }

    return stderr;
  };

  // A Solana cook rehearsed in the local copy from the tarball alone: LiteSVM is the package's own
  // (optional) dependency, so `npx sauce simulate` needs nothing else installed. The endpoint is a loopback stub
  // holding the Rent sysvar at mainnet's rent, the Kitchen's fee config and USDC's mint
  // (`solana-rpc-stub.mjs`); --assume-balance takes the rehearsal into the copy, as a cook too large
  // for one transaction does. The command runs asynchronously: the stub answers from this process.
  if (shipsEngine) {
    assert.ok(
      existsSync(join(work, "node_modules/litesvm/package.json")),
      "installing the package installs LiteSVM",
    );
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
    const stub = await solanaRpcStub({
      kitchen,
      feeConfig,
      fee: 85_672n,
      accounts: {
        [usdc.address]: { owner: usdc.owner, data: Buffer.from(usdc.base64Data, "base64") },
      },
    });
    try {
      writeFileSync(
        join(work, "solana-check.sauce.ts"),
        "function main(x: Uint256): Uint256 {\n  return x + 1;\n}\n",
      );
      const rehearse = (cwd) =>
        promisify(execFile)(
          "npx",
          [
            ...["--no", "--", "sauce", "simulate", join(work, "solana-check.sauce.ts")],
            ...["--chain", "solana", "--rpc-url", stub.url],
            ...["--owner", "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9"],
            ...["--assume-balance", "USDC:1", "--args", "1", "--json"],
          ],
          { cwd, encoding: "utf8", env: smokeEnv },
        ).then(
          ({ stdout, stderr }) => ({ status: 0, stdout, stderr }),
          ({ code, stdout, stderr }) => ({ status: code, stdout, stderr }),
        );
      const { stdout } = await rehearse(work);
      const rehearsal = JSON.parse(stdout);
      assert.equal(rehearsal.ok, true, `the rehearsal succeeds: ${rehearsal.reason}`);
      assert.equal(rehearsal.path, "local copy (LiteSVM)", "in the local copy");
      assert.equal(String(rehearsal.returned), "2", "and main's return comes back");
      assert.ok(
        stub.methods.has("getMultipleAccounts"),
        "the copy read its accounts from the stub",
      );
      // The library install compiles and plans the same cook, and stops where the copy opens.
      leftOut(await rehearse(library), "a Solana rehearsal without LiteSVM", ["litesvm"]);
    } finally {
      await stub.close();
    }
    console.log(
      "Clean package install: npx sauce simulate rehearses a Solana cook in its local copy, with " +
        "the LiteSVM the package installs; with --omit=optional, it says how to install LiteSVM",
    );
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
  // programs in programs/ — an agent's three, as it wrote them, and every one the skills ship —
  // show no error, a real mistake does, the skills' programs where the init installed them show
  // none either, and the project's other TypeScript is untouched.
  const { checkEditor } = await import(
    pathToFileURL(join(root, "sdk/scripts/check-editor.mjs")).href
  );
  const demo = join(root, "sdk/test/fixtures/sauce-script/demo");
  const editorPrograms = [
    join(demo, "usdc-to-weth.sauce.ts"),
    join(demo, "intent/usdc-to-weth-on-base.sauce.ts"),
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
  // every shipped skill file as a resource. Nothing here reaches a chain.
  const mcpLaunch = ["--no", "--", name, "mcp"];
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
  const mcpServer = (args, stdio, cwd = work) =>
    spawn("npx", [...mcpLaunch, ...args], { cwd, env: smokeEnv, stdio, detached: true });
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
  // Over stdio: one JSON-RPC message per line in, one per line out, and EOF ends the server.
  const overStdio = async (cwd) => {
    const stdio = mcpServer([], ["pipe", "pipe", "inherit"], cwd);
    let stdout = "";
    const answers = new Map();
    try {
      const answered = new Promise((resolveAll, rejectAll) => {
        stdio.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
          for (let at = stdout.indexOf("\n"); at >= 0; at = stdout.indexOf("\n")) {
            const message = JSON.parse(stdout.slice(0, at));
            stdout = stdout.slice(at + 1);
            if (message.id !== undefined) answers.set(message.id, message);
            if (answers.size === 4) resolveAll();
          }
        });
        stdio.once("exit", (code) =>
          rejectAll(new Error(`sauce mcp exited ${code} before answering`)),
        );
      });
      for (const message of mcpRequests) stdio.stdin.write(`${JSON.stringify(message)}\n`);
      await within(answered, "sauce mcp over stdio");
      stdio.stdin.end();
      await within(once(stdio, "exit"), "sauce mcp ending at EOF", 30_000).catch(() => {});
    } finally {
      await stopServer(stdio);
    }

    return answers;
  };
  const answers = await overStdio(work);
  assert.equal(answers.get(1).result.serverInfo.version, installedManifest.version);
  const toolNames = answers.get(2).result.tools.map((tool) => tool.name);
  for (const tool of [
    "sauce_compile",
    "sauce_actions",
    "sauce_tx",
    "sauce_pot",
    "sauce_simulate",
    "sauce_intent_publish",
    "sauce_skills",
    "sauce_skill",
  ]) {
    assert.ok(toolNames.includes(tool), `sauce mcp lists ${tool}`);
  }
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
  // The library install left the MCP SDK out: `sauce mcp` says so, and how to install it. That line,
  // run as given (with --omit=optional, as a project keeping it in .npmrc installs), brings exactly
  // what the server needs, and the server then answers as the default install's does.
  const refused = leftOut(
    spawnSync("npx", [...mcpLaunch], { cwd: library, env: smokeEnv, encoding: "utf8", input: "" }),
    "sauce mcp without the MCP SDK",
    ["@modelcontextprotocol/sdk", "zod"],
  );
  assert.ok(refused.startsWith("sauce mcp: the MCP server needs "), refused);
  const installLine = /`(npm i [^`]+)`/.exec(refused)[1];
  assert.equal(
    installLine,
    `npm i @modelcontextprotocol/sdk@${pinned["@modelcontextprotocol/sdk"]} zod@${pinned.zod}`,
  );
  execFileSync(
    "npm",
    [
      ...installLine.split(" ").slice(1),
      "--omit=optional",
      "--prefer-offline",
      "--no-audit",
      "--no-fund",
    ],
    { cwd: library, stdio: "inherit" },
  );
  assert.ok(!existsSync(join(library, "node_modules/litesvm")), "and only what the line names");
  const libraryAnswers = await overStdio(library);
  assert.deepEqual(
    libraryAnswers.get(2).result.tools.map((tool) => tool.name),
    answers.get(2).result.tools.map((tool) => tool.name),
    "the same tools as the default install's",
  );
  console.log(
    `Clean package install: with --omit=optional, sauce mcp says it needs the MCP SDK and zod and ` +
      `how to install them, and \`${installLine}\` is all it then needs`,
  );
  // Over Streamable HTTP, self-hosted with the same one command and a port it picks: initialize
  // and tools/list, each a POST of its own to the stateless /mcp.
  const http = mcpServer(["--http", "0"], ["ignore", "ignore", "pipe"]);
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
    assert.deepEqual(
      (await post(mcpRequests[2])).result.tools.map((tool) => tool.name),
      toolNames,
      "the same tools over HTTP as over stdio",
    );
  } finally {
    await stopServer(http);
  }
  console.log(
    `Clean package install: npx ${name} mcp serves its ${toolNames.length} tools and the ` +
      `${shippedSkills.length} skill files over stdio and Streamable HTTP`,
  );

  // `npx -y` in a directory with nothing in it, as an agent launches the server: npx installs the
  // tarball into its own cache, optional dependencies included. That install is found by the
  // tarball it names and removed after.
  const empty = mkdtempSync(join(tmpdir(), "sauce-npx-"));
  const npxDir = join(
    execFileSync("npm", ["config", "get", "cache"], { encoding: "utf8" }).trim(),
    "_npx",
  );
  const npxInstalls = () =>
    (existsSync(npxDir) ? readdirSync(npxDir) : []).filter((dir) => {
      const manifest = join(npxDir, dir, "package.json");

      return (
        existsSync(manifest) &&
        JSON.parse(readFileSync(manifest, "utf8"))._npx?.packages?.includes(join(work, filename))
      );
    });
  try {
    const npx = (...args) =>
      execFileSync(
        "npx",
        ["-y", "--prefer-offline", "--package", join(work, filename), "--", "sauce", ...args],
        { cwd: empty, encoding: "utf8", env: smokeEnv },
      );
    assert.match(npx("mcp", "--help"), /^Serve the commands and the agent skills to coding agents/);
    writeFileSync(join(empty, "mcp-check.sauce.ts"), mcpProgram);
    assert.equal(
      npx("compile", "mcp-check.sauce.ts", "--chain", "ethereum").trim(),
      sauce("compile", join(work, "mcp-check.sauce.ts"), "--chain", "ethereum").trim(),
    );
    const [npxInstall] = npxInstalls();
    assert.ok(npxInstall !== undefined, `npx installed the tarball under ${npxDir}`);
    for (const each of OPTIONAL) {
      assert.ok(
        existsSync(join(npxDir, npxInstall, "node_modules", each, "package.json")),
        `npx -y installs ${each}`,
      );
    }
    console.log(
      `Clean package install: npx -y runs sauce mcp --help and sauce compile from an empty ` +
        `directory, its install ${installedSize(join(npxDir, npxInstall)).text}`,
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
      { cwd: work, stdio: "inherit", env: smokeEnv },
    );
  }
} finally {
  rmSync(work, { recursive: true, force: true });
  rmSync(library, { recursive: true, force: true });
}

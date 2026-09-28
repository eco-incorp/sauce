#!/usr/bin/env node
// Exercise the published entry points from a clean consumer, without workspace
// dependencies or a separately installed compiler hiding a broken bundle.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { documentedExports } from "../../actions/scripts/documented-exports.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Taken from the SDK's own devDependency rather than written out here, so this consumer typechecks
// the shipped examples against the same typings the repo builds them with and a bump moves both.
const TYPES_NODE_VERSION = JSON.parse(readFileSync(resolve(root, "sdk/package.json"), "utf8"))
  .devDependencies["@types/node"];
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
try {
  execFileSync("npm", ["run", "prepack"], { cwd: root, stdio: "inherit" });
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
    import { compile, encodeCompactArguments, decodeCompactArguments } from '${name}/compiler';
    import { settleSource, SAUCE_BASE_DIRS } from '${name}/recipes';
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
    const { bytecode: settle } = compile({
      target: 'evm',
      entry: 'settle.sauce.ts',
      resolve: (path) => {
        if (path.endsWith('settle.sauce.ts')) return new TextEncoder().encode(settleSource());
        const found = SAUCE_BASE_DIRS.map((dir) => join(dir, path.replace(/^\\.\\//, ''))).find(existsSync);
        return found === undefined ? undefined : readFileSync(found);
      },
    });
    assert.equal(settle.length, SETTLE_WIRE.PROGRAM_BYTES, 'settle program length matches its pin');
    assert.equal(keccak256(settle), SETTLE_WIRE.PROGRAM_HASH, 'settle program hash matches its pin');
    assert.equal('0x' + Buffer.from(settle).toString('hex'), SETTLE_PROGRAM, 'settle program bytes match SETTLE_PROGRAM');
    console.log('Clean package install: the shipped settle recipe compiles to its pin (' + settle.length + ' bytes, ' + SETTLE_WIRE.PROGRAM_HASH + ')');
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
  // Force the packaged path: with SAUCE_* unset the resolver must find the shipped binary, which is
  // exactly what a credential-less consumer sees.
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
  // Check emitted declarations from a real install, not src/. Bare source globals
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
} finally {
  rmSync(work, { recursive: true, force: true });
}

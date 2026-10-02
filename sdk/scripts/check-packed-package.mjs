#!/usr/bin/env node
// Exercise the published entry points from a clean consumer, without workspace
// dependencies or a separately installed compiler hiding a broken bundle.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  // The skill's `pay.sauce.ts` names no chain and takes `main(recipient, amount)` at run time.
  const example = join(installedRoot, "skills/sauce-cli/examples/pay.sauce.ts");
  const recipient = "0x6666666666666666666666666666666666666666";
  const owner = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  const chain = ["--chain", "ethereum"];
  const args = ["--args", recipient, "1000000"];
  const bytecode = sauce("compile", example, ...chain).trim();
  assert.match(bytecode, /^0x[0-9a-f]+$/, "sauce compile prints the program as hex");
  const compiled = JSON.parse(sauce("compile", example, ...chain, "--json"));
  const installedCompiler = JSON.parse(
    readFileSync(join(work, "node_modules/sauce-compiler/package.json"), "utf8"),
  );
  assert.equal(compiled.bytecode, bytecode);
  assert.equal(compiled.chain, "ethereum", "--chain chose the chain");
  assert.deepEqual(
    compiled.entryParams,
    [
      { name: "recipient", type: "Address" },
      { name: "amount", type: "Uint256" },
    ],
    "main's parameters, as --args takes them",
  );
  assert.equal(compiled.compiler.version, installedCompiler.version);
  assert.equal(compiled.engine.release, "v12-evm");
  const pot = JSON.parse(sauce("pot", "--owner", owner, "--chain", "ethereum"));
  assert.equal(pot.to, pot.kitchen, "sauce pot prints the Kitchen.deployPot transaction");
  const tx = JSON.parse(sauce("tx", example, ...chain, "--owner", owner, "--value", "0", ...args));
  assert.deepEqual(Object.keys(tx), ["chainId", "to", "data", "value"], "sauce tx prints the tx");
  assert.equal(tx.to, pot.pot, "sauce tx cooks on the Pot sauce pot predicts");
  assert.ok(tx.data.includes(bytecode.slice(2)), "the cook carries the compiled program");
  assert.ok(tx.data.includes(recipient.slice(2)), "and main's arguments after it");
  assert.equal(
    sauce("tx", example, ...chain, "--owner", owner, "--value", "0", "--format", "cast", ...args),
    `cast send ${tx.to} ${tx.data} --value 0 --rpc-url <RPC_URL> --private-key <PRIVATE_KEY>\n`,
  );
  console.log(
    `Clean package install: the sauce bin compiles the shipped example (${compiled.size} bytes) ` +
      `and builds its Pot and cook transactions`,
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
  assert.match(lowered[0].source, /UniswapV3\.Factory\.getPool\(USDC, WETH, 500n\)/);
  const actionsTx = JSON.parse(
    sauce("tx", document, ...chain, "--owner", owner, "--value", "0", "--args", "1000000"),
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
  assert.deepEqual(
    scaffoldedManifest.dependencies,
    { [name]: installedManifest.version },
    "sauce init pins the package to exactly the version that ran it",
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

  // `sauce mcp`, from the install, the way the guide launches it — `npx @eco-incorp/sauce mcp`,
  // here with `--no` so nothing is fetched — over both transports: the tools, a compile, and every
  // shipped skill file as a resource. Nothing here reaches a chain.
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
  const mcpServer = (args, stdio) =>
    spawn("npx", [...mcpLaunch, ...args], { cwd: work, env: smokeEnv, stdio, detached: true });
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
  const stdio = mcpServer([], ["pipe", "pipe", "inherit"]);
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
}

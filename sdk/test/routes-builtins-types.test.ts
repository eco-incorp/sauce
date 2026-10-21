/**
 * A typed route closure that uses SauceScript's builtins typechecks.
 *
 * `Base(() => { ... })` is TypeScript the host compiles before the SDK reads the closure's text, so
 * every name in it has to mean something to `tsc`. The token symbols and protocol namespaces
 * always did (`source-globals.generated.ts`); the language's own builtins did not, and a closure
 * that compiled as SauceScript failed `tsc` on `ctx`, `crypto.keccak256`, `hex`, `Math.mulDiv`,
 * `log`, `require(cond, message)`, `.toBytesBe` and `evm`. They are declared in
 * `routes/builtins.generated.ts`, generated from the SauceScript reference's
 * `skills/sauce-script/references/builtins.json`.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";

const SDK = resolve(process.cwd());
const BUILTINS = JSON.parse(
  readFileSync(resolve(SDK, "../skills/sauce-script/references/builtins.json"), "utf8"),
) as { intrinsics: readonly { name: string; group: string }[] };

/** The closure the report came with: nine `tsc` errors, and it compiles as SauceScript. */
const REPORTED = `
Base(() => {
  const held = USDC.balanceOf(ctx.self());
  const who = ctx.msgSender();
  const digest = crypto.keccak256(hex\`01\`);
  const q = Math.mulDiv(held, 3n, 4n);
  require(held > 0n, "empty");
  log(held.toBytesBe(32n));
  const raw = evm.sload(0n);
  const b = UniswapV3.Factory.getPool(USDC, WETH, 500n);
  const x = chainId;
}, OPTIONS);
`;

/** Every builtin the typings declare, used once, with the type it gives where it gives one. */
const EVERY_BUILTIN = `
Base(() => {
  // ctx
  const caller: bigint = ctx.msgSender();
  const me: bigint = ctx.self();
  const chain: bigint = ctx.chainId();
  const at: bigint = ctx.blockNumber();
  const now: bigint = ctx.timestamp();
  const wei: bigint = ctx.selfBalance();
  const input = ctx.msgData();
  const held: bigint = ctx.balance(me);
  const value: bigint = ctx.msgValue();
  const gas: bigint = ctx.gasLeft();
  const size: bigint = ctx.codeSize(me);
  const codeHash: bigint = ctx.codeHash(me);
  const contract: boolean = ctx.isContract(me);
  const eoa: boolean = ctx.isEOA(caller);

  // crypto
  const topic: bigint = crypto.keccak256("Transfer(address,address,uint256)");
  const signed: boolean = crypto.ecdsaVerify(topic, input, caller);
  const [vault, bump] = crypto.findPDA(me, [hex\`01\`, "vault"]);

  // Math
  const root: bigint = Math.sqrt(held);
  const fee: bigint = Math.mulDiv(held, 30n, 10000n);
  const sum: bigint = Math.addMod(held, fee, 7n) + Math.mulMod(held, fee, 7n);
  const signed2: bigint = Math.sDiv(held, 2n) + Math.sMod(held, 3n) + Math.sShr(held, 1n);
  const extended: bigint = Math.signExtend(held, 2n);
  const order: bigint = Math.sLt(held, 0n) + Math.sGt(held, 0n) + Math.sLte(held, 0n) + Math.sGte(held, 0n);

  // abi
  const encoded = abi.encode(held, caller, input);
  const [amount, to] = abi.decode(encoded, ["Uint256", "Address"]);

  // evm
  const reply = evm.call(to, 0n, encoded);
  const read = evm.static(to, encoded);
  evm.delegate(to, encoded);
  const slot: bigint = evm.sload(0n);
  evm.sstore(0n, slot + 1n);
  const seen: bigint = evm.tload(0n);
  evm.tstore(0n, 1n);
  const made: bigint = evm.create(encoded) + evm.create2(encoded, 1n, 0n) + evm.create3(encoded, 2n);
  const predicted: bigint =
    evm.createAddress(caller, 1n) +
    evm.create2Address(caller, 1n, crypto.keccak256(encoded)) +
    evm.create3Address(2n);

  // svm
  const extra = svm.remainingAccount(0n);
  const rest = svm.remainingAccounts();
  const data = svm.sload(extra, 0n, 8n);
  svm.sstore(extra, 0n, data);
  const returned = svm.call(extra, rest, data);

  // require, revert, throw, log, eval
  require(held > 0n, "empty");
  require(signed);
  log(held.toBytesBe(32n), topic);
  log(input);
  const result = eval(input, held, 1n);
  if (held == 0n) {
    revert();
  }
  if (held == 1n) {
    revert(input);
  }
  if (held == 2n) {
    throw "below floor";
  }

  // methods
  const args = input.slice(4n, 36n);
  const call = args.concat(data, hex\`ff\`, "text");
  const word: bigint = args.toBe() + args.toLe();
  const fields = held.toBytesBe(32n).concat(held.toBytesLe(8n));
  const length: bigint = input.length;

  // account properties
  const key: bigint = extra.address;
  const owner: bigint = extra.owner;
  const dataLen: bigint = extra.dataLen;
  const same: boolean = extra == extra;

  // constructs
  const xs = new Array(3n);
  const selector = hex\`a9059cbb\`;
  const negative: bigint = -held;
  return [chain, at, now, wei, value, gas, size, codeHash, contract, eoa, vault, bump, root, sum,
    signed2, extended, order, amount, reply, read, seen, returned, result, call, word, fields,
    length, key, owner, dataLen, same, xs, selector, negative];
}, OPTIONS);
`;

/** How each builtin is spelled at a use site, where its name is not the spelling. */
const SPELLING: Readonly<Record<string, string>> = {
  throw: "throw ",
  "account.address": ".address",
  "account.owner": ".owner",
  "account.dataLen": ".dataLen",
  "account ==": "extra == extra",
  "new Array": "new Array(",
  "hex literal": "hex`",
  "unary minus": "-held",
  ".length": ".length",
};

/**
 * Typed per ABI, not here: a contract binding and its `.catch()` take their methods from the ABI
 * they bind, which the protocol namespaces' declarations (`source-globals.generated.ts`) type.
 */
const TYPED_ELSEWHERE = new Set(["binding"]);

const GENERATED = resolve(SDK, "src/routes/builtins.generated.ts");

const PRELUDE = `import { Base } from ${JSON.stringify(resolve(SDK, "src/index.ts"))};
declare const OPTIONS: Parameters<typeof Base>[1];
`;

const WRONG_SHAPES = `
Base(() => {
  ctx.msgSender(1n);
  Math.mulDiv(1n, 2n);
  evm.call(1n, 2n);
  const sum: bigint = crypto.keccak256(1n);
  require();
  log();
  ctx.origin();
}, OPTIONS);
`;

const PROBES = { REPORTED, EVERY_BUILTIN, WRONG_SHAPES } as const;
type Probe = keyof typeof PROBES;

/**
 * The host environments a consumer compiles in: browser code, Node code, both, or neither.
 * `crypto`, `Math`, `require` and `eval` are host names in each, so the typings must merge into
 * whatever the lib and `@types` declare under them.
 */
const ENVIRONMENTS = {
  "DOM and Node": { lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], types: ["node"] },
  "Node only": { lib: ["lib.es2022.d.ts"], types: ["node"] },
  "DOM only": { lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], types: [] },
  neither: { lib: ["lib.es2022.d.ts"], types: [] },
} as const;
type Environment = keyof typeof ENVIRONMENTS;

const dir = mkdtempSync(join(tmpdir(), "sauce-builtin-types-"));
const files = Object.fromEntries(
  Object.entries(PROBES).map(([name, source]) => {
    const file = join(dir, `${name}.ts`);
    writeFileSync(file, `${PRELUDE}${source}\nexport {};\n`);
    return [name, file];
  }),
) as Record<Probe, string>;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Parsed once for every environment: each program is the whole SDK, and they share its files. */
const parsed = new Map<string, ts.SourceFile | undefined>();
const checked = new Map<Environment, ts.Program>();

/** One program per environment, holding every probe. */
function programFor(environment: Environment): ts.Program {
  const existing = checked.get(environment);
  if (existing !== undefined) return existing;
  const env = ENVIRONMENTS[environment];
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
    lib: [...env.lib],
    types: [...env.types],
  };
  const host = ts.createCompilerHost(options);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (name, language, ...rest) => {
    if (!parsed.has(name)) parsed.set(name, read(name, language, ...rest));
    return parsed.get(name);
  };
  const program = ts.createProgram(Object.values(files), options, host);
  checked.set(environment, program);
  return program;
}

/** A probe's diagnostics, and the declarations' own, in `environment`. */
function diagnostics(probe: Probe, environment: Environment = "DOM and Node"): string[] {
  const program = programFor(environment);
  return [files[probe], GENERATED]
    .flatMap((path) => program.getSemanticDiagnostics(program.getSourceFile(path)))
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

describe("a typed closure using SauceScript's builtins", () => {
  // One checker per environment is what this suite holds; free each before the next.
  afterAll(() => checked.clear());

  it("typechecks the closure the report came with", () => {
    expect(diagnostics("REPORTED")).toEqual([]);
  });

  it("typechecks every builtin", () => {
    expect(diagnostics("EVERY_BUILTIN")).toEqual([]);
  });

  it("uses every builtin the typings declare", () => {
    for (const { name, group } of BUILTINS.intrinsics) {
      if (TYPED_ELSEWHERE.has(group)) continue;
      const spelling = SPELLING[name] ?? `${name}(`;
      expect([name, EVERY_BUILTIN.includes(spelling)]).toEqual([name, true]);
    }
  });

  it("still rejects a wrong call shape", () => {
    expect(diagnostics("WRONG_SHAPES")).toHaveLength(7);
  });

  it.each(Object.keys(ENVIRONMENTS) as Environment[])("typechecks with %s", (environment) => {
    expect(diagnostics("EVERY_BUILTIN", environment)).toEqual([]);
    checked.delete(environment);
  });
});

test("the generated declarations are reproducible without a build", () => {
  execFileSync(process.execPath, [resolve(SDK, "scripts/gen-builtins.mjs"), "--check"], {
    cwd: SDK,
    stdio: "pipe",
  });
});

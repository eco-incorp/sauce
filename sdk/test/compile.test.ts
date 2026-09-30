/**
 * Comprehensive compilation and structure tests for all SDK protocol SauceScript functions.
 *
 * The corpus is compiled by the published compiler (`@eco-incorp/sauce-compiler` from npm, aliased
 * `sauce-compiler`) — including Tier 1 selector verification, which scans the emitted program for the
 * selector bytes it must contain.
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readdirSync, existsSync, readFileSync } from "fs";
import { compileSauceFunctionRust, computeSelector, extractSelectors } from "./helpers";

const SDK_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROTOCOLS_DIR = join(SDK_ROOT, "src", "protocols");

// ---------------------------------------------------------------------------
// Helpers for discovering protocol functions
// ---------------------------------------------------------------------------

interface ProtocolFunction {
  protocolSlug: string;
  functionName: string;
  sauceScript: string;
}

/**
 * Extract all exported const string values from a functions.ts file.
 * The files export named template literal strings like:
 *   export const supply = `...SauceScript...`;
 */
function extractFunctionsFromFile(filePath: string): Record<string, string> {
  const source = readFileSync(filePath, "utf-8");
  const functions: Record<string, string> = {};

  // Match: export const NAME = `...`;
  // Use a regex to find the start, then extract the template literal content
  const exportRegex = /export\s+const\s+(\w+)\s*=\s*`/g;
  let match;
  while ((match = exportRegex.exec(source)) !== null) {
    const name = match[1];
    const contentStart = match.index + match[0].length;
    // Find the closing backtick (handle escaped backticks)
    let i = contentStart;
    while (i < source.length) {
      if (source[i] === "\\") {
        i += 2;
        continue;
      }
      if (source[i] === "`") break;
      i++;
    }
    if (i < source.length) {
      functions[name] = source.slice(contentStart, i);
    }
  }

  return functions;
}

/**
 * Discover all protocol directories and their SauceScript functions.
 */
function discoverAllProtocolFunctions(): ProtocolFunction[] {
  const allFunctions: ProtocolFunction[] = [];
  const protocolDirs = readdirSync(PROTOCOLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const slug of protocolDirs) {
    const functionsPath = join(PROTOCOLS_DIR, slug, "functions.ts");
    if (!existsSync(functionsPath)) continue;

    const functions = extractFunctionsFromFile(functionsPath);
    for (const [name, script] of Object.entries(functions)) {
      allFunctions.push({ protocolSlug: slug, functionName: name, sauceScript: script });
    }
  }

  return allFunctions;
}

// ---------------------------------------------------------------------------
// 1. SauceScript Compilation Tests
// ---------------------------------------------------------------------------

describe("SauceScript compilation", () => {
  const allFunctions = discoverAllProtocolFunctions();

  // Group by protocol for organized output
  const byProtocol = new Map<string, ProtocolFunction[]>();
  for (const fn of allFunctions) {
    const existing = byProtocol.get(fn.protocolSlug) || [];
    existing.push(fn);
    byProtocol.set(fn.protocolSlug, existing);
  }

  it("discovers functions from all protocols", () => {
    expect(byProtocol.size).toBeGreaterThanOrEqual(100);
    expect(allFunctions.length).toBeGreaterThanOrEqual(200);
  });

  for (const [slug, functions] of byProtocol) {
    describe(slug, () => {
      for (const fn of functions) {
        it(`${fn.functionName} compiles successfully`, () => {
          const protocolDir = join(PROTOCOLS_DIR, slug);

          expect(
            compileSauceFunctionRust(fn.sauceScript, protocolDir).bytecode.length,
          ).toBeGreaterThan(0);
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Tier 1 Selector Verification
// ---------------------------------------------------------------------------

describe("Tier 1 selector verification", () => {
  describe("Uniswap V3", () => {
    it("swap contains exactInputSingle selector", () => {
      const protocolDir = join(PROTOCOLS_DIR, "uniswap-v3");
      const functions = extractFunctionsFromFile(join(protocolDir, "functions.ts"));
      const result = compileSauceFunctionRust(functions.swap, protocolDir);
      const selectors = extractSelectors(result.bytecode);

      // SwapRouter's own signature: the fee is a uint24.
      const expectedSelector = computeSelector(
        "exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))",
      );
      expect(selectors).toContain(expectedSelector);
    });
  });

  describe("Aave V3", () => {
    it("supply contains supply selector", () => {
      const protocolDir = join(PROTOCOLS_DIR, "aave-v3");
      const functions = extractFunctionsFromFile(join(protocolDir, "functions.ts"));
      const result = compileSauceFunctionRust(functions.supply, protocolDir);
      const selectors = extractSelectors(result.bytecode);

      const expectedSelector = computeSelector("supply(address,uint256,address,uint16)");
      expect(selectors).toContain(expectedSelector);
    });

    it("borrow contains borrow selector", () => {
      const protocolDir = join(PROTOCOLS_DIR, "aave-v3");
      const functions = extractFunctionsFromFile(join(protocolDir, "functions.ts"));
      const result = compileSauceFunctionRust(functions.borrow, protocolDir);
      const selectors = extractSelectors(result.bytecode);

      const expectedSelector = computeSelector("borrow(address,uint256,uint256,uint16,address)");
      expect(selectors).toContain(expectedSelector);
    });
  });

  describe("Lido", () => {
    it("submit contains submit selector", () => {
      const protocolDir = join(PROTOCOLS_DIR, "lido");
      const functions = extractFunctionsFromFile(join(protocolDir, "functions.ts"));
      const result = compileSauceFunctionRust(functions.submit, protocolDir);
      const selectors = extractSelectors(result.bytecode);

      const expectedSelector = computeSelector("submit(address)");
      expect(selectors).toContain(expectedSelector);
    });
  });

  describe("Uniswap V2", () => {
    it("swap contains swapExactTokensForTokens selector", () => {
      const protocolDir = join(PROTOCOLS_DIR, "uniswap-v2");
      const functions = extractFunctionsFromFile(join(protocolDir, "functions.ts"));
      const result = compileSauceFunctionRust(functions.swap, protocolDir);
      const selectors = extractSelectors(result.bytecode);

      const expectedSelector = computeSelector(
        "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
      );
      expect(selectors).toContain(expectedSelector);
    });
  });

  // Every token write in the registry is `@sauce/token`'s, which is OpenZeppelin `SafeERC20`. What
  // that does on a chain is `test/std/token/evm.e2e.test.ts`; here, that each template really calls
  // it: the write's own selector, and for `approve` the `allowance` read `forceApprove` resets from.
  describe("token writes are SafeERC20", () => {
    const TOKEN_WRITES: ReadonlyArray<readonly [slug: string, write: string]> = [
      ["erc20", "transfer"],
      ["erc20", "approve"],
      ["erc20", "transferFrom"],
      ...["gho", "frax", "crvusd", "cbeth", "liquity-v2"].flatMap((slug) => [
        [slug, "transfer"] as const,
        [slug, "approve"] as const,
      ]),
    ];
    const SIGNATURES: Record<string, readonly string[]> = {
      transfer: ["transfer(address,uint256)"],
      transferFrom: ["transferFrom(address,address,uint256)"],
      approve: ["approve(address,uint256)", "allowance(address,address)"],
    };
    const hexOf = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

    it.each(TOKEN_WRITES)("%s.%s calls @sauce/token", (slug, write) => {
      const protocolDir = join(PROTOCOLS_DIR, slug);
      const template = extractFunctionsFromFile(join(protocolDir, "functions.ts"))[write]!;
      expect(template).toContain(`import { ${write} } from "@sauce/token";`);
      const code = hexOf(compileSauceFunctionRust(template, protocolDir).bytecode);
      for (const signature of SIGNATURES[write]!) {
        expect(code).toContain(computeSelector(signature).slice(2));
      }
    });

    // The guard against the next typed write: a template that binds an ABI through `.at(...)` and
    // calls an ERC-20 write on it decodes the ABI's `bool`, which reverts on USDT and accepts
    // `false`. Permit2's `approve(address,address,uint160,uint48)` is not an ERC-20 write and passes.
    const ERC20_WRITES = new Set([
      "transfer(address,uint256)",
      "approve(address,uint256)",
      "transferFrom(address,address,uint256)",
    ]);
    type Abi = ReadonlyArray<{ name?: string; inputs?: ReadonlyArray<{ type: string }> }>;

    /** `<binding>.<write>(` and `<Iface>.at(...).<write>(` calls whose ABI declares an ERC-20
     *  write under that name, as `Iface.method`. */
    const typedErc20Writes = (
      script: string,
      abis: Readonly<Record<string, unknown>>,
    ): string[] => {
      const imports = new Map<string, string>(); // local interface name -> ABI export
      for (const m of script.matchAll(
        /import\s*\{\s*(\w+)\s+as\s+(\w+)\s*\}\s*from\s*"\.\/abis"/g,
      )) {
        imports.set(m[2]!, m[1]!);
      }
      const bindings = new Map<string, string>(); // local binding -> ABI export
      for (const m of script.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(\w+)\.at\(/g)) {
        const abi = imports.get(m[2]!);
        if (abi) bindings.set(m[1]!, abi);
      }
      const calls = [
        ...[...script.matchAll(/\b(\w+)\.(transfer|approve|transferFrom)\s*\(/g)].map(
          (m) => [bindings.get(m[1]!), m[2]!] as const,
        ),
        ...[...script.matchAll(/\b(\w+)\.at\([^)]*\)\.(transfer|approve|transferFrom)\s*\(/g)].map(
          (m) => [imports.get(m[1]!), m[2]!] as const,
        ),
      ];
      return calls.flatMap(([abi, method]) => {
        if (!abi) return [];
        const erc20 = ((abis[abi] ?? []) as Abi).some(
          (entry) =>
            entry.name === method &&
            ERC20_WRITES.has(`${method}(${(entry.inputs ?? []).map((i) => i.type).join(",")})`),
        );
        return erc20 ? [`${abi}.${method}`] : [];
      });
    };

    it("the guard fires on the typed spelling it exists to catch", async () => {
      const abis = (await import("../src/protocols/gho/abis.js")) as Record<string, unknown>;
      const typed = `import { GhoTokenABI as IGhoToken } from "./abis";
function main(gho: Address, to: Address, amount: Uint256): Uint256 {
  const t = IGhoToken.at(gho);
  t.transfer(to, amount);
  IGhoToken.at(gho).approve(to, amount);
  return 1;
}`;
      expect(typedErc20Writes(typed, abis)).toEqual([
        "GhoTokenABI.transfer",
        "GhoTokenABI.approve",
      ]);
    });

    it("no template issues an ERC-20 write through a typed binding", async () => {
      const offenders: string[] = [];
      for (const fn of discoverAllProtocolFunctions()) {
        if (!/\.(transfer|approve|transferFrom)\s*\(/.test(fn.sauceScript)) continue;
        const abis = (await import(join(PROTOCOLS_DIR, fn.protocolSlug, "abis.ts"))) as Record<
          string,
          unknown
        >;
        for (const write of typedErc20Writes(fn.sauceScript, abis)) {
          offenders.push(`${fn.protocolSlug}.${fn.functionName}: ${write}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Registry Functions
// ---------------------------------------------------------------------------

describe("protocol registry", () => {
  // Dynamic import since the registry uses .js extensions in imports. `typeof import(...)` gives
  // each binding the module's OWN type, so these are checked rather than being `Function`/`any`.
  type Registry = typeof import("../src/protocols/index.js");
  let protocols: Registry["protocols"];
  let getProtocol: Registry["getProtocol"];
  let listProtocols: Registry["listProtocols"];
  let getProtocolsByCategory: Registry["getProtocolsByCategory"];
  let getProtocolsByChain: Registry["getProtocolsByChain"];
  let listProtocolSlugs: Registry["listProtocolSlugs"];

  beforeAll(async () => {
    const mod = await import("../src/protocols/index.js");
    protocols = mod.protocols;
    getProtocol = mod.getProtocol;
    listProtocols = mod.listProtocols;
    getProtocolsByCategory = mod.getProtocolsByCategory;
    getProtocolsByChain = mod.getProtocolsByChain;
    listProtocolSlugs = mod.listProtocolSlugs;
  });

  it("getProtocol returns valid ProtocolInfo for uniswap-v3", () => {
    const info = getProtocol("uniswap-v3");
    if (info === undefined) throw new Error("uniswap-v3 must be in the registry");
    expect(info.name).toBe("Uniswap V3");
    expect(info.slug).toBe("uniswap-v3");
    expect(info.category).toBe("dex");
    expect(info.website).toBeTruthy();
    expect(info.chains.length).toBeGreaterThan(0);
  });

  it("getProtocol returns valid ProtocolInfo for aave-v3", () => {
    const info = getProtocol("aave-v3");
    if (info === undefined) throw new Error("aave-v3 must be in the registry");
    expect(info.name).toBe("Aave V3");
    expect(info.slug).toBe("aave-v3");
    expect(info.category).toBe("lending");
  });

  it("getProtocol returns undefined for nonexistent protocol", () => {
    expect(getProtocol("nonexistent-protocol")).toBeUndefined();
  });

  it("listProtocols returns 114 protocols", () => {
    const all = listProtocols();
    expect(all.length).toBeGreaterThanOrEqual(114);
  });

  it("listProtocolSlugs returns all slugs", () => {
    const slugs = listProtocolSlugs();
    expect(slugs.length).toBeGreaterThanOrEqual(114);
    expect(slugs).toContain("uniswap-v3");
    expect(slugs).toContain("aave-v3");
    expect(slugs).toContain("lido");
  });

  it("getProtocolsByCategory returns only DEX protocols", () => {
    const dexProtocols = getProtocolsByCategory("dex");
    expect(dexProtocols.length).toBeGreaterThan(10);
    for (const p of dexProtocols) {
      expect(p.category).toBe("dex");
    }
  });

  it("getProtocolsByCategory returns only lending protocols", () => {
    const lendingProtocols = getProtocolsByCategory("lending");
    expect(lendingProtocols.length).toBeGreaterThan(5);
    for (const p of lendingProtocols) {
      expect(p.category).toBe("lending");
    }
  });

  it("getProtocolsByChain returns Ethereum protocols", () => {
    const ethProtocols = getProtocolsByChain(1);
    expect(ethProtocols.length).toBeGreaterThan(20);
    for (const p of ethProtocols) {
      expect(p.chains.some((c) => c.chainId === 1)).toBe(true);
    }
  });

  it("getProtocolsByChain returns Arbitrum protocols", () => {
    const arbProtocols = getProtocolsByChain(42161);
    expect(arbProtocols.length).toBeGreaterThan(5);
    for (const p of arbProtocols) {
      expect(p.chains.some((c) => c.chainId === 42161)).toBe(true);
    }
  });

  it("every protocol in registry has valid shape", () => {
    for (const [slug, info] of Object.entries(protocols)) {
      expect(info.name).toBeTruthy();
      expect(info.slug).toBe(slug);
      expect(info.description).toBeTruthy();
      expect(info.website).toBeTruthy();
      expect(info.category).toBeTruthy();
      expect(Array.isArray(info.chains)).toBe(true);
      expect(typeof info.audited).toBe("boolean");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Module Structure Consistency
// ---------------------------------------------------------------------------

describe("module structure", () => {
  const protocolDirs = readdirSync(PROTOCOLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  it("has 114 protocol directories", () => {
    expect(protocolDirs.length).toBeGreaterThanOrEqual(114);
  });

  const requiredFiles = ["info.ts", "addresses.ts", "abis.ts", "functions.ts", "index.ts"];

  for (const slug of protocolDirs) {
    describe(slug, () => {
      for (const file of requiredFiles) {
        it(`has ${file}`, () => {
          const filePath = join(PROTOCOLS_DIR, slug, file);
          expect(existsSync(filePath)).toBe(true);
        });
      }

      it("info.ts exports protocolInfo", () => {
        const infoPath = join(PROTOCOLS_DIR, slug, "info.ts");
        const source = readFileSync(infoPath, "utf-8");
        expect(source).toContain("export const protocolInfo");
      });

      it("addresses.ts exports deployments", () => {
        const addrPath = join(PROTOCOLS_DIR, slug, "addresses.ts");
        const source = readFileSync(addrPath, "utf-8");
        expect(source).toContain("export const deployments");
      });

      it("functions.ts has at least one exported function", () => {
        const funcPath = join(PROTOCOLS_DIR, slug, "functions.ts");
        const functions = extractFunctionsFromFile(funcPath);
        expect(Object.keys(functions).length).toBeGreaterThanOrEqual(1);
      });

      it("abis.ts has at least one export", () => {
        const abisPath = join(PROTOCOLS_DIR, slug, "abis.ts");
        const source = readFileSync(abisPath, "utf-8");
        expect(source).toContain("export const");
      });
    });
  }
});

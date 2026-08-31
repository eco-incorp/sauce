/**
 * Comprehensive compilation and structure tests for all SDK protocol SauceScript functions.
 *
 * The corpus is written for the RUST compiler, so that is what compiles it here — the published
 * `@eco-incorp/sauce-compiler` from npm, aliased `sauce-next`. Tier 1 selector
 * verification still runs through the in-repo TypeScript compiler, which is what can read a
 * segment's bytes.
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync, existsSync, readFileSync } from 'fs';
import { compileSauceFunction, compileSauceFunctionRust, computeSelector, extractSelectors } from './helpers';

const SDK_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROTOCOLS_DIR = join(SDK_ROOT, 'src', 'protocols');

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
  const source = readFileSync(filePath, 'utf-8');
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
      if (source[i] === '\\') { i += 2; continue; }
      if (source[i] === '`') break;
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
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  for (const slug of protocolDirs) {
    const functionsPath = join(PROTOCOLS_DIR, slug, 'functions.ts');
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

describe('SauceScript compilation', () => {
  const allFunctions = discoverAllProtocolFunctions();

  // Group by protocol for organized output
  const byProtocol = new Map<string, ProtocolFunction[]>();
  for (const fn of allFunctions) {
    const existing = byProtocol.get(fn.protocolSlug) || [];
    existing.push(fn);
    byProtocol.set(fn.protocolSlug, existing);
  }

  it('discovers functions from all protocols', () => {
    expect(byProtocol.size).toBeGreaterThanOrEqual(100);
    expect(allFunctions.length).toBeGreaterThanOrEqual(200);
  });

  for (const [slug, functions] of byProtocol) {
    describe(slug, () => {
      for (const fn of functions) {
        it(`${fn.functionName} compiles successfully`, () => {
          const protocolDir = join(PROTOCOLS_DIR, slug);

          expect(compileSauceFunctionRust(fn.sauceScript, protocolDir).bytecode.length).toBeGreaterThan(0);
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Tier 1 Selector Verification
// ---------------------------------------------------------------------------

describe('Tier 1 selector verification', () => {
  describe('Uniswap V3', () => {
    it('swap contains exactInputSingle selector', () => {
      const protocolDir = join(PROTOCOLS_DIR, 'uniswap-v3');
      const functions = extractFunctionsFromFile(join(protocolDir, 'functions.ts'));
      const result = compileSauceFunction(functions.swap, protocolDir);
      const selectors = extractSelectors(result.bytecode);

      // ABI uses uint32 (widened from Solidity's uint24 for compiler compatibility)
      const expectedSelector = computeSelector(
        'exactInputSingle((address,address,uint32,address,uint256,uint256,uint256,uint160))'
      );
      expect(selectors).toContain(expectedSelector);
    });
  });

  describe('Aave V3', () => {
    it('supply contains supply selector', () => {
      const protocolDir = join(PROTOCOLS_DIR, 'aave-v3');
      const functions = extractFunctionsFromFile(join(protocolDir, 'functions.ts'));
      const result = compileSauceFunction(functions.supply, protocolDir);
      const selectors = extractSelectors(result.bytecode);

      const expectedSelector = computeSelector('supply(address,uint256,address,uint16)');
      expect(selectors).toContain(expectedSelector);
    });

    it('borrow contains borrow selector', () => {
      const protocolDir = join(PROTOCOLS_DIR, 'aave-v3');
      const functions = extractFunctionsFromFile(join(protocolDir, 'functions.ts'));
      const result = compileSauceFunction(functions.borrow, protocolDir);
      const selectors = extractSelectors(result.bytecode);

      const expectedSelector = computeSelector('borrow(address,uint256,uint256,uint16,address)');
      expect(selectors).toContain(expectedSelector);
    });
  });

  describe('Lido', () => {
    it('submit contains submit selector', () => {
      const protocolDir = join(PROTOCOLS_DIR, 'lido');
      const functions = extractFunctionsFromFile(join(protocolDir, 'functions.ts'));
      const result = compileSauceFunction(functions.submit, protocolDir);
      const selectors = extractSelectors(result.bytecode);

      const expectedSelector = computeSelector('submit(address)');
      expect(selectors).toContain(expectedSelector);
    });
  });

  describe('Uniswap V2', () => {
    it('swap contains swapExactTokensForTokens selector', () => {
      const protocolDir = join(PROTOCOLS_DIR, 'uniswap-v2');
      const functions = extractFunctionsFromFile(join(protocolDir, 'functions.ts'));
      const result = compileSauceFunction(functions.swap, protocolDir);
      const selectors = extractSelectors(result.bytecode);

      const expectedSelector = computeSelector(
        'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)'
      );
      expect(selectors).toContain(expectedSelector);
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Registry Functions
// ---------------------------------------------------------------------------

describe('protocol registry', () => {
  // Dynamic import since the registry uses .js extensions in imports
  let protocols: Record<string, any>;
  let getProtocol: Function;
  let listProtocols: Function;
  let getProtocolsByCategory: Function;
  let getProtocolsByChain: Function;
  let listProtocolSlugs: Function;

  beforeAll(async () => {
    const mod = await import('../src/protocols/index.js');
    protocols = mod.protocols;
    getProtocol = mod.getProtocol;
    listProtocols = mod.listProtocols;
    getProtocolsByCategory = mod.getProtocolsByCategory;
    getProtocolsByChain = mod.getProtocolsByChain;
    listProtocolSlugs = mod.listProtocolSlugs;
  });

  it('getProtocol returns valid ProtocolInfo for uniswap-v3', () => {
    const info = getProtocol('uniswap-v3');
    expect(info).toBeDefined();
    expect(info.name).toBe('Uniswap V3');
    expect(info.slug).toBe('uniswap-v3');
    expect(info.category).toBe('dex');
    expect(info.website).toBeTruthy();
    expect(info.chains.length).toBeGreaterThan(0);
  });

  it('getProtocol returns valid ProtocolInfo for aave-v3', () => {
    const info = getProtocol('aave-v3');
    expect(info).toBeDefined();
    expect(info.name).toBe('Aave V3');
    expect(info.slug).toBe('aave-v3');
    expect(info.category).toBe('lending');
  });

  it('getProtocol returns undefined for nonexistent protocol', () => {
    expect(getProtocol('nonexistent-protocol')).toBeUndefined();
  });

  it('listProtocols returns 114 protocols', () => {
    const all = listProtocols();
    expect(all.length).toBeGreaterThanOrEqual(114);
  });

  it('listProtocolSlugs returns all slugs', () => {
    const slugs = listProtocolSlugs();
    expect(slugs.length).toBeGreaterThanOrEqual(114);
    expect(slugs).toContain('uniswap-v3');
    expect(slugs).toContain('aave-v3');
    expect(slugs).toContain('lido');
  });

  it('getProtocolsByCategory returns only DEX protocols', () => {
    const dexProtocols = getProtocolsByCategory('dex');
    expect(dexProtocols.length).toBeGreaterThan(10);
    for (const p of dexProtocols) {
      expect(p.category).toBe('dex');
    }
  });

  it('getProtocolsByCategory returns only lending protocols', () => {
    const lendingProtocols = getProtocolsByCategory('lending');
    expect(lendingProtocols.length).toBeGreaterThan(5);
    for (const p of lendingProtocols) {
      expect(p.category).toBe('lending');
    }
  });

  it('getProtocolsByChain returns Ethereum protocols', () => {
    const ethProtocols = getProtocolsByChain(1);
    expect(ethProtocols.length).toBeGreaterThan(20);
    for (const p of ethProtocols) {
      expect(p.chains.some((c: any) => c.chainId === 1)).toBe(true);
    }
  });

  it('getProtocolsByChain returns Arbitrum protocols', () => {
    const arbProtocols = getProtocolsByChain(42161);
    expect(arbProtocols.length).toBeGreaterThan(5);
    for (const p of arbProtocols) {
      expect(p.chains.some((c: any) => c.chainId === 42161)).toBe(true);
    }
  });

  it('every protocol in registry has valid shape', () => {
    for (const [slug, info] of Object.entries(protocols)) {
      expect(info.name).toBeTruthy();
      expect(info.slug).toBe(slug);
      expect(info.description).toBeTruthy();
      expect(info.website).toBeTruthy();
      expect(info.category).toBeTruthy();
      expect(Array.isArray(info.chains)).toBe(true);
      expect(typeof info.audited).toBe('boolean');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Module Structure Consistency
// ---------------------------------------------------------------------------

describe('module structure', () => {
  const protocolDirs = readdirSync(PROTOCOLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  it('has 114 protocol directories', () => {
    expect(protocolDirs.length).toBeGreaterThanOrEqual(114);
  });

  const requiredFiles = ['info.ts', 'addresses.ts', 'abis.ts', 'functions.ts', 'index.ts'];

  for (const slug of protocolDirs) {
    describe(slug, () => {
      for (const file of requiredFiles) {
        it(`has ${file}`, () => {
          const filePath = join(PROTOCOLS_DIR, slug, file);
          expect(existsSync(filePath)).toBe(true);
        });
      }

      it('info.ts exports protocolInfo', () => {
        const infoPath = join(PROTOCOLS_DIR, slug, 'info.ts');
        const source = readFileSync(infoPath, 'utf-8');
        expect(source).toContain('export const protocolInfo');
      });

      it('addresses.ts exports deployments', () => {
        const addrPath = join(PROTOCOLS_DIR, slug, 'addresses.ts');
        const source = readFileSync(addrPath, 'utf-8');
        expect(source).toContain('export const deployments');
      });

      it('functions.ts has at least one exported function', () => {
        const funcPath = join(PROTOCOLS_DIR, slug, 'functions.ts');
        const functions = extractFunctionsFromFile(funcPath);
        expect(Object.keys(functions).length).toBeGreaterThanOrEqual(1);
      });

      it('abis.ts has at least one export', () => {
        const abisPath = join(PROTOCOLS_DIR, slug, 'abis.ts');
        const source = readFileSync(abisPath, 'utf-8');
        expect(source).toContain('export const');
      });
    });
  }
});

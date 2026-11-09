/**
 * A name looked up without its argument count finds the overload it found before the registry took
 * its deployments' full ABIs.
 *
 * `methodOf`/`selectorOf` with no arity and a hand-written `abi.find((e) => e.name === name)` take
 * a name's first overload. The full ABIs added overloads to names the registry already declared
 * (UniswapV4's `execute(bytes,bytes[])`, Aave V3's `supply(bytes32)`), so `gen-registry-abis.mjs`
 * keeps each name's overloads the registry declared then first, in their order then
 * (`fixtures/registry-abi/baseline-order.json`, the twins of main at 92af3e34), ahead of any it
 * added. These hold every export, its twin, every descriptor and each chain's view of it to that.
 * (viem's `getAbiItem` with no arguments prefers an overload that takes none, wherever it is: so
 * Convex's `getReward()`, which the full ABI added, is what it finds for `getReward`.)
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toFunctionSelector, toFunctionSignature, type Abi, type AbiFunction } from "viem";

import { requireChain } from "../src/chains/canonical.js";
import { descriptorOn } from "../src/descriptors/derive.js";
import { DESCRIPTORS, methodOf, selectorOf } from "../src/descriptors/index.js";

const SDK = join(dirname(fileURLToPath(import.meta.url)), "..");
const baseline = JSON.parse(
  readFileSync(join(SDK, "test", "fixtures", "registry-abi", "baseline-order.json"), "utf8"),
) as { readonly commit: string; readonly exports: Readonly<Record<string, readonly string[]>> };

const nameOf = (signature: string): string => signature.slice(0, signature.indexOf("("));
/** Each name's overloads `signatures` lists, in their order there. */
function byName(signatures: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const signature of signatures) {
    out.set(nameOf(signature), [...(out.get(nameOf(signature)) ?? []), signature]);
  }
  return out;
}
const functionsOf = (abi: Abi): string[] =>
  abi.flatMap((item) => (item.type === "function" ? [toFunctionSignature(item)] : []));

/** Each export's ABI as `abis.ts` exports it and as its JSON twin holds it: every protocol of the
 *  baseline, so the module is chosen at run time, as `registry-abi.test.ts` loads them. */
const exportsOf = await Promise.all(
  Object.keys(baseline.exports).map(async (key) => {
    const [slug, name] = key.split(".") as [string, string];
    const module = (await import(`../src/protocols/${slug}/abis.js`)) as Record<string, unknown>;
    const twinPath = join(SDK, "src", "protocols", slug, `${name}.json`);
    const twin = existsSync(twinPath)
      ? (JSON.parse(readFileSync(twinPath, "utf8")) as { abi: Abi }).abi
      : undefined;

    return { key, exported: module[name] as Abi | undefined, twin };
  }),
);

describe("a name's first overload is the one it was before the full ABIs", () => {
  it("the baseline is main's 232 twins", () => {
    expect(baseline.commit).toBe("92af3e340a94cda16a7d6b30cc830e2a8f1e5f3e");
    expect(Object.keys(baseline.exports)).toHaveLength(232);
  });

  it.each(exportsOf.map((e) => [e.key, e] as const))(
    "%s: each name's overloads declared before come first, in that order, in abis.ts and its twin",
    (_key, { key, exported, twin }) => {
      expect(exported).toBeDefined();
      expect(twin).toBeDefined();
      const before = byName(baseline.exports[key]!);
      for (const abi of [exported!, twin!]) {
        const now = byName(functionsOf(abi));
        for (const [name, overloads] of before) {
          expect([key, name, now.get(name)?.slice(0, overloads.length)]).toEqual([
            key,
            name,
            overloads,
          ]);
          // The first function of the name, as a lookup by name alone finds it.
          const first = abi.find(
            (item): item is AbiFunction => item.type === "function" && item.name === name,
          );
          expect([key, name, first && toFunctionSignature(first)]).toEqual([
            key,
            name,
            overloads[0],
          ]);
        }
      }
    },
  );

  it("methodOf and selectorOf without an argument count find it on every descriptor, and on each chain that runs it", () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const descriptor of DESCRIPTORS) {
      const before = baseline.exports[`${descriptor.protocol}.${descriptor.abiExport}`];
      if (before === undefined) continue;
      for (const [name, overloads] of byName(before)) {
        const first = overloads[0]!;
        checked++;
        const at = `${descriptor.protocol}.${descriptor.contract}.${name}`;
        if (methodOf(descriptor, name)?.signature !== first) {
          wrong.push(`${at}: ${methodOf(descriptor, name)?.signature}, was ${first}`);
        }
        if (selectorOf(descriptor, name) !== toFunctionSelector(first)) {
          wrong.push(`${at}: selector ${selectorOf(descriptor, name)}`);
        }
        // A chain's view keeps the order; where its deployment runs the overload, it is first there.
        for (const slug of descriptor.chains) {
          const view = descriptorOn(descriptor, requireChain(slug).id);
          if (!view.methods.some((m) => m.signature === first)) continue;
          if (methodOf(view, name)?.signature !== first) {
            wrong.push(`${at} on ${slug}: ${methodOf(view, name)?.signature}, was ${first}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(checked).toBeGreaterThan(700);
  });

  it.each([
    ["aave-v3", "Pool", "supply", "0x617ba037"],
    ["aave-v3", "Pool", "withdraw", "0x69328dec"],
    ["aave-v3", "Pool", "borrow", "0xa415bcad"],
    ["aave-v3", "Pool", "repay", "0x573ade81"],
    ["aave-v3", "Pool", "liquidationCall", "0x00a718a9"],
    ["permit2", "Permit2", "transferFrom", "0x36c78516"],
    ["uniswap-v4", "UniversalRouter", "execute", "0x3593564c"],
  ])("%s.%s.%s is %s with no argument count, as before", (protocol, contract, name, selector) => {
    const descriptor = DESCRIPTORS.find((d) => d.protocol === protocol && d.contract === contract)!;
    expect(selectorOf(descriptor, name)).toBe(selector);
  });
});

/**
 * A contract's function called by its canonical signature, `<Contract>["<signature>"](…)`: the one
 * way to reach a function the registry ABI leaves out for its name or arity alone (a second
 * overload taking as many arguments, a name the accessors keep: `ContractDescriptor.bySignature`),
 * and a spelling of every other. The protocol rewrite binds an ABI of that one function and calls
 * it by name (`protocol-rewrite.ts`, shape H), so it compiles to the bytes the call by name does;
 * the names check refuses a signature no function has and one the chain's deployment does not run
 * (`absent-names.ts`, `method-refusals.ts#signatureRefusal`).
 */
import { createHash } from "node:crypto";
import { toFunctionSelector, toFunctionSignature, type AbiFunction } from "viem";
import { requireChain } from "../src/chains/canonical.js";
import { descriptorOn } from "../src/descriptors/derive.js";
import { getDescriptor } from "../src/descriptors/query.js";
import { rewriteProtocolAccessors } from "../src/routes/protocol-rewrite.js";
import { compileSauceProgram, type SauceProgramOptions } from "../src/routes/sauce-route.js";

const hex = (chain: string, source: string, options: SauceProgramOptions = {}): string =>
  Buffer.from(compileSauceProgram(chain, source, options).bytecode).toString("hex");

/** The message `source` is refused with on `chain`. */
function refusal(chain: string, source: string): string {
  try {
    compileSauceProgram(chain, source);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`compiled on ${chain}: ${source}`);
}

/** `descriptor`'s function with `signature`: one of its ABI's, or one called by signature only. */
function fragment(protocol: string, contract: string, signature: string): AbiFunction {
  const descriptor = getDescriptor(protocol, contract)!;
  const found = [
    ...descriptor.abi.filter((item): item is AbiFunction => item.type === "function"),
    ...descriptor.bySignature,
  ].find((fn) => toFunctionSignature(fn) === signature);
  if (found === undefined) throw new Error(`${protocol}.${contract} has no ${signature}`);
  return found;
}

const ETHEREUM = requireChain("ethereum");
const BASE = requireChain("base");

const BATCH =
  "permitTransferFrom(((address,uint256)[],uint256,uint256),(address,uint256)[],address,bytes)";
const SINGLE =
  "permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes)";
/** Permit2's batch transfer, called as `callee` spells it. */
const batch = (callee: string): string => `function main(owner: Address, signature: bytes) {
  ${callee}(
    { permitted: [{ token: USDC, amount: 1000 }, { token: WETH, amount: 2000 }], nonce: 7, deadline: 4102444800 },
    [{ to: owner, requestedAmount: 1000 }, { to: owner, requestedAmount: 2000 }],
    owner,
    signature,
  );
}`;
/** Permit2's single transfer, called as `callee` spells it. */
const single = (callee: string): string => `function main(owner: Address, signature: bytes) {
  ${callee}(
    { permitted: { token: USDC, amount: 1000 }, nonce: 7, deadline: 4102444800 },
    { to: owner, requestedAmount: 1000 },
    owner,
    signature,
  );
}`;

describe("a function the ABI leaves out by arity, called by its signature", () => {
  it("Permit2's batch permitTransferFrom is not in the ABI, and is carried to be called by signature", () => {
    const permit2 = getDescriptor("permit2", "Permit2")!;
    expect(permit2.methods.map((m) => m.signature)).toContain(SINGLE);
    expect(permit2.methods.map((m) => m.signature)).not.toContain(BATCH);
    expect(permit2.bySignature.map((fn) => toFunctionSignature(fn))).toContain(BATCH);
  });

  it("compiles, its selector in the bytecode, as the binding of that one function written by hand", () => {
    const bytecode = hex("ethereum", batch(`Permit2.Permit2["${BATCH}"]`));
    expect(toFunctionSelector(BATCH)).toBe("0xedd9444b");
    expect(bytecode).toContain("edd9444b");
    expect(bytecode).not.toContain(toFunctionSelector(SINGLE).slice(2));
    expect(bytecode).toBe(
      hex("ethereum", batch("IBatch.at(Permit2.Permit2).permitTransferFrom"), {
        contracts: { IBatch: { abi: [fragment("permit2", "Permit2", BATCH)] } },
      }),
    );
  });

  it("is lowered to a binding of that one function, named for the contract and the selector", () => {
    const source = `function main() { ${`Permit2.Permit2["${BATCH}"]`}(a, b, c, d); Permit2.Permit2["${BATCH}"](a, b, c, d); }`;
    const rewritten = rewriteProtocolAccessors(source, ETHEREUM);
    expect(rewritten.source).toBe(
      "function main() { IPermit2_Permit2_edd9444b.at(Permit2.Permit2).permitTransferFrom(a, b, c, d); " +
        "IPermit2_Permit2_edd9444b.at(Permit2.Permit2).permitTransferFrom(a, b, c, d); }",
    );
    expect(rewritten.accessorSites).toBe(2);
    expect(Object.keys(rewritten.contracts)).toEqual(["IPermit2_Permit2_edd9444b"]);
    expect(rewritten.contracts["IPermit2_Permit2_edd9444b"]!.abi).toEqual([
      fragment("permit2", "Permit2", BATCH),
    ]);
    // The same one-function ABI, compile after compile.
    expect(
      rewriteProtocolAccessors(source, ETHEREUM).contracts["IPermit2_Permit2_edd9444b"]!.abi,
    ).toBe(rewritten.contracts["IPermit2_Permit2_edd9444b"]!.abi);
  });

  it("the single form called by name compiles as before: the registry ABI's binding, unchanged", () => {
    const bytecode = hex("ethereum", single("Permit2.Permit2.permitTransferFrom"));
    expect(bytecode).toContain(toFunctionSelector(SINGLE).slice(2));
    expect(bytecode).not.toContain("edd9444b");
    // The bytes this program compiled to before a function could be called by its signature (the
    // pinned compiler's; a compiler release that changes them changes this digest with them).
    expect(createHash("sha256").update(Buffer.from(bytecode, "hex")).digest("hex")).toBe(
      "15e4ed43885b378810247c05dba1f1efd8a8d6753c854e890e5bb0908866192f",
    );
    expect(bytecode).toBe(
      hex("ethereum", single("IPermit2.at(Permit2.Permit2).permitTransferFrom"), {
        contracts: { IPermit2: { abi: getDescriptor("permit2", "Permit2")!.abi } },
      }),
    );
    // And by its signature, the same bytes.
    expect(hex("ethereum", single(`Permit2.Permit2["${SINGLE}"]`))).toBe(bytecode);
  });
});

describe("a function the namespace reaches by name, called by its signature", () => {
  const GET_POOL = "getPool(address,address,uint24)";
  const program = (callee: string, params = ""): string =>
    `function main(${params}) { return ${callee}(WETH, USDC, 500); }`;

  it("compiles to the bytes the call by name does, on the contract, a const, a chain by name and .at", () => {
    const byName = hex("ethereum", program("UniswapV3.Factory.getPool"));
    expect(byName).toContain("1698ee82");
    expect(hex("ethereum", program(`UniswapV3.Factory["${GET_POOL}"]`))).toBe(byName);
    expect(
      hex(
        "ethereum",
        `function main() { const factory = UniswapV3.Factory; const same = factory; return same["${GET_POOL}"](WETH, USDC, 500); }`,
      ),
    ).toBe(byName);
    expect(hex("optimism", program(`Base.UniswapV3.Factory["${GET_POOL}"]`))).toBe(
      hex("optimism", program("Base.UniswapV3.Factory.getPool")),
    );
    expect(
      hex("ethereum", program(`UniswapV3.Factory.at(factory)["${GET_POOL}"]`, "factory: Address")),
    ).toBe(hex("ethereum", program("UniswapV3.Factory.at(factory).getPool", "factory: Address")));
  });

  it("a deployment that declares the function otherwise is called as it declares it, under a binding of its own", () => {
    const rewardConfig = (callee: string): string =>
      `function main(comet: Address): Uint256 { const config = ${callee}(comet); return config.shouldUpscale; }`;
    const rewritten = rewriteProtocolAccessors(
      `function main(comet: Address) { return CompoundV3.CometRewards["rewardConfig(address)"](comet); }`,
      ETHEREUM,
    );
    expect(Object.keys(rewritten.contracts)).toEqual([
      "ICompoundV3_CometRewards_2289b6b8_OnEthereum",
    ]);
    const ethereum = hex(
      "ethereum",
      rewardConfig(`CompoundV3.CometRewards["rewardConfig(address)"]`),
    );
    expect(ethereum).toBe(hex("ethereum", rewardConfig("CompoundV3.CometRewards.rewardConfig")));
    expect(
      Object.keys(
        rewriteProtocolAccessors(
          `function main(comet: Address) { return CompoundV3.CometRewards["rewardConfig(address)"](comet); }`,
          BASE,
        ).contracts,
      ),
    ).toEqual(["ICompoundV3_CometRewards_2289b6b8"]);
  });
});

describe("a function the ABI leaves out by name, called by its signature", () => {
  it('Beefy.Vault(vault)["available()"]() compiles, as the binding of that one function written by hand', () => {
    const bytecode = hex(
      "base",
      `function main(vault: Address): Uint256 { return Beefy.Vault(vault)["available()"](); }`,
    );
    expect(bytecode).toContain("48a0d754");
    expect(bytecode).toBe(
      hex(
        "base",
        `function main(vault: Address): Uint256 { return IAvailable.view(vault).available(); }`,
        {
          contracts: { IAvailable: { abi: [fragment("beefy", "Vault", "available()")] } },
        },
      ),
    );
  });

  it("called by name it is refused, naming its signature", () => {
    expect(
      refusal(
        "base",
        `function main(vault: Address): Uint256 { return Beefy.Vault(vault).available(); }`,
      ),
    ).toContain('It is called by its signature: `Beefy.Vault(…)["available()"](…)`.');
    // A call's `bool` result is a number to the compiler, by name and by signature alike.
    expect(
      refusal("ethereum", `function main(id: Uint256) { return Ens.BaseRegistrar.available(id); }`),
    ).toContain('It is called by its signature: `Ens.BaseRegistrar["available(uint256)"](…)`.');
    expect(
      hex(
        "ethereum",
        `function main(id: Uint256) { return Ens.BaseRegistrar["available(uint256)"](id); }`,
      ),
    ).toContain(toFunctionSelector("available(uint256)").slice(2));
  });
});

describe("a signature refused", () => {
  it("one no function has, naming the nearest", () => {
    const misspelled =
      "permitTransferFrom(((address,uint256)[],uint256,uint256),(address,uint256)[],address)";
    expect(refusal("ethereum", batch(`Permit2.Permit2["${misspelled}"]`))).toContain(
      `\`Permit2.Permit2["${misspelled}"](…)\`: \`${misspelled}\` is not the signature of a function ` +
        `of permit2.Permit2 (15 functions; nearest: ${BATCH}, ${SINGLE}, `,
    );
    // Written with spaces or names, a signature is not the canonical one.
    expect(
      refusal(
        "ethereum",
        `function main() { return UniswapV3.Factory["getPool(address, address, uint24)"](WETH, USDC, 500); }`,
      ),
    ).toContain("nearest: getPool(address,address,uint24)");
    // On a bound contract, the rewrite refuses it alike.
    expect(
      refusal(
        "ethereum",
        `function main(pool: Address) { return UniswapV3.Pool(pool)["slot()"](); }`,
      ),
    ).toContain(
      '`UniswapV3.Pool(…)["slot()"](…)`: `slot()` is not the signature of a function of uniswap-v3.Pool',
    );
  });

  it("one the chain's deployment does not run, naming the chains whose deployment does", () => {
    const getPool = (callee: string): string =>
      `function main(a: Address, b: Address): Address { return ${callee}["getPool(address,address,uint24)"](a, b, 100); }`;
    const slipstream = getDescriptor("aerodrome-slipstream", "CLFactory")!;
    expect(slipstream.bySignatureWithheldOn[BASE.id]).toEqual(["getPool(address,address,uint24)"]);
    expect(descriptorOn(slipstream, BASE.id).bySignature).toEqual([]);
    const arc = requireChain("arc");
    expect(descriptorOn(slipstream, arc.id).bySignature).toEqual(slipstream.bySignature);

    const refused =
      '`AerodromeSlipstream.CLFactory["getPool(address,address,uint24)"](…)`: ' +
      "`getPool(address,address,uint24)` is a function of aerodrome-slipstream.CLFactory, called by " +
      "its signature, but its deployment on base does not run it (as declared); it is on: arc.";
    expect(refusal("base", getPool("AerodromeSlipstream.CLFactory"))).toContain(refused);
    expect(hex("arc", getPool("AerodromeSlipstream.CLFactory"))).toContain("1698ee82");
    // Bound to an address on Base, it is Base's deployment's ABI, which lacks it too.
    expect(
      refusal(
        "base",
        `function main(f: Address, a: Address, b: Address): Address { return AerodromeSlipstream.CLFactory.at(f)["getPool(address,address,uint24)"](a, b, 100); }`,
      ),
    ).toContain("does not run it (as declared); it is on: arc.");
    // By name on Base, getPool is the ABI's own overload, which Base runs.
    expect(
      hex(
        "base",
        "function main(a: Address, b: Address): Address { return AerodromeSlipstream.CLFactory.getPool(a, b, 100); }",
      ),
    ).toContain(toFunctionSelector("getPool(address,address,int24)").slice(2));
  });

  it("a protocol, and a bound contract held in a local, are refused naming what is written instead", () => {
    expect(refusal("ethereum", `function main() { Lido["submit(address)"](0); }`)).toContain(
      `'Lido["submit(address)"](...)' calls a protocol by signature: name its contract, ` +
        `'Lido.<Contract>["submit(address)"](...)'`,
    );
    expect(
      refusal(
        "base",
        `function main(vault: Address): Uint256 { const v = Beefy.Vault(vault); return v["available()"](); }`,
      ),
    ).toContain(
      "'Beefy.Vault(...)' binds a contract to an address, which is not a value — call a method on " +
        "it in the same expression: 'Beefy.Vault(...).<method>(...)', or a function by its " +
        `signature, 'Beefy.Vault(...)["<signature>"](...)'`,
    );
  });
});

/**
 * Sauce-bytecode call builders. Pure data assertions, no compiler / forge / network involved.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { encodeFunctionData, getAddress } from "viem";
import { address, getAddressEncoder } from "@solana/kit";

import { v12Kitchen, v12PotAbi, v12KitchenAbi } from "../src/evm/engine.js";
import { destinationExecutionFee } from "../src/evm/execution-fee.js";
import { v12KitchenAddress, v12SvmEngineProgramId } from "../src/deployments/index.js";
import {
  decodePortalCalldataWithAccounts,
  encodePortalCalldataWithAccounts,
} from "../src/svm/calls.js";
import {
  buildSauceEvmCall,
  buildSauceEvmCalls,
  buildSauceSvmCall,
  buildSauceSvmCalls,
  mergeSvmAccountFlags,
  sauceEvmDeployPotCall,
} from "../src/routes/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// ===========================================================================
// EVM
// ===========================================================================

const POT = "0x1111111111111111111111111111111111111111" as const;
const KITCHEN = "0x2222222222222222222222222222222222222222" as const;
const OWNER = "0x3333333333333333333333333333333333333333" as const;
const SALT = ("0x" + "44".repeat(32)) as `0x${string}`;
/** `cook` names its interpreter per call — see `evm/engine.ts`. */
const ENGINE = "0x6666666666666666666666666666666666666666" as const;

describe("buildSauceEvmCall / buildSauceEvmCalls", () => {
  it("reuses v12Pot.encodeCook verbatim (byte-equal to a local encodeFunctionData)", () => {
    const call = buildSauceEvmCall({ pot: POT, engine: ENGINE, program: "0xdeadbeef" });
    const expected = encodeFunctionData({
      abi: v12PotAbi,
      functionName: "cook",
      args: [ENGINE, "0xdeadbeef"],
    });
    expect(call.data).toBe(expected);
  });

  it("target is the 32-byte left-padded, lowercased Pot address; value defaults to 0n and honours an override", () => {
    const call = buildSauceEvmCall({ pot: POT, engine: ENGINE, program: "0x01" });
    expect(call.target).toBe(("0x" + "00".repeat(12) + POT.slice(2)).toLowerCase());
    expect(call.value).toBe(0n);

    const withValue = buildSauceEvmCall({ pot: POT, engine: ENGINE, program: "0x01", value: 7n });
    expect(withValue.value).toBe(7n);
  });

  it("emits one call per cook, order preserved, all on the same pot", () => {
    const calls = buildSauceEvmCalls({ pot: POT, engine: ENGINE, cooks: ["0x01", "0x02"] });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.data).toBe(
      encodeFunctionData({ abi: v12PotAbi, functionName: "cook", args: [ENGINE, "0x01"] }),
    );
    expect(calls[1]!.data).toBe(
      encodeFunctionData({ abi: v12PotAbi, functionName: "cook", args: [ENGINE, "0x02"] }),
    );
    expect(calls[0]!.target).toBe(calls[1]!.target);
  });
});

describe("sauceEvmDeployPotCall", () => {
  it("encodes deployPot against the given kitchen, matching v12Kitchen.encodeDeployPot", () => {
    const call = sauceEvmDeployPotCall({ owner: OWNER, salt: SALT, kitchen: KITCHEN });
    expect(call.target).toBe(KITCHEN);
    expect(call.data).toBe(
      encodeFunctionData({ abi: v12KitchenAbi, functionName: "deployPot", args: [OWNER, SALT] }),
    );
    expect(call.value).toBe(0n);
  });

  it("defaults to the pinned release Kitchen", () => {
    const call = sauceEvmDeployPotCall({ owner: OWNER, salt: SALT });
    expect(call.target).toBe(v12KitchenAddress());
  });

  it("honours an explicit kitchen override", () => {
    const call = sauceEvmDeployPotCall({ owner: OWNER, salt: SALT, kitchen: KITCHEN });
    expect(call.target).toBe(KITCHEN);
  });
});

describe("the EVM call builders, as a transaction and as a route call", () => {
  // `{ to, data, value }` is the shape of every request the SDK builds for a wallet or an eth_call
  // (`destinationExecutionFee()`); `target` is the call record's field.
  it("name the contract as `to`, checksummed, beside the route call's `target`", () => {
    const deploy = sauceEvmDeployPotCall({ owner: OWNER, salt: SALT, kitchen: KITCHEN });
    expect(deploy).toEqual({
      to: getAddress(KITCHEN),
      target: KITCHEN,
      data: v12Kitchen.encodeDeployPot(OWNER, SALT),
      value: 0n,
    });
    const cook = buildSauceEvmCall({ pot: POT, engine: ENGINE, program: "0x01", value: "7" });
    expect(cook.to).toBe(getAddress(POT));
    expect(cook.target).toBe(("0x" + "00".repeat(12) + POT.slice(2)).toLowerCase());
    expect(cook.value).toBe(7n);
    // The same keys a fee read has, so either goes to a client as it is.
    const fee = destinationExecutionFee(KITCHEN);
    expect(Object.keys(fee).filter((key) => key in deploy)).toEqual(["to", "data"]);
  });
});

// ===========================================================================
// SVM
// ===========================================================================

const PROGRAM = "CuHCniNMWLSkZWBQKon9tudGujZeXJRUwG2PCLDq4ipJ";
const BUFFER = "So11111111111111111111111111111111111111112";
const A1 = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const A2 = address("So11111111111111111111111111111111111111112");
const EXECUTOR = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

describe("encodePortalCalldataWithAccounts / decodePortalCalldataWithAccounts round-trip", () => {
  it("round-trips instructionData, accountCount, and every account meta in order", () => {
    const instructionData = new Uint8Array([1, 2, 3, 4, 5]);
    const accounts = [
      { pubkey: A1, isSigner: true, isWritable: false },
      { pubkey: A2, isSigner: false, isWritable: true },
    ];
    const encoded = encodePortalCalldataWithAccounts({ instructionData, accounts });
    const decoded = decodePortalCalldataWithAccounts(encoded);
    expect(Array.from(decoded.instructionData)).toEqual(Array.from(instructionData));
    expect(decoded.accountCount).toBe(2);
    expect(decoded.accounts).toEqual(accounts);
  });

  it("accountCount includes every account and rejects inconsistent overrides", () => {
    const encodedDefault = encodePortalCalldataWithAccounts({
      instructionData: new Uint8Array([9]),
      accounts: [{ pubkey: A1, isSigner: false, isWritable: false }],
    });
    expect(decodePortalCalldataWithAccounts(encodedDefault).accountCount).toBe(1);

    expect(() =>
      encodePortalCalldataWithAccounts({
        instructionData: new Uint8Array([9]),
        accounts: [{ pubkey: A1, isSigner: false, isWritable: false }],
        accountCount: 5,
      }),
    ).toThrow(/accountCount must equal/);
  });

  it("golden vector: a fixed 2-account envelope, independently checkable as standard Borsh", () => {
    // [u32 data_len][data][u8 account_count][u32 accounts_len][ N x (32 pubkey + 1 isSigner + 1 isWritable) ]
    // NOTE: this pins OUR OWN schema, mirroring routes-encode.test.ts's own golden-vector caveat — it
    // is NOT proof of parity with the deployed Portal program's Anchor serializer.
    const instructionData = new Uint8Array([0xaa, 0xbb, 0xcc]);
    const accounts = [
      { pubkey: A1, isSigner: true, isWritable: false },
      { pubkey: A2, isSigner: false, isWritable: true },
    ];
    const encoded = encodePortalCalldataWithAccounts({ instructionData, accounts });
    const bytes = Buffer.from(encoded.slice(2), "hex");
    const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
    const pk = (addr: string) => Array.from(getAddressEncoder().encode(addr as never));
    const expected = new Uint8Array([
      ...u32le(3),
      0xaa,
      0xbb,
      0xcc,
      0x02,
      ...u32le(2),
      ...pk(A1),
      0x01,
      0x00,
      ...pk(A2),
      0x00,
      0x01,
    ]);
    expect(Array.from(bytes)).toEqual(Array.from(expected));
  });
});

describe("buildSauceSvmCall", () => {
  const baseAccounts = [
    { pubkey: A1, isSigner: true, isWritable: false },
    { pubkey: A2, isSigner: false, isWritable: true },
  ];

  it("target equals the programId's encoding; the default selects the pinned engine release", () => {
    const call = buildSauceSvmCall({ programId: PROGRAM, code: BUFFER, accounts: baseAccounts });
    const expected =
      "0x" + Buffer.from(getAddressEncoder().encode(PROGRAM as never)).toString("hex");
    expect(call.target).toBe(expected);
    expect(call.target.length).toBe(66); // 0x + 64 hex chars = 32 bytes

    const defaulted = buildSauceSvmCall({ code: BUFFER, accounts: baseAccounts });
    const expectedDefault =
      "0x" +
      Buffer.from(getAddressEncoder().encode(v12SvmEngineProgramId() as never)).toString("hex");
    expect(defaulted.target).toBe(expectedDefault);
  });

  it("executor flattening: an account equal to executor is emitted isSigner=false even when the input said true", () => {
    const call = buildSauceSvmCall({
      programId: PROGRAM,
      code: BUFFER,
      accounts: [
        { pubkey: EXECUTOR, isSigner: true, isWritable: false },
        { pubkey: A2, isSigner: false, isWritable: true },
      ],
      executor: EXECUTOR,
    });
    const decoded = decodePortalCalldataWithAccounts(call.data);
    const executorMeta = decoded.accounts.find((a) => a.pubkey === EXECUTOR)!;
    expect(executorMeta.isSigner).toBe(false);
  });

  it("input coercion: base58 string, kit Address, and a duck-typed { toBase58() } all produce identical output", () => {
    const asString = buildSauceSvmCall({
      programId: PROGRAM,
      code: BUFFER,
      accounts: baseAccounts,
    });
    const asAddress = buildSauceSvmCall({
      programId: address(PROGRAM),
      code: address(BUFFER),
      accounts: baseAccounts,
    });
    const asDuckTyped = buildSauceSvmCall({
      programId: { toBase58: () => PROGRAM },
      code: { toBase58: () => BUFFER },
      accounts: baseAccounts,
    });
    expect(asAddress).toEqual(asString);
    expect(asDuckTyped).toEqual(asString);
  });

  it("rejects a nonzero value at build time (before svmCallOf would throw)", () => {
    expect(() =>
      buildSauceSvmCall({ programId: PROGRAM, code: BUFFER, accounts: baseAccounts, value: 1n }),
    ).toThrow(/no value field/);
  });
});

describe("buildSauceSvmCalls (leg-wide flag merge)", () => {
  const SHARED = A1; // distinct from BUFFER, so it never collides with the always-non-signer buffer entry

  it("OR-merges isSigner/isWritable for a pubkey shared across two executions, in BOTH envelopes", () => {
    const calls = buildSauceSvmCalls({
      programId: PROGRAM,
      executions: [
        { code: BUFFER, accounts: [{ pubkey: SHARED, isSigner: false, isWritable: true }] },
        { code: BUFFER, accounts: [{ pubkey: SHARED, isSigner: true, isWritable: false }] },
      ],
    });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const decoded = decodePortalCalldataWithAccounts(call.data);
      const meta = decoded.accounts.find((a) => a.pubkey === SHARED)!;
      expect(meta.isSigner).toBe(true);
      expect(meta.isWritable).toBe(true);
    }
  });

  it("the singular builder merges within its own instruction only (no cross-call effect)", () => {
    const call = buildSauceSvmCall({
      programId: PROGRAM,
      code: BUFFER,
      accounts: [
        { pubkey: SHARED, isSigner: false, isWritable: true },
        { pubkey: SHARED, isSigner: true, isWritable: false },
      ],
    });
    const decoded = decodePortalCalldataWithAccounts(call.data);
    const metas = decoded.accounts.filter((a) => a.pubkey === SHARED);
    expect(metas.every((m) => m.isSigner && m.isWritable)).toBe(true);
  });

  it("mergeSvmAccountFlags computes the same OR-merge directly", () => {
    const merged = mergeSvmAccountFlags([
      { accounts: [{ pubkey: SHARED, isSigner: false, isWritable: true }] },
      { accounts: [{ pubkey: SHARED, isSigner: true, isWritable: false }] },
    ]);
    expect(merged.get(String(SHARED))).toEqual({ isSigner: true, isWritable: true });
  });
});

describe("routes barrel purity: no module reachable from routes/index.ts imports @solana/web3.js", () => {
  function graph(entry: string, seen = new Set<string>()): string[] {
    if (seen.has(entry)) return [];
    seen.add(entry);
    let src: string;
    try {
      src = readFileSync(entry, "utf8");
    } catch {
      return [];
    }
    const out = [entry];
    const specs = new Set<string>();
    for (const m of src.matchAll(/(?:import|export)\b[^'"]*?from\s*['"](\.[^'"]+)['"]/g))
      specs.add(m[1]!);
    for (const m of src.matchAll(/import\s*['"](\.[^'"]+)['"]/g)) specs.add(m[1]!);
    for (const spec of specs) {
      const resolved = spec.endsWith(".js") ? spec.replace(/\.js$/, ".ts") : spec;
      out.push(...graph(resolve(dirname(entry), resolved), seen));
    }
    return out;
  }

  it("never imports the @solana/web3.js package (kit-only + duck-typed addresses)", () => {
    const entry = resolve(HERE, "../src/routes/index.ts");
    const files = graph(entry);
    expect(files.length).toBeGreaterThan(3); // sanity: actually walked the barrel
    const offenders = files.filter((f) =>
      /['"]@solana\/web3\.js['"]/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

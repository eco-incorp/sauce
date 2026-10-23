/**
 * The signed-cook helpers of `src/evm/engine.ts`, held to the Pot's own arithmetic with no chain:
 * each constant re-derived from its definition, the digest assembled the way `Pot.sol#cookSigned`
 * assembles it (the struct hash in assembly, the domain separator its constructor hashes), the
 * calldata decoded back through the Pot's ABI, and the signature rules the Pot applies before
 * `ecrecover`. `signed-cook.e2e.test.ts` runs the same helpers against the released Pot.
 */
import {
  concat,
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  hexToBigInt,
  keccak256,
  numberToHex,
  recoverAddress,
  slice,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { V12_RELEASE_SETS } from "../../src/deployments/releases.js";
import { v12EngineAddress } from "../../src/deployments/v12-addresses.js";
import {
  COOK_NONCES_LOCATION,
  COOK_TYPE,
  COOK_TYPEHASH,
  COOK_TYPES,
  POT_SIGN_DOMAIN,
  cookNonceAt,
  cookNonceMasks,
  cookNonceSlot,
  cookNonceUsed,
  cookNonceWordBit,
  encodeCookSigned,
  encodeInvalidateNonces,
  randomCookNonce,
  signedCookDigest,
  signedCookTypedData,
  signedCookTypedDataJson,
  v12PotAbi,
  verifySignedCook,
  type SignedCookExecution,
} from "../../src/evm/engine.js";

const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const STRANGER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const RELAYER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address;
const POT = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;

const UINT256_MAX = (1n << 256n) - 1n;
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

const COOK: SignedCookExecution = {
  chainId: 8453,
  pot: POT,
  engine: v12EngineAddress() as Address,
  program: "0x60016002013d52",
  value: 3n,
  maxExecutionFee: 5n,
  nonce: 513n,
  deadline: 1_900_000_000n,
  submitter: RELAYER,
};

/** The digest `cookSigned` computes, written out from `Pot.sol`: the domain separator its
 *  constructor hashes, then the struct hash its assembly lays out in eight words, then
 *  `keccak256(0x1901 ‖ domain ‖ structHash)`. Nothing here goes through EIP-712 helpers. */
function potDigest(cook: SignedCookExecution): Hex {
  const domain = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
      ],
      [
        keccak256(
          toHex(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
          ),
        ),
        keccak256(toHex("Sauce Pot")),
        keccak256(toHex("1")),
        BigInt(cook.chainId),
        cook.pot,
      ],
    ),
  );
  const structHash = keccak256(
    concat([
      COOK_TYPEHASH,
      numberToHex(BigInt(cook.engine), { size: 32 }),
      keccak256(cook.program),
      numberToHex(cook.value ?? 0n, { size: 32 }),
      numberToHex(cook.maxExecutionFee, { size: 32 }),
      numberToHex(cook.nonce, { size: 32 }),
      numberToHex(cook.deadline, { size: 32 }),
      numberToHex(BigInt(cook.submitter ?? zeroAddress), { size: 32 }),
    ]),
  );

  return keccak256(concat(["0x1901", domain, structHash]));
}

const sign = (cook: SignedCookExecution, account = OWNER): Promise<Hex> =>
  account.signTypedData(signedCookTypedData(cook));

/** `r ‖ s ‖ v` as three parts. */
const parts = (signature: Hex) => ({
  r: slice(signature, 0, 32),
  s: hexToBigInt(slice(signature, 32, 64)),
  v: hexToBigInt(slice(signature, 64, 65)),
});

describe("signed cook constants", () => {
  it("hashes the Cook type the Pot hashes", () => {
    expect(COOK_TYPEHASH).toBe(keccak256(toHex(COOK_TYPE)));
    expect(COOK_TYPE).toBe(
      `Cook(${COOK_TYPES.Cook.map((field) => `${field.type} ${field.name}`).join(",")})`,
    );
  });

  it("puts the nonce bitmap at the ERC-7201 slot of sauce.storage.CookNonces", () => {
    const location =
      hexToBigInt(
        keccak256(
          encodeAbiParameters(
            [{ type: "uint256" }],
            [hexToBigInt(keccak256(toHex("sauce.storage.CookNonces"))) - 1n],
          ),
        ),
      ) & ~0xffn;
    expect(COOK_NONCES_LOCATION).toBe(numberToHex(location, { size: 32 }));
  });

  it("names the Pot's domain", () => {
    expect(POT_SIGN_DOMAIN).toEqual({ name: "Sauce Pot", version: "1" });
  });
});

describe("signedCookDigest", () => {
  it("is the digest Pot.sol assembles", () => {
    expect(signedCookDigest(COOK)).toBe(potDigest(COOK));
  });

  it("fills in a zero value and anyone as the submitter, as the Pot reads them", () => {
    const { value: _value, submitter: _submitter, ...bare } = COOK;
    expect(signedCookDigest(bare)).toBe(potDigest({ ...bare, value: 0n, submitter: zeroAddress }));
  });

  it("binds every field: changing any one moves the digest", () => {
    const digest = signedCookDigest(COOK);
    const variants: SignedCookExecution[] = [
      { ...COOK, chainId: 1 },
      { ...COOK, pot: STRANGER.address },
      { ...COOK, program: "0x60016002013d53" },
      { ...COOK, value: 4n },
      { ...COOK, maxExecutionFee: 6n },
      { ...COOK, nonce: 514n },
      { ...COOK, deadline: COOK.deadline + 1n },
      { ...COOK, submitter: zeroAddress },
    ];
    for (const variant of variants) {
      expect(signedCookDigest(variant)).not.toBe(digest);
      expect(signedCookDigest(variant)).toBe(potDigest(variant));
    }
  });

  it("is what the owner's typed-data signature recovers to", async () => {
    const signature = await sign(COOK);
    expect(await recoverAddress({ hash: potDigest(COOK), signature })).toBe(OWNER.address);
  });
});

describe("signedCookTypedDataJson", () => {
  it("is eth_signTypedData_v4's spelling of the typed data", () => {
    expect(signedCookTypedDataJson(COOK)).toEqual({
      domain: { name: "Sauce Pot", version: "1", chainId: "8453", verifyingContract: POT },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        Cook: [
          { name: "engine", type: "address" },
          { name: "program", type: "bytes" },
          { name: "value", type: "uint256" },
          { name: "maxExecutionFee", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "submitter", type: "address" },
        ],
      },
      primaryType: "Cook",
      message: {
        engine: getAddress(COOK.engine),
        program: COOK.program,
        value: "3",
        maxExecutionFee: "5",
        nonce: "513",
        deadline: "1900000000",
        submitter: RELAYER,
      },
    });
  });

  it("is plain JSON: it survives a round trip unchanged", () => {
    const json = signedCookTypedDataJson(COOK);
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });

  it("carries the same fields as the viem typed data", () => {
    const typed = signedCookTypedData(COOK);
    const json = signedCookTypedDataJson(COOK);
    expect(json.domain.chainId).toBe(typed.domain.chainId.toString());
    expect(json.domain.verifyingContract).toBe(typed.domain.verifyingContract);
    expect(json.types.Cook).toEqual(typed.types.Cook);
    expect(json.primaryType).toBe(typed.primaryType);
    expect(BigInt(json.message.nonce)).toBe(typed.message.nonce);
    expect(BigInt(json.message.deadline)).toBe(typed.message.deadline);
  });
});

describe("encodeCookSigned", () => {
  it("decodes back, through the Pot's ABI, to the signed cook, sent with exactly its value", async () => {
    const signature = await sign(COOK);
    const tx = encodeCookSigned({ ...COOK, signature });
    expect(tx.to).toBe(POT);
    expect(tx.value).toBe(3n);
    const decoded = decodeFunctionData({ abi: v12PotAbi, data: tx.data });
    expect(decoded.functionName).toBe("cookSigned");
    expect(decoded.args).toEqual([
      getAddress(COOK.engine),
      COOK.program,
      5n,
      513n,
      1_900_000_000n,
      RELAYER,
      signature,
    ]);
  });

  it("sends zero and names anyone when the cook leaves value and submitter out", () => {
    const { value: _value, submitter: _submitter, ...bare } = COOK;
    const tx = encodeCookSigned({ ...bare, signature: "0x1234" });
    expect(tx.value).toBe(0n);
    const decoded = decodeFunctionData({ abi: v12PotAbi, data: tx.data });
    expect(decoded.args?.[5]).toBe(zeroAddress);
  });

  it("refuses a signature that is not hex", () => {
    expect(() => encodeCookSigned({ ...COOK, signature: "nope" as Hex })).toThrow(/signature/);
  });
});

describe("encodeInvalidateNonces", () => {
  it("is invalidateNonces(word, mask) on the Pot", () => {
    const decoded = decodeFunctionData({
      abi: v12PotAbi,
      data: encodeInvalidateNonces(2n, (1n << 1n) | (1n << 255n)),
    });
    expect(decoded.functionName).toBe("invalidateNonces");
    expect(decoded.args).toEqual([2n, (1n << 1n) | (1n << 255n)]);
  });

  it("refuses a word or mask outside 256 bits", () => {
    expect(() => encodeInvalidateNonces(-1n, 1n)).toThrow(/word/);
    expect(() => encodeInvalidateNonces(0n, UINT256_MAX + 1n)).toThrow(/mask/);
  });
});

describe("nonces", () => {
  it("records nonce n at bit n & 255 of word n >> 8", () => {
    expect(cookNonceWordBit(0n)).toEqual({ word: 0n, bit: 0, mask: 1n });
    expect(cookNonceWordBit(255n)).toEqual({ word: 0n, bit: 255, mask: 1n << 255n });
    expect(cookNonceWordBit(256n)).toEqual({ word: 1n, bit: 0, mask: 1n });
    expect(cookNonceWordBit(513n)).toEqual({ word: 2n, bit: 1, mask: 2n });
    expect(cookNonceWordBit(UINT256_MAX)).toEqual({
      word: UINT256_MAX >> 8n,
      bit: 255,
      mask: 1n << 255n,
    });
  });

  it("cookNonceAt is cookNonceWordBit's inverse", () => {
    for (const nonce of [0n, 1n, 255n, 256n, 513n, (1n << 200n) + 17n, UINT256_MAX]) {
      const { word, bit } = cookNonceWordBit(nonce);
      expect(cookNonceAt(word, bit)).toBe(nonce);
    }
  });

  it("cookNonceAt refuses a bit outside a word and a word past 2^248", () => {
    expect(() => cookNonceAt(0n, 256)).toThrow(/bit/);
    expect(() => cookNonceAt(0n, -1)).toThrow(/bit/);
    expect(() => cookNonceAt(0n, 1.5)).toThrow(/bit/);
    expect(() => cookNonceAt(1n << 248n, 0)).toThrow(/word/);
  });

  it("cookNonceWordBit refuses a nonce outside 256 bits", () => {
    expect(() => cookNonceWordBit(-1n)).toThrow(/nonce/);
    expect(() => cookNonceWordBit(UINT256_MAX + 1n)).toThrow(/nonce/);
  });

  it("groups nonces into one (word, mask) per word, every bit named", () => {
    expect(cookNonceMasks([5n, 300n, 0n, 256n, 5n, 511n])).toEqual([
      { word: 0n, mask: (1n << 5n) | 1n },
      { word: 1n, mask: (1n << 44n) | 1n | (1n << 255n) },
    ]);
    expect(cookNonceMasks([])).toEqual([]);
  });

  it("finds word w at keccak256(abi.encode(w, COOK_NONCES_LOCATION))", () => {
    for (const word of [0n, 2n, UINT256_MAX >> 8n]) {
      expect(cookNonceSlot(word)).toBe(
        keccak256(concat([numberToHex(word, { size: 32 }), COOK_NONCES_LOCATION])),
      );
    }
  });

  it("reads a nonce's bit from its word's slot", async () => {
    const slots = new Map<string, Hex>([[cookNonceSlot(2n), numberToHex(2n, { size: 32 })]]);
    const client = {
      getStorageAt: async ({ slot }: { slot: Hex }) => slots.get(slot) ?? `0x${"00".repeat(32)}`,
    } as unknown as Parameters<typeof cookNonceUsed>[0];
    expect(await cookNonceUsed(client, POT, 513n)).toBe(true);
    expect(await cookNonceUsed(client, POT, 512n)).toBe(false);
    expect(await cookNonceUsed(client, POT, 0n)).toBe(false);
  });

  it("draws random nonces across all 256 bits", () => {
    const nonces = Array.from({ length: 64 }, () => randomCookNonce());
    expect(new Set(nonces).size).toBe(64);
    for (const nonce of nonces) {
      expect(nonce >= 0n && nonce <= UINT256_MAX).toBe(true);
    }
    // 64 draws all below 2^248 would be one chance in 2^512: the high byte is drawn too.
    expect(nonces.some((nonce) => nonce >> 248n !== 0n)).toBe(true);
  });
});

describe("verifySignedCook", () => {
  it("accepts the owner's signature", async () => {
    const signature = await sign(COOK);
    expect(await verifySignedCook({ ...COOK, signature, owner: OWNER.address })).toBe(true);
  });

  it("refuses another key's", async () => {
    const signature = await sign(COOK, STRANGER);
    expect(await verifySignedCook({ ...COOK, signature, owner: OWNER.address })).toBe(false);
  });

  it("refuses the owner's signature over another cook", async () => {
    const signature = await sign({ ...COOK, nonce: 514n });
    expect(await verifySignedCook({ ...COOK, signature, owner: OWNER.address })).toBe(false);
  });

  it("refuses the high-s twin, which ecrecover itself accepts", async () => {
    const signature = await sign(COOK);
    const { r, s, v } = parts(signature);
    const twin = concat([
      r,
      numberToHex(SECP256K1_N - s, { size: 32 }),
      numberToHex(v === 27n ? 28n : 27n, { size: 1 }),
    ]);
    // The twin is a valid signature by the owner over the same digest…
    expect(await recoverAddress({ hash: potDigest(COOK), signature: twin })).toBe(OWNER.address);
    // …which the Pot refuses, and so does the check.
    expect(await verifySignedCook({ ...COOK, signature: twin, owner: OWNER.address })).toBe(false);
  });

  it("refuses v of 0 or 1", async () => {
    const signature = await sign(COOK);
    const { v } = parts(signature);
    const low = concat([slice(signature, 0, 64), numberToHex(v - 27n, { size: 1 })]);
    expect(await verifySignedCook({ ...COOK, signature: low, owner: OWNER.address })).toBe(false);
  });

  it("refuses the 64-byte compact form, and any other length", async () => {
    const signature = await sign(COOK);
    const { r, s, v } = parts(signature);
    const yParityAndS = numberToHex(s | ((v - 27n) << 255n), { size: 32 });
    for (const malformed of [
      concat([r, yParityAndS]),
      slice(signature, 0, 64),
      concat([signature, "0x00"]),
      "0x" as Hex,
    ]) {
      expect(await verifySignedCook({ ...COOK, signature: malformed, owner: OWNER.address })).toBe(
        false,
      );
    }
  });

  it("asks an owner with code through ERC-1271, and reads its first word as the Pot does", async () => {
    const signature = "0xc0ffee" as Hex;
    const owner = "0x000000000000000000000000000000000000C0dE" as Address;
    const digest = signedCookDigest(COOK);
    const clientAnswering = (data: Hex | undefined) => ({
      getCode: async () => "0x6001" as Hex,
      call: async ({ data: calldata }: { data?: Hex }) => {
        const decoded = decodeFunctionData({
          abi: [
            {
              type: "function",
              name: "isValidSignature",
              stateMutability: "view",
              inputs: [
                { name: "hash", type: "bytes32" },
                { name: "signature", type: "bytes" },
              ],
              outputs: [{ name: "", type: "bytes4" }],
            },
          ],
          data: calldata!,
        });
        expect(decoded.args).toEqual([digest, signature]);
        return { data };
      },
    });
    const call = { ...COOK, signature, owner };
    const magic = `0x1626ba7e${"00".repeat(28)}` as Hex;
    expect(await verifySignedCook(call, clientAnswering(magic) as never)).toBe(true);
    // The Pot reads the first word and ignores whatever follows it.
    expect(
      await verifySignedCook(call, clientAnswering(`${magic}${"ab".repeat(32)}`) as never),
    ).toBe(true);
    expect(await verifySignedCook(call, clientAnswering(`${magic}01`) as never)).toBe(true);
    // Fewer than 32 bytes, another selector, or non-zero padding after the selector: refused.
    expect(await verifySignedCook(call, clientAnswering("0x1626ba7e") as never)).toBe(false);
    expect(
      await verifySignedCook(call, clientAnswering(`0x1626ba7e${"00".repeat(27)}`) as never),
    ).toBe(false);
    expect(
      await verifySignedCook(call, clientAnswering(`0x1626ba7f${"00".repeat(28)}`) as never),
    ).toBe(false);
    expect(
      await verifySignedCook(call, clientAnswering(`0x1626ba7e${"00".repeat(27)}01`) as never),
    ).toBe(false);
    expect(
      await verifySignedCook(
        call,
        clientAnswering(`0x1626ba7e01${"00".repeat(27)}${"00".repeat(32)}`) as never,
      ),
    ).toBe(false);
    // An answer that reverts is not the owner's.
    const reverting = {
      getCode: async () => "0x6001" as Hex,
      call: async () => {
        throw new Error("execution reverted");
      },
    };
    expect(await verifySignedCook(call, reverting as never)).toBe(false);
    expect(await verifySignedCook(call, clientAnswering(undefined) as never)).toBe(false);
    // With no client, a contract owner cannot be asked.
    expect(await verifySignedCook(call)).toBe(false);
    // An owner with no code is never asked.
    const noCode = {
      getCode: async () => undefined,
      call: async () => {
        throw new Error("asked an owner with no code");
      },
    };
    expect(await verifySignedCook(call, noCode as never)).toBe(false);
  });
});

describe("field checks", () => {
  const typed = (patch: Partial<Record<keyof SignedCookExecution, unknown>>) => () =>
    signedCookTypedData({ ...COOK, ...patch } as SignedCookExecution);

  it("refuses what is not an address", () => {
    expect(typed({ pot: "0x1234" })).toThrow(/pot is an EVM address/);
    expect(typed({ engine: "0xnot" })).toThrow(/engine is an EVM address/);
    expect(typed({ submitter: "anyone" })).toThrow(/submitter is an EVM address/);
  });

  it("refuses a number outside 256 bits, or not a bigint", () => {
    for (const field of ["value", "maxExecutionFee", "nonce", "deadline"] as const) {
      expect(typed({ [field]: -1n })).toThrow(new RegExp(`${field} is an unsigned 256-bit`));
      expect(typed({ [field]: UINT256_MAX + 1n })).toThrow(
        new RegExp(`${field} is an unsigned 256-bit`),
      );
      expect(typed({ [field]: 5 })).toThrow(new RegExp(`${field} is an unsigned 256-bit`));
    }
    expect(typed({ value: UINT256_MAX })).not.toThrow();
  });

  it("refuses a chain id of zero or below", () => {
    expect(typed({ chainId: 0 })).toThrow(/chainId/);
    expect(typed({ chainId: -1n })).toThrow(/chainId/);
  });

  it("refuses an empty program, or one that is not hex", () => {
    expect(typed({ program: "0x" })).toThrow(/program/);
    expect(typed({ program: "60016002" })).toThrow(/program/);
  });

  it("refuses a released engine another compiler's release names", () => {
    const older = V12_RELEASE_SETS.find(
      (row) =>
        row["v12-evm"].engine !== null &&
        row["v12-evm"].engine.toLowerCase() !== v12EngineAddress().toLowerCase(),
    );
    expect(older).toBeDefined();
    expect(typed({ engine: older!["v12-evm"].engine })).toThrow(/which runs compiler/);
  });

  it("checks fields wherever a cook is built from them", () => {
    const bad = { ...COOK, pot: "0x1234" as Address };
    expect(() => signedCookDigest(bad)).toThrow(/pot/);
    expect(() => signedCookTypedDataJson(bad)).toThrow(/pot/);
    expect(() => encodeCookSigned({ ...bad, signature: "0x00" })).toThrow(/pot/);
  });
});

/**
 * ensureLookupTable's existing-table branch — the first test to construct a
 * real SauceSvmClient. The client owns its RPC (built from `rpcUrl`), so the
 * seam here is `globalThis.fetch`: the stub answers the one getAccountInfo the
 * branch makes and records every method called, which is how "sends nothing"
 * is asserted.
 */
import { address, generateKeyPairSigner, getAddressDecoder, some } from "@solana/kit";
import type { Address } from "@solana/kit";
import { getAddressLookupTableEncoder } from "@solana-program/address-lookup-table";
import { createSauceSvmClient } from "../../src/svm/index.js";

const RPC_URL = "http://127.0.0.1:65535/";
const TABLE = address("11111111111111111111111111111112");
const ALT_PROGRAM = address("AddressLookupTab1e1111111111111111111111111");
const KITCHEN_PROGRAM = address("SauceYLdWyabKFwtevSAgsSDoMjCoTKtx1HTb63eJot");
const ENGINE_PROGRAM = address("So11111111111111111111111111111111111111112");

/** `count` unique deterministic addresses (a 16-bit counter in the first two bytes). */
function distinctAddresses(count: number): Address[] {
  return Array.from({ length: count }, (_, i) => {
    const bytes = new Uint8Array(32);
    bytes[0] = i & 0xff;
    bytes[1] = (i >> 8) & 0xff;

    return getAddressDecoder().decode(bytes);
  });
}

function encodeLookupTable(authority: Address, addresses: readonly Address[]): string {
  const data = getAddressLookupTableEncoder().encode({
    deactivationSlot: 2n ** 64n - 1n,
    lastExtendedSlot: 100n,
    lastExtendedSlotStartIndex: 0,
    authority: some(authority),
    addresses: [...addresses],
  });

  return Buffer.from(data).toString("base64");
}

/** Answers getAccountInfo for `TABLE` from `base64Data`; records every method. */
function fetchStub(base64Data: string): {
  install: () => void;
  restore: () => void;
  methods: () => string[];
} {
  const original = globalThis.fetch;
  const methods: string[] = [];
  const stub = async (_url: unknown, init: { body: string }): Promise<unknown> => {
    const { id, method } = JSON.parse(init.body);
    methods.push(method);
    const result =
      method === "getAccountInfo"
        ? {
            context: { apiVersion: "2.0.0", slot: 100 },
            value: {
              data: [base64Data, "base64"],
              executable: false,
              lamports: 1_000_000,
              owner: ALT_PROGRAM,
              rentEpoch: 0,
              space: Buffer.from(base64Data, "base64").length,
            },
          }
        : null;

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ jsonrpc: "2.0", id, result }),
    };
  };

  return {
    install: () => {
      globalThis.fetch = stub as unknown as typeof globalThis.fetch;
    },
    restore: () => {
      globalThis.fetch = original;
    },
    methods: () => methods,
  };
}

describe("ensureLookupTable on an existing table", () => {
  it("refuses a set that would take the table past its 256-address capacity, sending nothing", async () => {
    const payer = await generateKeyPairSigner();
    const held = distinctAddresses(250);
    const stub = fetchStub(encodeLookupTable(payer.address, held));
    stub.install();

    try {
      const client = await createSauceSvmClient({
        rpcUrl: RPC_URL,
        programId: ENGINE_PROGRAM,
        kitchen: KITCHEN_PROGRAM,
        payer,
      });
      const newAddresses = distinctAddresses(260).slice(250); // 10 the table does not hold

      await expect(client.ensureLookupTable(newAddresses, { existing: TABLE })).rejects.toThrow(
        `lookup table ${TABLE} holds 250 addresses and cannot take 10 more: one table holds at most 256`,
      );
      // The one getAccountInfo the branch needs to see `current` — no blockhash,
      // no sendTransaction, so no extend was ever built.
      expect(stub.methods()).toEqual(["getAccountInfo"]);
    } finally {
      stub.restore();
    }
  });

  it("sends nothing when the table already covers every address", async () => {
    const payer = await generateKeyPairSigner();
    const held = distinctAddresses(250);
    const stub = fetchStub(encodeLookupTable(payer.address, held));
    stub.install();

    try {
      const client = await createSauceSvmClient({
        rpcUrl: RPC_URL,
        programId: ENGINE_PROGRAM,
        kitchen: KITCHEN_PROGRAM,
        payer,
      });
      const { lookupTableAddress, lookupTables } = await client.ensureLookupTable(
        held.slice(0, 5),
        { existing: TABLE },
      );

      expect(lookupTableAddress).toBe(TABLE);
      expect(lookupTables[TABLE]).toHaveLength(250);
      expect(stub.methods()).toEqual(["getAccountInfo", "getAccountInfo"]);
    } finally {
      stub.restore();
    }
  });
});

describe("createSauceSvmClient without an RPC URL", () => {
  it.each([undefined, "", "  "])("refuses %p, naming the option to pass", async (rpcUrl) => {
    const payer = await generateKeyPairSigner();
    await expect(
      createSauceSvmClient({
        rpcUrl: rpcUrl as string,
        programId: ENGINE_PROGRAM,
        kitchen: KITCHEN_PROGRAM,
        payer,
      }),
    ).rejects.toThrow("createSauceSvmClient: pass `rpcUrl`");
  });
});

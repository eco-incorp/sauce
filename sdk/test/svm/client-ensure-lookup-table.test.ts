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
import {
  createSauceSvmClient,
  deriveExecutionFeeConfigPda,
  derivePotPda,
  lookupTableAddresses,
  measureExecuteTransaction,
  TRANSACTION_SIZE_LIMIT,
  type AccountResolution,
} from "../../src/svm/index.js";
import { getTransactionSize } from "../../src/svm/transaction.js";

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

/** A program taking `count` read-only accounts, each its own address. */
function wide(count: number): {
  manifest: { accounts: { kind: "slot"; index: number; name: string; requires: "readonly" }[] };
  resolution: AccountResolution;
  accounts: Address[];
} {
  // Past the 250 a test table holds: none of them is in it unless it is put there.
  const accounts = distinctAddresses(300 + count).slice(300);

  return {
    manifest: {
      accounts: accounts.map((_, index) => ({
        kind: "slot" as const,
        index,
        name: `a${index}`,
        requires: "readonly" as const,
      })),
    },
    resolution: Object.fromEntries(accounts.map((account, index) => [`a${index}`, account])),
    accounts,
  };
}

describe("cookLookupTable: the table a cook too wide for one transaction goes through", () => {
  const client = async (payer: Awaited<ReturnType<typeof generateKeyPairSigner>>) =>
    createSauceSvmClient({
      rpcUrl: RPC_URL,
      programId: ENGINE_PROGRAM,
      kitchen: KITCHEN_PROGRAM,
      payer,
    });
  const BYTECODE = new Uint8Array(16).fill(0xa5);

  it("needs none for a cook that fits, and asks the cluster nothing to say so", async () => {
    const payer = await generateKeyPairSigner();
    const stub = fetchStub(encodeLookupTable(payer.address, []));
    stub.install();
    try {
      const { manifest, resolution } = wide(8);
      expect(
        await (await client(payer)).cookLookupTable(BYTECODE, manifest, resolution),
      ).toBeUndefined();
      expect(stub.methods()).toEqual([]);
    } finally {
      stub.restore();
    }
  });

  it("holds exactly the accounts the cook lists but its signers and the programs it calls", async () => {
    const payer = await generateKeyPairSigner();
    const { manifest, resolution, accounts } = wide(40);
    // A table that already holds every account the cook needs it to — the program's, and the
    // Kitchen cook's own that are no signer and not called: nothing is sent.
    const { address: pot } = await derivePotPda(KITCHEN_PROGRAM, payer.address, new Uint8Array(32));
    const { address: feeConfig } = await deriveExecutionFeeConfigPda(KITCHEN_PROGRAM);
    const cooks = [pot, feeConfig, address("11111111111111111111111111111111"), ENGINE_PROGRAM];
    const held = [...distinctAddresses(250).slice(0, 200), ...accounts, ...cooks];
    const stub = fetchStub(encodeLookupTable(payer.address, held));
    stub.install();
    try {
      const sauce = await client(payer);
      const table = await sauce.cookLookupTable(BYTECODE, manifest, resolution, {
        existing: TABLE,
      });
      expect(table?.lookupTableAddress).toBe(TABLE);
      expect(stub.methods()).toEqual(["getAccountInfo", "getAccountInfo"]);
    } finally {
      stub.restore();
    }
  });

  it("refuses to simulate a program too large for one transaction, saying to stage it", async () => {
    const payer = await generateKeyPairSigner();
    const stub = fetchStub(encodeLookupTable(payer.address, []));
    stub.install();
    try {
      const { manifest, resolution } = wide(2);
      await expect(
        (await client(payer)).simulate(new Uint8Array(1200), manifest, resolution),
      ).rejects.toThrow(
        /the program itself is too large for one, so stage it in a code buffer and simulateStaged it/,
      );
      expect(stub.methods()).toEqual([]);
    } finally {
      stub.restore();
    }
  });

  it("refuses, sending nothing, a cook too large even through a table: the program is staged", async () => {
    const payer = await generateKeyPairSigner();
    const stub = fetchStub(encodeLookupTable(payer.address, []));
    stub.install();
    try {
      const { manifest, resolution } = wide(40);
      await expect(
        (await client(payer)).cookLookupTable(new Uint8Array(1100), manifest, resolution),
      ).rejects.toThrow(
        /past Solana's 1232 bytes even with every account it names through a lookup table: the program itself is too large for one, so stage it in a code buffer and executeStaged it/,
      );
      expect(stub.methods()).toEqual([]);
    } finally {
      stub.restore();
    }
  });
});

describe("measureExecuteTransaction and lookupTableAddresses", () => {
  it("measure a transaction unsigned, and list what a table may hold", async () => {
    const payer = await generateKeyPairSigner();
    const [program, writable, readonly] = distinctAddresses(3);
    const instructions = [
      {
        programAddress: program!,
        accounts: [
          { address: payer.address, role: 3 },
          { address: writable!, role: 1 },
          { address: readonly!, role: 0 },
        ],
        data: new Uint8Array(4),
      },
    ];
    const transaction = measureExecuteTransaction({ feePayer: payer.address, instructions });
    // Neither the signer nor the program called: the two accounts only.
    expect(new Set(lookupTableAddresses(transaction))).toEqual(new Set([writable, readonly]));
    const through = measureExecuteTransaction({
      feePayer: payer.address,
      instructions,
      lookupTables: { [TABLE]: [writable!, readonly!] },
    });
    expect(getTransactionSize(through)).toBeLessThan(getTransactionSize(transaction));
    expect(getTransactionSize(transaction)).toBeLessThanOrEqual(TRANSACTION_SIZE_LIMIT);
  });
});

describe("createSauceSvmClient without an RPC URL", () => {
  // What a plain-JS caller can pass: the type is not there to stop any of these.
  it.each([undefined, null, 0, false, "", "  "])(
    "refuses %p, naming the option to pass",
    async (rpcUrl) => {
      const payer = await generateKeyPairSigner();
      await expect(
        createSauceSvmClient({
          rpcUrl: rpcUrl as unknown as string,
          programId: ENGINE_PROGRAM,
          kitchen: KITCHEN_PROGRAM,
          payer,
        }),
      ).rejects.toThrow("createSauceSvmClient: pass `rpcUrl`");
    },
  );
});

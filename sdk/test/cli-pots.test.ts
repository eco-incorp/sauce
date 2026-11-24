/**
 * What the `sauce` command records of a Pot (`cli/pots.ts`), offline: which release minted it, told
 * from its address under every Kitchen and Pot init-code hash `releases.json` records and each kind
 * of Pot; the Pots a landed EVM transaction deployed, from the Kitchen's `PotDeployed`; those a
 * Solana transaction created, from the Kitchen's `create_pot`, its accounts loaded through a lookup
 * table too; and the scope a command keeps its stores in (`keep.ts`), which writes them as they
 * land, each scope apart. That the real
 * Kitchen mints where these say is `cli-pots.e2e.test.ts`'s, on anvil.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address as SvmAddress,
  type Blockhash,
  type Instruction,
} from "@solana/kit";
import {
  encodeAbiParameters,
  getAddress,
  getCreate2Address,
  keccak256,
  pad,
  toEventSelector,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { requireChain } from "../src/chains/canonical.js";
import { potListCommand } from "../src/cli/pot-commands.js";
import { PotStore, type PotRecord } from "../src/cli/pot-store.js";
import type { Sent } from "../src/cli/chain.js";
import { keeping, keepLanded } from "../src/cli/keep.js";
import {
  evmKitchenRelease,
  evmPotsDeployed,
  importSvmPot,
  keepPots,
  ownerPotsText,
  pairedSdkReleases,
  svmPotsCreated,
} from "../src/cli/pots.js";
import {
  V12_RELEASE_SETS,
  v12PotDerivation,
  v12ReleaseSet,
  v12SvmEngineProgramId,
  v12SvmKitchenProgramId,
} from "../src/deployments/index.js";
import { v12DefaultPotFamily, v12PotRelease, v12PredictPot } from "../src/deployments/pot.js";
import { buildCreatePotInstruction, derivePotPda } from "../src/svm/kitchen.js";

const OWNER = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
const SALT = keccak256(new TextEncoder().encode("treasury"));
const SENDER = getAddress("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
const TX = `0x${"ab".repeat(32)}` as Hex;
const BASE = requireChain("base");
const SOLANA = requireChain("solana");
const DEVNET_CHAIN = requireChain("solana-devnet");

/** `Kitchen._salt`, written out from the Kitchen's own source: a fixed Router appends `true`. */
const gateSalt = (owner: Address, salt: Hex, routerFixed: boolean): Hex =>
  keccak256(
    routerFixed
      ? encodeAbiParameters(
          [{ type: "address" }, { type: "bytes32" }, { type: "bool" }],
          [owner, salt, true],
        )
      : encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [owner, salt]),
  );

const potOf = (kitchen: string, hash: string, owner: Address, salt: Hex, routerFixed: boolean) =>
  getCreate2Address({
    from: getAddress(kitchen),
    salt: gateSalt(owner, salt, routerFixed),
    bytecodeHash: hash as Hex,
  });

/** `PotDeployed(owner, salt, pot)` as `kitchen` emits it. */
const potDeployed = (kitchen: Address, owner: Address, salt: Hex, pot: Address) => ({
  address: kitchen,
  topics: [toEventSelector("PotDeployed(address,bytes32,address)"), pad(owner), salt] as Hex[],
  data: pad(pot),
});

/** A client that serves the chain id, and the Kitchen's `potInitCodeHash()` and a Pot's
 *  `gateSalt()` where given. */
const clientOf = (chainId: number, reads: { hash?: Hex; gate?: Hex } = {}) =>
  ({
    getChainId: async () => chainId,
    readContract: async ({ functionName }: { functionName: string }) => {
      const answer = { potInitCodeHash: reads.hash, gateSalt: reads.gate }[functionName];
      if (answer === undefined) throw new Error("no such read");

      return answer;
    },
  }) as unknown as PublicClient;

const own = v12ReleaseSet();
const create2Sets = V12_RELEASE_SETS.filter((set) => set["kitchen-evm"].potInitCodeHash !== null);
const KITCHEN = getAddress(own["kitchen-evm"].kitchen!);
/** The installed release's Pot of OWNER at SALT: CREATE3 under its proxy's hash, where its Kitchen
 *  places it. */
const OWN_POT = getAddress(v12PredictPot(OWNER, SALT));

describe("which release minted an EVM Pot", () => {
  it("tells every recorded CREATE2 release and each legacy Pot kind from the address alone", () => {
    for (const set of create2Sets) {
      const { kitchen, potInitCodeHash } = set["kitchen-evm"];
      const cases = [
        { owner: OWNER, fixed: false, kind: "private" },
        { owner: OWNER, fixed: true, kind: "private-fixed-router" },
        { owner: zeroAddress, fixed: true, kind: "shared" },
      ] as const;
      for (const { owner, fixed, kind } of cases) {
        const pot = potOf(kitchen!, potInitCodeHash!, owner, SALT, fixed);
        const found = v12PotRelease({ kitchen: getAddress(kitchen!), owner, salt: SALT, pot });
        expect([set.compiler, kind, found?.kind]).toEqual([set.compiler, kind, kind]);
        expect(found?.family.hash).toBe(potInitCodeHash);
        expect(found?.family.sets.map((one) => one["kitchen-evm"].version)).toContain(
          set["kitchen-evm"].version,
        );
      }
    }
  });

  it("tells the installed release's CREATE3 Pots, each kind, from the address alone", () => {
    const cases = [
      { owner: OWNER, fixed: false, kind: "private" },
      { owner: OWNER, fixed: true, kind: "private-fixed-router" },
      { owner: zeroAddress, fixed: true, kind: "shared" },
    ] as const;
    for (const { owner, fixed, kind } of cases) {
      const pot = getAddress(v12PredictPot(owner, SALT, { routerFixed: fixed }));
      const found = v12PotRelease({ kitchen: KITCHEN, owner, salt: SALT, pot });
      expect([kind, found?.kind]).toEqual([kind, kind]);
      expect(found?.family).toBe(v12DefaultPotFamily());
      expect(found?.family.scheme).toBe("create3");
    }
  });

  it("knows no Pot of another Kitchen, another owner or another salt", () => {
    const pot = OWN_POT;
    expect(v12PotRelease({ kitchen: KITCHEN, owner: SENDER, salt: SALT, pot })).toBeUndefined();
    expect(
      v12PotRelease({ kitchen: KITCHEN, owner: OWNER, salt: `0x${"00".repeat(32)}`, pot }),
    ).toBeUndefined();
    expect(v12PotRelease({ kitchen: SENDER, owner: OWNER, salt: SALT, pot })).toBeUndefined();
  });
});

describe("the release a Kitchen mints, and the SDK releases that pair with it", () => {
  it("tells a release by its Kitchen and the Pot init-code hash it reports", () => {
    for (const set of create2Sets) {
      const { kitchen, potInitCodeHash } = set["kitchen-evm"];
      const family = evmKitchenRelease(
        kitchen!,
        potInitCodeHash!.toUpperCase().replace("0X", "0x"),
      );
      expect(family?.sets.map((one) => one.compiler)).toContain(set.compiler);
    }
    // The installed release is CREATE3: its Kitchen reports keccak256 of the Pot's creation code.
    const hash = v12PotDerivation().initCodeHash;
    expect(evmKitchenRelease(KITCHEN, hash)).toBe(v12DefaultPotFamily());
    expect(evmKitchenRelease(KITCHEN, keccak256("0x01"))).toBeUndefined();
    expect(evmKitchenRelease(SENDER, hash)).toBeUndefined();
  });

  it("names the SDK releases that pinned a release, from the changelog's table", () => {
    // Each EVM release, and the SDK releases that shipped its compiler, engine and Kitchen.
    expect(
      pairedSdkReleases({ compiler: "2.3.0", "v12-evm": "1.0.1", "kitchen-evm": "1.0.0" }),
    ).toBe("0.99.2 to 0.99.4");
    expect(
      pairedSdkReleases({ compiler: "2.4.0", "v12-evm": "1.1.0", "kitchen-evm": "1.1.0" }),
    ).toBe("0.99.5 to 0.99.8");
    expect(
      pairedSdkReleases({ compiler: "2.5.0", "v12-evm": "1.2.0", "kitchen-evm": "1.2.0" }),
    ).toBe("0.99.9 to 0.99.15");
    // A Solana release is held to its own components: compiler 2.3.0 shipped three engines.
    expect(
      pairedSdkReleases({ compiler: "2.3.0", "v12-svm": "1.1.0", "kitchen-svm": "1.0.0" }),
    ).toBe("0.99.3");
    // None pinned this pairing.
    expect(
      pairedSdkReleases({ compiler: "2.5.0", "v12-evm": "1.1.0", "kitchen-evm": "1.2.0" }),
    ).toBeUndefined();
  });
});

describe("the Pots a landed EVM transaction deployed", () => {
  const pot = OWN_POT;
  const landed = (
    logs: ReturnType<typeof potDeployed>[],
    status: "success" | "reverted" = "success",
  ) => ({
    hash: TX,
    status,
    blockNumber: 12n,
    logs,
  });

  it("records each PotDeployed of a known Kitchen, under the SDK's own release", async () => {
    const [record, ...more] = await evmPotsDeployed(
      clientOf(BASE.id),
      landed([potDeployed(KITCHEN, OWNER, SALT, pot)]),
      SENDER,
    );
    expect(more).toEqual([]);
    expect(record).toEqual({
      schema: "sauce.pot/1",
      chain: "base",
      chainId: 8453,
      origin: "deployed",
      pot,
      owner: OWNER,
      salt: SALT,
      kind: "private",
      kitchen: KITCHEN,
      potProxyInitCodeHash: own["kitchen-evm"].potProxyInitCodeHash,
      potProfileHash: own["kitchen-evm"].potProfileHash,
      engine: getAddress(own["v12-evm"].engine!),
      release: {
        compiler: own.compiler,
        "v12-evm": own["v12-evm"].version,
        "kitchen-evm": own["kitchen-evm"].version,
      },
      sdk: expect.any(String),
      deployment: { tx: TX, block: "12", from: SENDER },
      recordedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
    });
  });

  it("records nothing of a reverted transaction, or a PotDeployed some other contract emits", async () => {
    const log = potDeployed(KITCHEN, OWNER, SALT, pot);
    expect(await evmPotsDeployed(clientOf(BASE.id), landed([log], "reverted"), SENDER)).toEqual([]);
    expect(
      await evmPotsDeployed(clientOf(BASE.id), landed([{ ...log, address: SENDER }]), SENDER),
    ).toEqual([]);
  });

  it("refuses a PotDeployed that does not decode by the Kitchen's ABI, never reading guessed offsets", async () => {
    const log = potDeployed(KITCHEN, OWNER, SALT, pot);
    // Its data short of the address word, or an indexed field missing: refused, not misread.
    for (const malformed of [
      { ...log, data: "0x1234" as Hex },
      { ...log, topics: log.topics.slice(0, 2) },
    ]) {
      await expect(
        evmPotsDeployed(clientOf(BASE.id), landed([malformed]), SENDER),
      ).rejects.toThrow();
    }
  });

  it("records a Pot a Kitchen upgraded past the SDK minted, under the hash the Kitchen reports", async () => {
    const hash = `0x${"56".repeat(32)}` as Hex;
    const newer = potOf(KITCHEN, hash, OWNER, SALT, true);
    const [record] = await evmPotsDeployed(
      clientOf(BASE.id, { hash }),
      landed([potDeployed(KITCHEN, OWNER, SALT, newer)]),
      SENDER,
    );
    expect(record).toMatchObject({
      pot: newer,
      kind: "private-fixed-router",
      potInitCodeHash: hash,
    });
    expect(record!.release).toBeUndefined();
    expect(record!.engine).toBeUndefined();
    // The Kitchen's hash unread: the kind from the Pot's own gate salt, and no hash recorded.
    const [unread] = await evmPotsDeployed(
      clientOf(BASE.id, { gate: gateSalt(OWNER, SALT, true) }),
      landed([potDeployed(KITCHEN, OWNER, SALT, newer)]),
      SENDER,
    );
    expect(unread).toMatchObject({ pot: newer, kind: "private-fixed-router" });
    expect(unread!.potInitCodeHash).toBeUndefined();
  });
});

describe("a record written before its release was known", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sauce-pots-unknown-release-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  // SDK 1.1.0 filed a fixed-Router Pot as `private` where it could not read the Kitchen's kind, and a
  // record is a file anyone can edit: the listings print what the address says.
  const FIXED = getAddress(v12PredictPot(OWNER, SALT, { routerFixed: true }));
  const filed = (pot: Address, kind: PotRecord["kind"], tx: Hex): PotRecord => ({
    schema: "sauce.pot/1",
    chain: "base",
    chainId: BASE.id,
    origin: "deployed",
    pot,
    owner: OWNER,
    salt: SALT,
    kind,
    kitchen: KITCHEN,
    potInitCodeHash: v12PotDerivation().initCodeHash,
    sdk: "1.1.0",
    deployment: { tx, block: "12", from: SENDER },
    recordedAt: "2026-11-20T21:00:00.000Z",
  });
  /** Where the store keeps the record of `pot` on base. */
  const fileOf = (pot: Address): string =>
    join(dir, "pots", String(BASE.id), `${pot.toLowerCase()}.json`);

  it("a record SDK 1.1.0 wrote for a CREATE3 Pot is identified when read", () => {
    // SDK 1.1.0 recorded a CREATE3 Pot with the hash its Kitchen reports and with no release or
    // engine: it knew no release that placed Pots that way.
    const written: PotRecord = {
      schema: "sauce.pot/1",
      chain: "base",
      chainId: BASE.id,
      origin: "deployed",
      pot: OWN_POT,
      owner: OWNER,
      salt: SALT,
      kind: "private",
      kitchen: KITCHEN,
      potInitCodeHash: v12PotDerivation().initCodeHash,
      sdk: "1.1.0",
      deployment: { tx: TX, block: "12", from: SENDER },
      recordedAt: "2026-11-20T21:00:00.000Z",
    };
    const store = new PotStore(join(dir, "pots"));
    expect(store.save(written)).toBe("created");
    const listed = potListCommand(store, { chain: BASE });
    // Shown as it was written, its release told again from its address.
    expect(listed.json.pots).toEqual([written]);
    expect(listed.text).toContain(
      `compiler ${own.compiler} (v12-evm ${own["v12-evm"].version}, ` +
        `kitchen-evm ${own["kitchen-evm"].version})`,
    );
    expect(listed.text).not.toContain("release unknown");
  });

  it("lists the kind the address says, not the one a hand-edited or earlier-written record stores", () => {
    const store = new PotStore(join(dir, "pots"));
    // A fixed-Router Pot stored as private, and a dynamic one stored as shared.
    const asWritten = [
      filed(FIXED, "private", `0x${"01".repeat(32)}`),
      filed(OWN_POT, "shared", `0x${"02".repeat(32)}`),
    ];
    for (const record of asWritten) store.save(record);

    const listing = potListCommand(store, { chain: BASE });
    expect(listing.text).toContain(`base  ${FIXED}  private-fixed-router`);
    expect(listing.text).toContain(`base  ${OWN_POT}  private\n`);
    expect(listing.text).not.toContain(`${OWN_POT}  shared`);
    // The JSON stays as written, so an agent that reads only it and the notes (the MCP server's
    // `sauce_pot_list`) is told by a note that the stored kind is contradicted.
    expect(listing.json.pots).toEqual(expect.arrayContaining(asWritten));
    expect(listing.notes).toEqual(
      expect.arrayContaining([
        `${FIXED}: the record says private; its address makes it a private-fixed-router Pot`,
        `${OWN_POT}: the record says shared; its address makes it a private Pot`,
      ]),
    );
    expect(listing.notes).toHaveLength(2);

    const others = ownerPotsText(store, BASE, OWNER, SENDER);
    expect(others).toContain(`${FIXED}  private-fixed-router, salt ${SALT}`);
    expect(others).toContain(`${OWN_POT}  private, salt ${SALT}`);
    expect(others).not.toContain(`${OWN_POT}  shared`);
  });

  it("lists a record whose fields cannot be read as it is stored, with a warning naming its file, and the rest of the store", () => {
    // The store checks that a record's fields are strings, not that they are addresses: one record
    // with a kitchen that is none must not stop the list, or the refusal that prints it.
    const store = new PotStore(join(dir, "pots"));
    const good = filed(OWN_POT, "private", `0x${"01".repeat(32)}`);
    const damaged = {
      ...filed(FIXED, "private", `0x${"02".repeat(32)}`),
      kitchen: "not an address",
    } as PotRecord;
    store.save(good);
    store.save(damaged);

    const listing = potListCommand(store, { chain: BASE });
    expect(listing.json.pots).toHaveLength(2);
    expect(listing.json.pots).toEqual(expect.arrayContaining([good, damaged]));
    const lines = listing.text.split("\n");
    // The readable record as before; the damaged one with the kind it stores and no release.
    expect(lines).toContain(`base  ${OWN_POT}  private`);
    const at = lines.indexOf(`base  ${FIXED}  private`);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lines[at + 2]).toContain("release unknown");
    expect(listing.notes).toEqual([expect.stringContaining(fileOf(FIXED))]);
    expect(listing.notes![0]).toContain("cannot be told from its address");

    const others = ownerPotsText(store, BASE, OWNER, SENDER);
    expect(others).toContain(`holds 2 other Pots of ${OWNER} on base:`);
    expect(others).toContain(`${OWN_POT}  private, salt ${SALT}`);
    expect(others).toContain(`${FIXED}  private, salt ${SALT}: release unknown`);
    expect(others).toContain(`warning: ${fileOf(FIXED)} cannot be told from its address`);
  });
});

const BLOCKHASH = {
  blockhash: "11111111111111111111111111111111" as Blockhash,
  lastValidBlockHeight: 1n,
};
const PAYER = address("4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi");
const TABLE = address("8Vaso6eE1pWktDHwy2qQBB1fhjmBgwzhoXQKe1sxtFjn");

/** A transaction of `instructions` from PAYER, accounts of `table` taken through TABLE. */
const wire = (instructions: Instruction[], table: SvmAddress[] = []): string => {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(PAYER, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(BLOCKHASH, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );

  return getBase64EncodedWireTransaction(
    compileTransaction(
      table.length === 0
        ? message
        : compressTransactionMessageUsingAddressLookupTables(message, { [TABLE]: table }),
    ),
  );
};

describe("the Pots a landed Solana transaction created", () => {
  const kitchen = v12SvmKitchenProgramId() as SvmAddress;
  const engine = v12SvmEngineProgramId() as SvmAddress;
  const salt = new Uint8Array(32).fill(7);
  const MAINNET = async () => "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
  const DEVNET = async () => "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
  const never = async (): Promise<string> => {
    throw new Error("the genesis hash is asked only of a transaction that created a Pot");
  };
  const createOf = async () => {
    const { address: pot } = await derivePotPda(kitchen, PAYER, salt);

    return {
      pot,
      create: buildCreatePotInstruction({
        kitchen,
        owner: PAYER,
        engineProgram: engine,
        pot,
        salt,
        space: 0,
      }),
    };
  };
  const recordOf = (pot: SvmAddress, cluster: string) => ({
    schema: "sauce.pot/1",
    chain: "solana",
    chainId: SOLANA.id,
    origin: "deployed",
    cluster,
    pot,
    owner: PAYER,
    salt: `0x${"07".repeat(32)}`,
    kind: "private",
    kitchen,
    engine,
    release: {
      compiler: own.compiler,
      "v12-svm": own["v12-svm"].version,
      "kitchen-svm": own["kitchen-svm"].version,
    },
    sdk: expect.any(String),
    deployment: { tx: "sig", block: "99", from: PAYER },
    recordedAt: expect.any(String),
  });

  it("records the Kitchen's create_pot, with its engine's release, its Pot through a lookup table too", async () => {
    const { pot, create } = await createOf();
    for (const table of [[], [pot]] as SvmAddress[][]) {
      const records = await svmPotsCreated({
        transaction: wire([create], table),
        ...(table.length === 0 ? {} : { loaded: { writable: [pot], readonly: [] } }),
        signature: "sig",
        slot: 99n,
        ok: true,
        genesis: MAINNET,
      });
      expect(records).toEqual([recordOf(pot, "mainnet-beta")]);
    }
  });

  it("records a create_pot another program invoked", async () => {
    const { pot, create } = await createOf();
    // An instruction of another program that takes every account the Kitchen's create_pot does,
    // and invokes it: the node reports the Kitchen's instruction among the inner ones.
    const caller = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
    const outer: Instruction = {
      programAddress: caller,
      accounts: [{ address: kitchen, role: AccountRole.READONLY }, ...create.accounts!],
      data: new Uint8Array([1]),
    };
    const transaction = wire([outer]);
    const keys = (
      getCompiledTransactionMessageDecoder().decode(
        getTransactionDecoder().decode(new Uint8Array(getBase64Encoder().encode(transaction)))
          .messageBytes,
      ) as { staticAccounts: readonly string[] }
    ).staticAccounts;
    const inner = [
      {
        index: 0,
        instructions: [
          {
            programIdIndex: keys.indexOf(kitchen),
            accounts: create.accounts!.map((meta) => keys.indexOf(meta.address)),
            data: getBase58Decoder().decode(create.data!),
          },
        ],
      },
    ];
    const at = { transaction, signature: "sig", slot: 99n, ok: true };
    expect(await svmPotsCreated({ ...at, genesis: never })).toEqual([]);
    expect(await svmPotsCreated({ ...at, inner, genesis: MAINNET })).toEqual([
      recordOf(pot, "mainnet-beta"),
    ]);
  });

  it("records a devnet Pot as devnet's, filed apart from the mainnet Pot at the same address", async () => {
    const { pot, create } = await createOf();
    const at = {
      transaction: wire([create]),
      signature: "sig",
      slot: 99n,
      ok: true,
    };
    const [devnet] = await svmPotsCreated({ ...at, genesis: DEVNET });
    const [mainnet] = await svmPotsCreated({ ...at, genesis: MAINNET });
    expect(devnet).toEqual(recordOf(pot, "devnet"));
    const dir = mkdtempSync(join(tmpdir(), "sauce-pots-clusters-"));
    try {
      const store = new PotStore(dir);
      expect(store.save(devnet!)).toBe("created");
      expect(store.save(mainnet!)).toBe("created");
      expect(store.recordsOf(SOLANA.id, pot, "devnet")).toEqual([devnet]);
      expect(store.recordsOf(SOLANA.id, pot, "mainnet-beta")).toEqual([mainnet]);
      expect(
        store
          .list()
          .pots.map((one) => one.cluster)
          .sort(),
      ).toEqual(["devnet", "mainnet-beta"]);
      expect(potListCommand(store, { chain: SOLANA }).text).toContain(`solana (devnet)  ${pot}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records nothing of a failed transaction, or one that creates no Pot, asking no cluster", async () => {
    const { create } = await createOf();
    const at = { signature: "sig", slot: 1n, genesis: never };
    expect(await svmPotsCreated({ ...at, transaction: wire([create]), ok: false })).toEqual([]);
    expect(
      await svmPotsCreated({
        ...at,
        transaction: wire([{ ...create, data: new Uint8Array(44) }]),
        ok: true,
      }),
    ).toEqual([]);
  });

  it("imports a Pot its engine owns, and refuses an account at its address that no engine owns", async () => {
    const { pot } = await createOf();
    const reader = (owner: string | undefined) => ({
      ownerOf: async (at: SvmAddress) => (at === pot ? owner : undefined),
      genesis: DEVNET,
    });
    const hex = `0x${"07".repeat(32)}` as Hex;
    expect(await importSvmPot(reader(engine), SOLANA, PAYER, hex)).toEqual({
      ...recordOf(pot, "devnet"),
      origin: "imported",
      deployment: undefined,
    });
    // Lamports sent to the address before any Pot: the System Program's account, never a Pot.
    await expect(
      importSvmPot(reader("11111111111111111111111111111111"), SOLANA, PAYER, hex),
    ).rejects.toThrow(/is owned by 1{32}, which no release this sauce knows names as its engine/);
    await expect(importSvmPot(reader(undefined), SOLANA, PAYER, hex)).rejects.toThrow(
      /does not exist/,
    );
  });

  it("refuses an account a program this SDK does not know owns without calling it no Pot: a later release's engine may own it", async () => {
    const { pot } = await createOf();
    const stranger = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    const reader = {
      ownerOf: async (at: SvmAddress) => (at === pot ? stranger : undefined),
      genesis: DEVNET,
    };
    const hex = `0x${"07".repeat(32)}` as Hex;
    const refusal = await importSvmPot(reader, SOLANA, PAYER, hex).then(
      () => undefined,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(refusal).toContain(
      `is owned by ${stranger}, which is not an engine this SDK knows: it is not recorded. ` +
        "Where a later release's engine owns it, a newer SDK imports it.",
    );
    expect(refusal).not.toContain("not a Pot");
  });

  it("imports a devnet Pot as Solana's record of devnet, whichever chain names it, holding solana-devnet to devnet", async () => {
    const { pot } = await createOf();
    const asked: string[] = [];
    const reader = (genesis: () => Promise<string>) => ({
      ownerOf: async (at: SvmAddress) => {
        asked.push(at);

        return at === pot ? engine : undefined;
      },
      genesis,
    });
    const hex = `0x${"07".repeat(32)}` as Hex;
    const expected = { ...recordOf(pot, "devnet"), origin: "imported", deployment: undefined };
    // `solana` against a devnet endpoint, as a devnet Pot was imported before solana-devnet named
    // devnet, and solana-devnet: one record, Solana's, of devnet.
    expect(await importSvmPot(reader(DEVNET), SOLANA, PAYER, hex)).toEqual(expected);
    expect(await importSvmPot(reader(DEVNET), DEVNET_CHAIN, PAYER, hex)).toEqual(expected);
    // solana-devnet against another cluster's endpoint: refused before the Pot is read.
    asked.length = 0;
    await expect(importSvmPot(reader(MAINNET), DEVNET_CHAIN, PAYER, hex)).rejects.toThrow(
      "solana-devnet is Solana's devnet cluster, and the endpoint serves mainnet-beta: give a " +
        "devnet endpoint",
    );
    expect(asked).toEqual([]);
    // `solana` takes an endpoint of any cluster, as it always has.
    expect(await importSvmPot(reader(MAINNET), SOLANA, PAYER, hex)).toEqual({
      ...expected,
      cluster: "mainnet-beta",
    });
  });

  it("finds a devnet Pot through solana-devnet and solana alike, in the one directory it was always filed in", async () => {
    const { pot, create } = await createOf();
    const at = { transaction: wire([create]), signature: "sig", slot: 99n, ok: true };
    // As a `--chain solana` command against devnet recorded it, before solana-devnet existed.
    const [devnet] = await svmPotsCreated({ ...at, genesis: DEVNET });
    const [mainnet] = await svmPotsCreated({ ...at, genesis: MAINNET });
    const imported = (chain: typeof SOLANA) =>
      importSvmPot(
        { ownerOf: async (address) => (address === pot ? engine : undefined), genesis: DEVNET },
        chain,
        PAYER,
        `0x${"07".repeat(32)}`,
      );
    const dir = mkdtempSync(join(tmpdir(), "sauce-pots-devnet-"));
    try {
      const store = new PotStore(join(dir, "old"));
      expect(store.save(devnet!)).toBe("created");
      expect(store.save(mainnet!)).toBe("created");
      const file = join(store.dir, `${SOLANA.id}-devnet`, `${pot}.json`);
      const before = readFileSync(file, "utf8");
      // solana-devnet lists devnet's record alone; solana every cluster's, as it always has.
      expect(potListCommand(store, { chain: DEVNET_CHAIN }).json.pots).toEqual([devnet]);
      expect(potListCommand(store, { chain: DEVNET_CHAIN }).text).toContain(
        `solana (devnet)  ${pot}`,
      );
      const all = potListCommand(store, { chain: SOLANA }).json.pots as unknown[];
      expect(all).toHaveLength(2);
      expect(all).toEqual(expect.arrayContaining([devnet, mainnet]));
      // Imported again through solana-devnet: the same Pot, so nothing is written or moved.
      expect(store.save(await imported(DEVNET_CHAIN))).toBe("exists");
      expect(readdirSync(store.dir).sort()).toEqual([`${SOLANA.id}`, `${SOLANA.id}-devnet`]);
      expect(readdirSync(join(store.dir, `${SOLANA.id}-devnet`))).toEqual([`${pot}.json`]);
      expect(readFileSync(file, "utf8")).toBe(before);

      // The other way round: recorded through solana-devnet, found through solana.
      const fresh = new PotStore(join(dir, "new"));
      const record = await imported(DEVNET_CHAIN);
      expect(fresh.save(record)).toBe("created");
      expect(readdirSync(fresh.dir)).toEqual([`${SOLANA.id}-devnet`]);
      expect(potListCommand(fresh, { chain: SOLANA }).json.pots).toEqual([record]);
      expect(fresh.save(await imported(SOLANA))).toBe("exists");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the scope a command keeps its stores in", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sauce-pots-keeping-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps what lands inside it, nothing outside it, and each scope apart", async () => {
    const store = new PotStore(join(dir, "kept"));
    const other = new PotStore(join(dir, "other"));
    const said: string[] = [];
    const heard: string[] = [];
    const pot = OWN_POT;
    const receipt = {
      hash: TX,
      status: "success" as const,
      blockNumber: 1n,
      gasUsed: 1n,
      logs: [potDeployed(KITCHEN, OWNER, SALT, pot)],
    };
    const [record] = await evmPotsDeployed(clientOf(BASE.id), receipt, SENDER);
    const landed = {
      kind: "evm" as const,
      client: clientOf(BASE.id),
      sent: { ...receipt, pots: [record!] } as Sent,
      from: SENDER,
    };
    // Outside any scope: nothing keeps it.
    await keepLanded(landed);
    expect(store.list().pots).toEqual([]);
    // Two scopes at once, each its own store and its own lines.
    await Promise.all([
      keeping({ stores: { pots: store }, say: (line) => said.push(line) }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        await keepLanded(landed);
        await keepLanded(landed);
      }),
      keeping({ stores: {}, say: (line) => heard.push(line) }, async () => {
        await keepLanded(landed);
      }),
    ]);
    expect(store.list().pots).toEqual([record]);
    expect(other.list().pots).toEqual([]);
    expect(heard).toEqual([]);
    expect(said).toEqual([
      `recorded Pot ${pot} on base in ${store.dir}`,
      `Pot ${pot} on base was already recorded in ${store.dir}`,
    ]);
    // `sauce pot list` prints it, and filters by chain and owner.
    expect(potListCommand(store, {}).json.pots).toEqual([record]);
    expect(potListCommand(store, { owner: OWNER.toLowerCase() }).json.pots).toEqual([record]);
    expect(potListCommand(store, { chain: SOLANA }).json.pots).toEqual([]);
    expect(potListCommand(store, { chain: SOLANA }).text).toBe(
      `No Pots on solana in ${store.dir}.`,
    );
  });

  it("keeps another deployment of a Pot beside the first, and says so, never silently", async () => {
    const store = new PotStore(join(dir, "twice"));
    const pot = OWN_POT;
    const landedBy = async (hash: Hex) => {
      const receipt = {
        hash,
        status: "success" as const,
        blockNumber: 1n,
        gasUsed: 1n,
        logs: [potDeployed(KITCHEN, OWNER, SALT, pot)],
      };
      const pots = await evmPotsDeployed(clientOf(BASE.id), receipt, SENDER);

      return {
        kind: "evm" as const,
        client: clientOf(BASE.id),
        sent: { ...receipt, pots } as Sent,
        from: SENDER,
      };
    };
    const first = await landedBy(TX);
    // On the chain, then on a fork of it with the same chain id: the same Pot, another deployment.
    const fork = await landedBy(`0x${"fe".repeat(32)}`);
    expect(keepPots(store, first)).toEqual([`recorded Pot ${pot} on base in ${store.dir}`]);
    expect(keepPots(store, first)).toEqual([
      `Pot ${pot} on base was already recorded in ${store.dir}`,
    ]);
    expect(keepPots(store, fork)).toEqual([
      `warning: Pot ${pot} on base was recorded already, deployed by ${TX}; this deployment, ` +
        `0x${"fe".repeat(32)}, is another, recorded beside it in ${store.dir}. One of them ` +
        "landed on a fork or another network with the same chain id, or the Pot was closed and " +
        "created again",
    ]);
    expect(keepPots(store, fork)).toEqual([
      `Pot ${pot} on base was already recorded in ${store.dir}`,
    ]);
    expect(store.recordsOf(BASE.id, pot).map((one) => one.deployment?.tx)).toEqual([
      TX,
      `0x${"fe".repeat(32)}`,
    ]);
    expect(store.list().pots).toHaveLength(2);
  });
});

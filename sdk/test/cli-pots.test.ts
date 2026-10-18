/**
 * What the `sauce` command records of a Pot (`cli/pots.ts`), offline: which release minted it, told
 * from its address under every Kitchen and Pot init-code hash `releases.json` records and each kind
 * of Pot; the Pots a landed EVM transaction deployed, from the Kitchen's `PotDeployed`; those a
 * Solana transaction created, from the Kitchen's `create_pot`, its accounts loaded through a lookup
 * table too; and the scope a command keeps its stores in (`keep.ts`), which writes them as they
 * land, each scope apart. That the real
 * Kitchen mints where these say is `cli-pots.e2e.test.ts`'s, on anvil.
 */
import { mkdtempSync, rmSync } from "node:fs";
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
import { PotStore } from "../src/cli/pot-store.js";
import type { Sent } from "../src/cli/chain.js";
import { keeping, keepLanded } from "../src/cli/keep.js";
import {
  evmPotRelease,
  evmPotsDeployed,
  importSvmPot,
  keepPots,
  svmPotsCreated,
} from "../src/cli/pots.js";
import {
  sdkCompilerVersion,
  V12_RELEASE_SETS,
  v12SvmEngineProgramId,
  v12SvmKitchenProgramId,
} from "../src/deployments/index.js";
import { buildCreatePotInstruction, derivePotPda } from "../src/svm/kitchen.js";

const OWNER = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
const SALT = keccak256(new TextEncoder().encode("treasury"));
const SENDER = getAddress("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
const TX = `0x${"ab".repeat(32)}` as Hex;
const BASE = requireChain("base");
const SOLANA = requireChain("solana");

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

const own = V12_RELEASE_SETS.find((set) => set.compiler === sdkCompilerVersion())!;
const KITCHEN = getAddress(own["kitchen-evm"].kitchen!);

describe("which release minted an EVM Pot", () => {
  it("tells every recorded release, and each kind of Pot, from the address alone", () => {
    for (const set of V12_RELEASE_SETS) {
      const { kitchen, potInitCodeHash } = set["kitchen-evm"];
      // A release not out yet mints no Pot, and names no Kitchen or hash to tell one by.
      if (kitchen === null || potInitCodeHash === null) continue;
      const cases = [
        { owner: OWNER, fixed: false, kind: "private" },
        { owner: OWNER, fixed: true, kind: "private-fixed-router" },
        { owner: zeroAddress, fixed: true, kind: "shared" },
      ] as const;
      for (const { owner, fixed, kind } of cases) {
        const pot = potOf(kitchen!, potInitCodeHash!, owner, SALT, fixed);
        const found = evmPotRelease({ kitchen: getAddress(kitchen!), owner, salt: SALT, pot });
        expect([set.compiler, kind, found?.kind]).toEqual([set.compiler, kind, kind]);
        expect(found?.family.potInitCodeHash).toBe(potInitCodeHash);
        expect(found?.family.sets.map((one) => one["kitchen-evm"].version)).toContain(
          set["kitchen-evm"].version,
        );
      }
    }
  });

  it("knows no Pot of another Kitchen, another owner or another salt", () => {
    const pot = potOf(KITCHEN, own["kitchen-evm"].potInitCodeHash!, OWNER, SALT, false);
    expect(evmPotRelease({ kitchen: KITCHEN, owner: SENDER, salt: SALT, pot })).toBeUndefined();
    expect(
      evmPotRelease({ kitchen: KITCHEN, owner: OWNER, salt: `0x${"00".repeat(32)}`, pot }),
    ).toBeUndefined();
    expect(evmPotRelease({ kitchen: SENDER, owner: OWNER, salt: SALT, pot })).toBeUndefined();
  });
});

describe("the Pots a landed EVM transaction deployed", () => {
  const pot = potOf(KITCHEN, own["kitchen-evm"].potInitCodeHash!, OWNER, SALT, false);
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
      potInitCodeHash: own["kitchen-evm"].potInitCodeHash,
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
        chain: SOLANA,
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

  it("records a create_pot a program invoked, as the Portal creates its executor's Pot in a fill", async () => {
    const { pot, create } = await createOf();
    // An instruction of another program that takes every account the Kitchen's create_pot does,
    // and invokes it: the node reports the Kitchen's instruction among the inner ones.
    const portal = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
    const outer: Instruction = {
      programAddress: portal,
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
    const at = { chain: SOLANA, transaction, signature: "sig", slot: 99n, ok: true };
    expect(await svmPotsCreated({ ...at, genesis: never })).toEqual([]);
    expect(await svmPotsCreated({ ...at, inner, genesis: MAINNET })).toEqual([
      recordOf(pot, "mainnet-beta"),
    ]);
  });

  it("records a devnet Pot as devnet's, filed apart from the mainnet Pot at the same address", async () => {
    const { pot, create } = await createOf();
    const at = {
      chain: SOLANA,
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
    const at = { chain: SOLANA, signature: "sig", slot: 1n, genesis: never };
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
    const pot = potOf(KITCHEN, own["kitchen-evm"].potInitCodeHash!, OWNER, SALT, false);
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
    const pot = potOf(KITCHEN, own["kitchen-evm"].potInitCodeHash!, OWNER, SALT, false);
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

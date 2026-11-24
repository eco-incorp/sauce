/**
 * A Solana Pot in each state the Kitchen cooks, on the `sauce` command's own paths, against the
 * released Kitchen and engine in LiteSVM behind the JSON-RPC shim (`rpc-shim.ts`).
 *
 * The Kitchen signs for a Pot's address whether or not `create_pot` ever made the account (its IDL:
 * the Pot "holds no data and need not exist for a program that keeps no storage"), and the command
 * cooked such an address before this release. An address that holds only lamports (the System
 * Program's, no data) is a Pot no engine owns yet: it is cooked as it is, on the installed engine,
 * with no `create_pot`, and stays the System Program's. That is also the only state in which a
 * program can pay SOL out of the Pot through the System Program, whose transfer takes no `from`
 * that carries data. Anyone can put an address in that state by sending it lamports, so refusing it
 * would let a stranger stop an owner's first cook for the price of an empty account's rent.
 *
 * GATED on the engine artifacts like every engine-executing suite, and a hard failure without them
 * in CI. Not run on the legacy arm: its CLI suites load the engine at the released id themselves.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  address,
  createKeyPairSignerFromBytes,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  lamports,
  type Address,
  type KeyPairSigner,
  type Transaction,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { hexToBytes } from "viem";

import { requireChain } from "../../src/chains/canonical.js";
import { decodeCursor } from "../../src/cli/svm-plan.js";
import { potSalt } from "../../src/deployments/pot.js";
import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../../src/deployments/index.js";
import { compileSauceProgram } from "../../src/routes/sauce-route.js";
import { svmTokenRows } from "../../src/routes/token-registry.js";
import { svmEngineReleases } from "../../src/svm/engine-release.js";
import {
  buildCookInstruction,
  buildCreatePotInstruction,
  buildExecuteTransaction,
  buildSetExecutionFeeInstruction,
  derivePotPda,
  deriveProgramDataPda,
  KITCHEN_DISCRIMINATORS,
  MAX_POT_LEN,
} from "../../src/svm/index.js";
import { jsonOf, sauce, type Run } from "../cli-anvil.js";
import {
  describeSvm,
  ENGINE_SO,
  randomAddress,
  sendInstructions,
  sendSigned,
  setMint,
  setTokenAccount,
  startEngine,
  tokenAmount,
  type EngineHarness,
} from "./engine-harness.js";
import { solanaShim, type SolanaShim } from "./rpc-shim.js";

const RPC_URL = "http://127.0.0.1:65530/";
const SYSTEM = address("11111111111111111111111111111111");
const INSTALLED = address(v12SvmEngineProgramId());
const KITCHEN = address(v12SvmKitchenProgramId());
/** v12-svm 1.3.0's engine: no release of this SDK's compiler runs on it, and the only created Pots
 *  on mainnet-beta are its. The program itself need not be on the bank for a Pot it owns. */
const OLD = address("2HH8xZ7ZN8SSDD8B3ALYANTVKBbMKGxTzjX7LTzvtSzT");

/** The docs' payout: `pay.sauce.ts <recipient> <amount>`, USDC from the Pot; past one transaction. */
const PAY = fileURLToPath(new URL("../../../docs/examples/pay.sauce.ts", import.meta.url));
/** A program that returns 7: it fits one transaction, so a cluster simulates it. */
const SEVEN = ["// @chain solana", "function main(): Uint256 {", "  return 7;", "}", ""].join("\n");
/** A program carrying `bytes` literal bytes: past one transaction, so it is staged. */
const blobSource = (bytes: number): string =>
  [
    "// @chain solana",
    "function main(): Uint256 {",
    `  const blob = hex\`${"ab".repeat(bytes)}\`;`,
    `  const at = ctx.timestamp() % ${bytes};`,
    "  const value = blob.slice(at, at + 1).toBe();",
    "  require(value == 171);",
    "  return value;",
    "}",
    "",
  ].join("\n");
/** The Pot pays 1,000,000 lamports to `to` through the System Program. */
const SOL_PAYOUT = [
  "// @chain solana",
  "function main(system: Account, pot: Account<Writable, Signer>, to: Account<Writable>) {",
  "  let native = hex`02000000`;",
  "  svm.call(system, [pot, to], native.concat(1000000n.toBytesLe(8)));",
  "}",
  "",
].join("\n");
/** A program that requires the Pot's owner to be the engine that runs it. */
const OWNER_CHECK = [
  "// @chain solana",
  "function main(pot: Account<Signer>): Uint256 {",
  '  require(pot.owner == ctx.self(), "the engine does not own the Pot");',
  "  return 7;",
  "}",
  "",
].join("\n");
/** The same check on an account the command is told by name, `p`: the Pot's account, passed in. */
const LAMPORTS_CHECK = [
  "// @chain solana",
  "function main(p: Account<Signer>): Uint256 {",
  '  require(p.owner == ctx.self(), "lamport-owner-check");',
  "  return 7;",
  "}",
  "",
].join("\n");
/** The same, in a program past one transaction: staged first, then cooked from its code buffer. */
const ownerCheckStaged = (bytes: number): string =>
  [
    "// @chain solana",
    "function main(pot: Account<Signer>): Uint256 {",
    `  const blob = hex\`${"ab".repeat(bytes)}\`;`,
    `  const at = ctx.timestamp() % ${bytes};`,
    "  const value = blob.slice(at, at + 1).toBe();",
    "  require(value == 171);",
    '  require(pot.owner == ctx.self(), "the engine does not own the Pot");',
    "  return value;",
    "}",
    "",
  ].join("\n");

/** The part of a compiled message these tests read: its accounts and instructions. */
interface Compiled {
  readonly staticAccounts: readonly string[];
  readonly instructions: readonly {
    readonly programAddressIndex: number;
    readonly accountIndices?: readonly number[];
    readonly data?: Uint8Array;
  }[];
}
/** Where the engine is among a Kitchen cook's accounts: `cook`'s second, `cook_from_account`'s fourth. */
const ENGINE_AT = [
  [KITCHEN_DISCRIMINATORS.cook, 1],
  [KITCHEN_DISCRIMINATORS.cookFromAccount, 3],
] as const;
/** The engine the Kitchen cook in `transaction` names; `undefined` for a transaction with none. */
function cookEngine(transaction: Transaction): string | undefined {
  const message = getCompiledTransactionMessageDecoder().decode(
    transaction.messageBytes,
  ) as unknown as Compiled;
  for (const instruction of message.instructions) {
    if (message.staticAccounts[instruction.programAddressIndex] !== KITCHEN) continue;
    const found = ENGINE_AT.find(([head]) =>
      head.every((byte, at) => instruction.data?.[at] === byte),
    );
    const index = found === undefined ? undefined : instruction.accountIndices?.[found[1]];
    if (index !== undefined) return message.staticAccounts[index];
  }

  return undefined;
}
/** The engines whose `invoke` a log names: the cook's own, not the Kitchen's. */
const enginesInvoked = (logs: readonly string[]): string[] =>
  [INSTALLED, OLD].filter((engine) =>
    logs.some((line) => line.startsWith(`Program ${engine} invoke`)),
  );

/** What `sauce simulate --json` returns, as these tests read it. */
interface Simulated {
  readonly ok: boolean;
  readonly path: string;
  readonly pot?: string;
  readonly logs: string[];
  readonly createPot?: unknown;
  readonly tokenChanges?: ReadonlyArray<{ readonly delta: string }>;
}
/** What `sauce tx --json` hands out: the cook alone, or a plan's step. */
interface Planned {
  readonly createsPot?: boolean;
  readonly transaction?: string;
  readonly step?: string;
  readonly transactions?: ReadonlyArray<{ readonly what: string }>;
  readonly cursor: string;
}
/** What `sauce run --json` reports of the cook. */
interface Ran {
  readonly cook: { readonly status: string };
  readonly createPot?: unknown;
}
/** What `sauce send --cursor --json` returns: what was sent, and the step after. */
interface Sent {
  readonly ok: boolean;
  readonly next: Planned;
}
/** What `sauce pot --json` says of the cluster. */
interface PotStatus {
  readonly deployment: { readonly pot: Record<string, unknown> };
}
const read = <T>(run: Run): T => jsonOf(run) as unknown as T;

describeSvm("a Solana Pot in each state the Kitchen cooks", () => {
  let harness: EngineHarness;
  let shim: SolanaShim;
  let work: string;
  let seven: string;
  let blob: string;
  let payout: string;
  const recipient = randomAddress();

  const keypair = async (name: string): Promise<{ path: string; signer: KeyPairSigner }> => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
    const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const bytes = new Uint8Array([...seed, ...pub]);
    const path = join(work, `${name}.json`);
    writeFileSync(path, JSON.stringify([...bytes]));
    const signer = await createKeyPairSignerFromBytes(bytes);
    harness.svm.airdrop(signer.address, lamports(50_000_000_000n));

    return { path, signer };
  };
  const potOf = async (owner: Address, salt: string): Promise<Address> =>
    (await derivePotPda(KITCHEN, owner, hexToBytes(potSalt(salt)))).address;
  const ataOf = async (holder: Address, mint: Address): Promise<Address> =>
    (await findAssociatedTokenPda({ owner: holder, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];
  /** The Pot as that release's create_pot left it: 10,240 bytes, the engine its owner program. */
  const plantOld = async (owner: Address, salt: string): Promise<Address> => {
    const pot = await potOf(owner, salt);
    harness.svm.setAccount({
      address: pot,
      data: new Uint8Array(MAX_POT_LEN),
      executable: false,
      lamports: lamports(harness.svm.minimumBalanceForRentExemption(BigInt(MAX_POT_LEN))),
      programAddress: OLD,
      space: BigInt(MAX_POT_LEN),
    });

    return pot;
  };
  /** A Pot `create_pot` made under `engine`, as a cluster holds it. */
  const createUnder = async (
    owner: KeyPairSigner,
    salt: string,
    engine: Address,
  ): Promise<Address> => {
    const pot = await potOf(owner.address, salt);
    harness.svm.expireBlockhash();
    const created = sendSigned(
      harness,
      await buildExecuteTransaction({
        payer: owner,
        instructions: [
          buildCreatePotInstruction({
            kitchen: KITCHEN,
            owner: owner.address,
            engineProgram: engine,
            pot,
            salt: hexToBytes(potSalt(salt)),
            space: MAX_POT_LEN,
          }),
        ],
        latestBlockhash: {
          blockhash: harness.svm.latestBlockhash(),
          lastValidBlockHeight: 1_000_000n,
        },
      }),
    );
    if (!created.ok) throw new Error(`create_pot failed: ${created.err}`);

    return pot;
  };
  /** The flags that name `owner`'s Pot of `salt` on the cluster, for a command that signs nothing. */
  const named = (owner: Address, salt: string): string[] => [
    ...["--chain", "solana", "--owner", owner, "--salt", salt, "--rpc-url", RPC_URL],
  ];
  /** The flags of a command that signs as the keypair at `path`: its own Pot of `salt`. */
  const signedAs = (path: string, salt: string): string[] => [
    ...["--chain", "solana", "--salt", salt, "--rpc-url", RPC_URL, "--keypair", path],
  ];
  const account = (key: Address) => harness.svm.getAccount(key);
  const dataLength = (key: Address): number | undefined => {
    const held = harness.svm.getAccount(key);

    return held.exists ? held.data.length : undefined;
  };
  /** One JSON-RPC request the command makes, as the endpoint is asked it. */
  interface RpcRequest {
    readonly id: unknown;
    readonly method: string;
    readonly params?: readonly unknown[];
  }
  /**
   * Runs `command` with `hook` seeing each JSON-RPC request it makes, in order: a response from the
   * hook is the endpoint's answer, and `undefined` leaves the request to the bank. The hook may wait
   * (to change the bank before the request is answered).
   */
  const through = async <T>(
    hook: (request: RpcRequest) => Response | undefined | Promise<Response | undefined>,
    command: () => Promise<T>,
  ): Promise<T> => {
    const bank = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      (await hook(JSON.parse(String(init?.body ?? "{}")) as RpcRequest)) ??
      bank(input, init)) as typeof fetch;
    try {
      return await command();
    } finally {
      globalThis.fetch = bank;
    }
  };
  /** An endpoint's error answer to `request`. */
  const failing = (request: RpcRequest, message: string): Response =>
    Response.json({ id: request.id, jsonrpc: "2.0", error: { code: -32099, message } });
  /** A hook that puts 1,000,000 lamports on `pot` as the command's `nth` read of it is answered. */
  const fundedAtRead = (pot: Address, nth: number) => {
    let reads = 0;

    return (request: RpcRequest): undefined => {
      if (request.method === "getAccountInfo" && request.params?.[0] === pot && ++reads === nth) {
        harness.svm.airdrop(pot, lamports(1_000_000n));
      }

      return undefined;
    };
  };
  /** The Kitchen's execution fee, set by the authority that initialized it. */
  const setFee = async (fee: bigint): Promise<void> => {
    const { address: programData } = await deriveProgramDataPda(KITCHEN);
    const set = await sendInstructions(harness, [
      buildSetExecutionFeeInstruction({
        kitchen: KITCHEN,
        authority: harness.payer.address,
        programData,
        feeConfig: harness.feeConfig,
        fee,
      }),
    ]);
    if (!set.ok) throw new Error(`set_execution_fee failed: ${set.err}`);
  };

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n, ENGINE_SO as string, INSTALLED);
    work = mkdtempSync(join(tmpdir(), "sauce-pot-states-"));
    seven = join(work, "seven.sauce.ts");
    blob = join(work, "blob.sauce.ts");
    payout = join(work, "payout.sauce.ts");
    writeFileSync(seven, SEVEN);
    writeFileSync(blob, blobSource(1500));
    writeFileSync(payout, SOL_PAYOUT);
    shim = solanaShim(harness.svm, RPC_URL);
    shim.install();
  }, 120_000);

  afterAll(() => {
    shim?.restore();
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  describe("an address that holds only lamports", () => {
    it("simulates, plans and runs a cook on it, as it is, on the installed engine, and leaves it the System Program's", async () => {
      const owner = await keypair("prefunded");
      const pot = await potOf(owner.signer.address, "prefunded");
      harness.svm.airdrop(pot, lamports(5_000_000n));
      expect(account(pot)).toMatchObject({ exists: true, programAddress: SYSTEM });
      const flags = named(owner.signer.address, "prefunded");

      // On the cluster, a program that fits one transaction: simulated with no create_pot ahead of it.
      const simulated = await sauce("simulate", seven, ...flags, "--json");
      const inline = read<Simulated>(simulated);
      expect(inline).toMatchObject({ ok: true, pot, path: "simulateTransaction", createPot: null });
      expect(inline.logs.some((line) => line.startsWith(`Program ${INSTALLED} invoke`))).toBe(true);
      expect(simulated.stderr).toContain(
        `Pot ${pot} holds 5000000 lamports and no engine owns it yet`,
      );

      // The plan: the cook alone, creating nothing.
      const planned = await sauce("tx", seven, ...flags);
      expect(read<Planned>(planned)).toMatchObject({ createsPot: false });
      expect(planned.stderr).toContain(
        `Pot ${pot} holds 5000000 lamports and no engine owns it yet`,
      );

      // Sent: it succeeds, creates no Pot, and the address is still the System Program's, with what
      // it held.
      const ran = await sauce(
        "run",
        seven,
        ...signedAs(owner.path, "prefunded"),
        "--yes",
        "--json",
      );
      expect(read<Ran>(ran).cook).toMatchObject({ status: "success" });
      expect(read<Ran>(ran).createPot).toBeUndefined();
      expect(account(pot)).toMatchObject({ programAddress: SYSTEM, lamports: 5_000_000n });
      expect(dataLength(pot)).toBe(0);
    }, 180_000);

    it("pays SOL out of it through the System Program, which a Pot carrying data could not", async () => {
      const owner = await keypair("sol-payout");
      const pot = await potOf(owner.signer.address, "sol-payout");
      const to = randomAddress();
      harness.svm.airdrop(pot, lamports(5_000_000n));
      const ran = await sauce(
        ...["run", payout, ...signedAs(owner.path, "sol-payout")],
        ...["--account", "system=system", "--account", "pot=pot", "--account", `to=${to}`],
        ...["--yes", "--json"],
      );
      expect(read<Ran>(ran).cook).toMatchObject({ status: "success" });
      expect(account(to)).toMatchObject({ exists: true, lamports: 1_000_000n });
      expect(account(pot)).toMatchObject({ programAddress: SYSTEM, lamports: 4_000_000n });
    }, 180_000);

    it("moves the Pot's tokens in a staged cook: simulated in the local copy, then sent", async () => {
      const owner = await keypair("staged");
      const pot = await potOf(owner.signer.address, "staged");
      harness.svm.airdrop(pot, lamports(5_000_000n));
      const usdc = address(
        svmTokenRows(requireChain("solana")).find((row) => row.symbol === "USDC")!.mint,
      );
      setMint(harness, usdc, 6);
      const potUsdc = await ataOf(pot, usdc);
      setTokenAccount(harness, potUsdc, usdc, pot, 3_000_000n);
      const toUsdc = await ataOf(recipient, usdc);
      setTokenAccount(harness, toUsdc, usdc, recipient, 0n);
      const args = ["--args", recipient, "1000000"];

      // Past one transaction, so the local copy simulates it: the Pot's signature through the engine's
      // CPI into the token program, from an address the System Program owns.
      const simulated = read<Simulated>(
        await sauce("simulate", PAY, ...named(owner.signer.address, "staged"), ...args, "--json"),
      );
      expect(simulated).toMatchObject({ ok: true, path: "local copy (LiteSVM)", pot });
      expect(simulated.tokenChanges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ delta: "-1000000" }),
          expect.objectContaining({ delta: "1000000" }),
        ]),
      );
      expect(tokenAmount(harness, toUsdc)).toBe(0n);

      const ran = await sauce(
        "run",
        PAY,
        ...signedAs(owner.path, "staged"),
        ...args,
        "--yes",
        "--json",
      );
      expect(read<Ran>(ran).cook).toMatchObject({ status: "success" });
      expect(tokenAmount(harness, toUsdc)).toBe(1_000_000n);
      expect(tokenAmount(harness, potUsdc)).toBe(2_000_000n);
      expect(account(pot)).toMatchObject({ programAddress: SYSTEM });
    }, 180_000);

    it("carries on a plan whose Pot was funded after its cursor was made: no create_pot, no refusal", async () => {
      const owner = await keypair("planned");
      const pot = await potOf(owner.signer.address, "planned");
      const flags = named(owner.signer.address, "planned");
      // The Pot is missing, so the plan's setup creates it, first.
      const first = read<Planned>(await sauce("tx", blob, ...flags));
      expect(first.step).toBe("setup");
      expect(first.transactions!.map((tx) => tx.what)[0]).toBe("creating the Pot");
      // Lamports reach the address before the owner signs a thing.
      harness.svm.airdrop(pot, lamports(1_000_000n));
      const resumedRun = await sauce(
        "send",
        "--cursor",
        first.cursor,
        "--rpc-url",
        RPC_URL,
        "--json",
      );
      const resumed = read<Sent>(resumedRun);
      expect(resumed.ok).toBe(true);
      // The step that created the Pot is gone, and the plan says so rather than carry on in silence.
      expect(resumedRun.stderr).toContain(
        `Pot ${pot} holds 1000000 lamports and no engine owns it yet, so the step of this plan ` +
          "that creates it is dropped",
      );
      expect(resumed.next.step).toBe("setup");
      const whats = resumed.next.transactions!.map((tx) => tx.what);
      expect(whats).not.toContain("creating the Pot");
      expect(whats[0]).toBe("creating the code buffer");
      expect(account(pot)).toMatchObject({ programAddress: SYSTEM, lamports: 1_000_000n });
    }, 180_000);

    it("tells a run that stops before its cook is sent what holds the address, and the same run passes once --deploy has created it", async () => {
      // Anyone can put a new owner's Pot address in this state for the rent of an empty account: what
      // the note says is what tells that owner to run `sauce pot --deploy`.
      const owner = await keypair("lamports-fail");
      const pot = await potOf(owner.signer.address, "lamports-fail");
      harness.svm.airdrop(pot, lamports(1_000_000n));
      const program = join(work, "lamports-check.sauce.ts");
      writeFileSync(program, LAMPORTS_CHECK);
      const flags = [
        ...signedAs(owner.path, "lamports-fail"),
        ...["--account", `p=${pot}`, "--yes"],
      ];
      const sent = shim.sent.length;

      const before = await sauce("run", program, ...flags);
      expect(before.code).toBe(1);
      expect(before.stderr).toContain("the cook would fail, so it was not sent");
      expect(before.stderr).toContain("lamport-owner-check");
      expect(before.stderr).toContain(
        `Pot ${pot} holds 1000000 lamports and no engine owns it yet`,
      );
      expect(before.stderr).toContain("`sauce pot --deploy` creates it");
      expect(shim.sent.length).toBe(sent);

      const deployed = await sauce("pot", "--deploy", ...signedAs(owner.path, "lamports-fail"));
      expect(deployed.code).toBe(0);
      expect(account(pot)).toMatchObject({ programAddress: INSTALLED });
      const after = await sauce("run", program, ...flags);
      expect(after.code).toBe(0);
      expect(after.stderr).not.toContain("no engine owns it yet");
    }, 180_000);

    it("is not created: `sauce pot` says so and that cooks run on it, and --deploy creates it, keeping its lamports", async () => {
      const owner = await keypair("deployed");
      const pot = await potOf(owner.signer.address, "deployed");
      harness.svm.airdrop(pot, lamports(3_000_000n));
      const status = await sauce("pot", ...named(owner.signer.address, "deployed"));
      expect(read<PotStatus>(status).deployment.pot).toEqual({ address: pot, deployed: false });
      expect(status.stderr).toContain(
        `The Pot ${pot} holds 3000000 lamports and no engine owns it, so it is not created: cooks run on it as it is`,
      );
      expect(status.stderr).not.toContain("is already created");

      // --deploy: the Kitchen's create_pot succeeds on a prefunded address (it tops up the rent, then
      // allocates and assigns), so it is created, for the installed engine, with what it held kept.
      const deployed = await sauce("pot", "--deploy", ...signedAs(owner.path, "deployed"));
      expect(deployed.code).toBe(0);
      expect(deployed.stderr).not.toContain("is already created");
      expect(deployed.stderr).toContain(`held 3000000 lamports and no engine owned it`);
      expect(read<{ deployed: boolean }>(deployed).deployed).toBe(true);
      expect(account(pot)).toMatchObject({ programAddress: INSTALLED });
      expect(dataLength(pot)).toBe(MAX_POT_LEN);

      // Created now: reported so, on the engine that owns it, and a second --deploy changes nothing.
      const after = await sauce("pot", ...named(owner.signer.address, "deployed"));
      expect(read<PotStatus>(after).deployment.pot).toEqual({
        address: pot,
        deployed: true,
        engine: INSTALLED,
      });
      const again = await sauce("pot", "--deploy", ...signedAs(owner.path, "deployed"));
      expect(again.stderr).toContain(`Pot ${pot} is already created on solana.`);
    }, 180_000);

    describe("when it comes to hold lamports between the command's first read of it and its second", () => {
      // A node a slot behind answers the first read, and the owner funds the address right after: the
      // plan reads it again and builds from that. What it says of the Pot is the plan's, not the first
      // read's.
      const note = (pot: Address): string =>
        `Pot ${pot} holds 1000000 lamports and no engine owns it yet`;

      it("says so on a run that stops because its cook would fail, and sends nothing", async () => {
        const owner = await keypair("changed-fail");
        const pot = await potOf(owner.signer.address, "changed-fail");
        const program = join(work, "changed-check.sauce.ts");
        writeFileSync(program, LAMPORTS_CHECK);
        const sent = shim.sent.length;

        const ran = await through(fundedAtRead(pot, 2), () =>
          sauce(
            "run",
            program,
            ...signedAs(owner.path, "changed-fail"),
            ...["--account", `p=${pot}`, "--yes"],
          ),
        );
        expect(ran.code).toBe(1);
        expect(ran.stderr).toContain("the cook would fail, so it was not sent");
        expect(ran.stderr).toContain("lamport-owner-check");
        expect(ran.stderr).toContain(note(pot));
        expect(shim.sent.length).toBe(sent);
        expect(account(pot)).toMatchObject({ programAddress: SYSTEM, lamports: 1_000_000n });
      }, 180_000);

      it("says so with the result of a run whose cook was sent", async () => {
        const owner = await keypair("changed-run");
        const pot = await potOf(owner.signer.address, "changed-run");
        const sent = shim.sent.length;

        const ran = await through(fundedAtRead(pot, 2), () =>
          sauce("run", seven, ...signedAs(owner.path, "changed-run"), "--yes", "--json"),
        );
        expect(ran.code).toBe(0);
        expect(read<Ran>(ran).cook).toMatchObject({ status: "success" });
        expect(shim.sent.length).toBeGreaterThan(sent);
        expect(ran.stderr).toContain(note(pot));
        expect(account(pot)).toMatchObject({ programAddress: SYSTEM });
      }, 180_000);

      it("says so on `sauce tx`, which does not claim the Pot is created", async () => {
        const owner = await keypair("changed-tx");
        const pot = await potOf(owner.signer.address, "changed-tx");

        const planned = await through(fundedAtRead(pot, 2), () =>
          sauce("tx", seven, ...named(owner.signer.address, "changed-tx")),
        );
        expect(planned.code).toBe(0);
        expect(planned.stderr).toContain(note(pot));
        expect(planned.stderr).toContain("Fund its accounts with what the program spends.");
        expect(planned.stderr).not.toContain("It is created.");
      }, 180_000);
    });

    describe("when it comes to hold lamports after the plan chose how the Pot is created", () => {
      // The plan reads the Pot (its second read) and chooses: to create it in the cook's own
      // transaction, or in the setup. The step then reads it (its third read), once, and builds from
      // that read: what the step does and says of the Pot is that read's, whatever the plan chose.
      const dropped = (pot: Address): string =>
        `Pot ${pot} holds 1000000 lamports and no engine owns it yet, so the step of this plan ` +
        "that creates it is dropped";

      it("tells a cook planned to create the Pot, which then creates nothing, that the Pot is funded", async () => {
        const owner = await keypair("third-inline");
        const pot = await potOf(owner.signer.address, "third-inline");

        const planned = await through(fundedAtRead(pot, 3), () =>
          sauce("tx", seven, ...named(owner.signer.address, "third-inline")),
        );
        expect(planned.code).toBe(0);
        // Nothing creates it, and the notes say what the transaction does: not both that it creates
        // the Pot and that nothing does.
        expect(read<Planned>(planned)).toMatchObject({ createsPot: false });
        expect(planned.stderr).toContain(dropped(pot));
        expect(planned.stderr).toContain("Fund its accounts with what the program spends.");
        expect(planned.stderr).not.toContain("this transaction creates it");
        expect(planned.stderr).not.toContain("It is created.");
        expect(account(pot)).toMatchObject({ programAddress: SYSTEM, lamports: 1_000_000n });
      }, 180_000);

      it("does the same for a setup planned to create the Pot: no create_pot among its transactions, and no claim that the setup creates it", async () => {
        const owner = await keypair("third-setup");
        const pot = await potOf(owner.signer.address, "third-setup");

        const planned = await through(fundedAtRead(pot, 3), () =>
          sauce("tx", blob, ...named(owner.signer.address, "third-setup")),
        );
        expect(planned.code).toBe(0);
        const step = read<Planned>(planned);
        expect(step.step).toBe("setup");
        const whats = step.transactions!.map((tx) => tx.what);
        expect(whats).not.toContain("creating the Pot");
        expect(whats[0]).toBe("creating the code buffer");
        expect(planned.stderr).toContain(dropped(pot));
        expect(planned.stderr).toContain("Fund its accounts with what the program spends.");
        expect(planned.stderr).not.toContain("the setup creates it first");
        expect(account(pot)).toMatchObject({ programAddress: SYSTEM, lamports: 1_000_000n });
      }, 180_000);

      it("builds the cook, and says what it does, from the one read of the Pot: nothing reads it again before the cook is built", async () => {
        const owner = await keypair("fourth-read");
        const pot = await potOf(owner.signer.address, "fourth-read");
        // A fourth read would find the address funded. The step reads the Pot once, so the cook it
        // builds and what is said of it are one story, whatever the address holds later.
        let reads = 0;

        const planned = await through(
          (request) => {
            if (
              request.method === "getAccountInfo" &&
              request.params?.[0] === pot &&
              ++reads === 4
            ) {
              harness.svm.airdrop(pot, lamports(1_000_000n));
            }

            return undefined;
          },
          () => sauce("tx", seven, ...named(owner.signer.address, "fourth-read")),
        );
        expect(planned.code).toBe(0);
        expect(reads).toBe(3);
        expect(read<Planned>(planned)).toMatchObject({ createsPot: true });
        expect(planned.stderr).toContain("transaction creates it");
        expect(planned.stderr).not.toContain("no engine owns it yet");
        expect(account(pot).exists).toBe(false);
      }, 180_000);
    });

    describe("when the Pot is made while the run builds its step, and the run stops there", () => {
      // The first read says the address holds only lamports, and its note is the run's until a later
      // read says otherwise. A step that reads the Pot as made since and then fails says what it
      // read: the first read's note describes an account that is no longer so.
      /**
       * `sauce run` of a cook on an address that holds lamports. At the run's second read of the
       * address `make` makes the Pot, and every read of the latest blockhash fails: the step that
       * read the Pot cannot be built.
       */
      const stoppedAfter = async (
        label: string,
        make: (owner: KeyPairSigner, label: string) => Promise<unknown>,
      ) => {
        const owner = await keypair(label);
        const pot = await potOf(owner.signer.address, label);
        harness.svm.airdrop(pot, lamports(1_000_000n));
        const sent = shim.sent.length;
        let reads = 0;

        const ran = await through(
          async (request) => {
            if (
              request.method === "getAccountInfo" &&
              request.params?.[0] === pot &&
              ++reads === 2
            ) {
              await make(owner.signer, label);
            }

            return request.method === "getLatestBlockhash"
              ? failing(request, "the blockhash read fails")
              : undefined;
          },
          () => sauce("run", seven, ...signedAs(owner.path, label), "--yes"),
        );
        expect(ran.code).toBe(1);
        expect(ran.stderr).toContain("reading the latest blockhash failed");
        expect(shim.sent.length).toBe(sent);

        return { ran, pot };
      };

      it("says nothing of the Pot once the installed engine owns it: the first read's note describes an account that is gone", async () => {
        const { ran, pot } = await stoppedAfter("made-installed", (owner, label) =>
          createUnder(owner, label, INSTALLED),
        );
        expect(account(pot)).toMatchObject({ programAddress: INSTALLED });
        expect(ran.stderr).not.toContain("no engine owns it yet");
        expect(ran.stderr).not.toContain("`sauce pot --deploy` creates it");
      }, 180_000);

      it("says what the step read when v12-svm 1.3.0's engine owns it: that engine's note, not the first read's", async () => {
        const { ran, pot } = await stoppedAfter("made-old", (owner, label) =>
          plantOld(owner.address, label),
        );
        expect(account(pot)).toMatchObject({ programAddress: OLD });
        expect(ran.stderr).toContain(`the Pot ${pot} is owned by v12-svm 1.3.0 (${OLD})`);
        expect(ran.stderr).not.toContain("no engine owns it yet");
      }, 180_000);
    });
  });

  describe("a Pot of v12-svm 1.3.0, which no release of this compiler's output runs on", () => {
    const installedVersion = svmEngineReleases().get(INSTALLED)!.version;
    /** What the owner is told of the Pot's engine: the first part everywhere, the rest of a cook's. */
    const told = (pot: Address): string =>
      `the Pot ${pot} is owned by v12-svm 1.3.0 (${OLD}); it is cooked on v12-svm ${installedVersion}, ` +
      "as earlier SDKs did. Inside the program ctx.self() is the installed engine, so a check that " +
      "the Pot's owner is ctx.self() fails and the Pot's storage cannot be written";
    const cookTold = (pot: Address): string =>
      `${told(pot)}; the cook is not sent if it fails; for a staged program, setup transactions (the ` +
      "code buffer, token accounts) may already have landed and can be closed.";
    let ownerCheck: string;
    let ownerCheckBlob: string;
    beforeAll(() => {
      ownerCheck = join(work, "owner-check.sauce.ts");
      ownerCheckBlob = join(work, "owner-check-blob.sauce.ts");
      writeFileSync(ownerCheck, OWNER_CHECK);
      writeFileSync(ownerCheckBlob, ownerCheckStaged(1500));
    });

    /** The Pot's USDC account holding 3, and an empty one for a fresh recipient: what pay moves. */
    const fundUsdc = async (pot: Address) => {
      const usdc = address(
        svmTokenRows(requireChain("solana")).find((row) => row.symbol === "USDC")!.mint,
      );
      setMint(harness, usdc, 6);
      const to = randomAddress();
      const potUsdc = await ataOf(pot, usdc);
      setTokenAccount(harness, potUsdc, usdc, pot, 3_000_000n);
      const toUsdc = await ataOf(to, usdc);
      setTokenAccount(harness, toUsdc, usdc, to, 0n);

      return { to, potUsdc, toUsdc };
    };
    const cooksOf = (from: number): (string | undefined)[] =>
      shim.sent
        .slice(from)
        .map(cookEngine)
        .filter((engine) => engine !== undefined);

    it("simulates, plans and runs an SPL transfer the Pot signs through the installed engine, and the Pot stays 1.3.0's", async () => {
      const owner = await keypair("old-pay");
      const pot = await plantOld(owner.signer.address, "old-pay");
      const { to, potUsdc, toUsdc } = await fundUsdc(pot);
      const args = ["--args", to, "1000000"];
      const flags = named(owner.signer.address, "old-pay");
      const sent = shim.sent.length;

      // sauce simulate: past one transaction, so in the local copy, which runs the installed
      // engine's own code: the cook names it, and the Pot's signature goes through its CPI.
      const simulated = await sauce("simulate", PAY, ...flags, ...args, "--json");
      const out = read<Simulated>(simulated);
      expect(out).toMatchObject({ ok: true, path: "local copy (LiteSVM)", pot });
      expect(enginesInvoked(out.logs)).toEqual([INSTALLED]);
      expect(out.tokenChanges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ delta: "-1000000" }),
          expect.objectContaining({ delta: "1000000" }),
        ]),
      );
      expect(simulated.stderr).toContain(cookTold(pot));

      // sauce tx: the plan's first step and its cursor, which names no engine (the installed
      // engine is the cursor's own).
      const planned = await sauce("tx", PAY, ...flags, ...args);
      expect(read<Planned>(planned).step).toBe("setup");
      expect(decodeCursor(read<Planned>(planned).cursor).engine).toBeUndefined();
      expect(planned.stderr).toContain(cookTold(pot));

      // These two send nothing, and move nothing.
      expect(shim.sent.length).toBe(sent);
      expect(tokenAmount(harness, toUsdc)).toBe(0n);

      // sauce run: sent, through the installed engine, and the tokens move.
      const ran = await sauce(
        "run",
        PAY,
        ...signedAs(owner.path, "old-pay"),
        ...args,
        "--yes",
        "--json",
      );
      expect(read<Ran>(ran).cook).toMatchObject({ status: "success" });
      expect(tokenAmount(harness, toUsdc)).toBe(1_000_000n);
      expect(tokenAmount(harness, potUsdc)).toBe(2_000_000n);
      expect(account(pot)).toMatchObject({ programAddress: OLD });
      expect(cooksOf(sent)).toEqual([INSTALLED]);
    }, 180_000);

    it("cooks a program that fits one transaction there too: simulated on the cluster, planned, sent", async () => {
      const owner = await keypair("old-seven");
      const pot = await plantOld(owner.signer.address, "old-seven");
      const flags = named(owner.signer.address, "old-seven");
      const sent = shim.sent.length;

      const simulated = await sauce("simulate", seven, ...flags, "--json");
      const out = read<Simulated>(simulated);
      expect(out).toMatchObject({ ok: true, pot, path: "simulateTransaction", createPot: null });
      expect(enginesInvoked(out.logs)).toEqual([INSTALLED]);
      expect(simulated.stderr).toContain(cookTold(pot));
      const planned = await sauce("tx", seven, ...flags);
      expect(read<Planned>(planned)).toMatchObject({ createsPot: false });
      expect(shim.sent.length).toBe(sent);

      const ran = await sauce(
        "run",
        seven,
        ...signedAs(owner.path, "old-seven"),
        "--yes",
        "--json",
      );
      expect(read<Ran>(ran).cook).toMatchObject({ status: "success" });
      expect(cooksOf(sent)).toEqual([INSTALLED]);
      expect(account(pot)).toMatchObject({ programAddress: OLD });
    }, 180_000);

    it("fails a program that requires the Pot's owner to be ctx.self() at the simulation, and sends nothing; the installed engine's own Pot passes it", async () => {
      const owner = await keypair("old-check");
      const pot = await plantOld(owner.signer.address, "old-check");
      const accounts = ["--account", "pot=pot"];
      const sent = shim.sent.length;

      const simulated = await sauce(
        ...["simulate", ownerCheck, ...named(owner.signer.address, "old-check")],
        ...[...accounts, "--json"],
      );
      expect(simulated.code).toBe(1);
      expect(JSON.parse(simulated.stdout)).toMatchObject({
        ok: false,
        reason: 'the program threw "the engine does not own the Pot"',
      });
      expect(simulated.stderr).toContain(cookTold(pot));
      // The plan is not built for a cook that fails, and the run does not send one.
      const planned = await sauce(
        ...["tx", ownerCheck, ...named(owner.signer.address, "old-check"), ...accounts],
      );
      expect(planned.code).toBe(1);
      expect(planned.stderr).toContain("the engine does not own the Pot");
      expect(planned.stderr).toContain(cookTold(pot));
      // A plan resumed from its cursor says the Pot's engine as the command that made it did, and
      // the cook it simulates again still fails. The failing plan prints its cursor all the same.
      const { cursor } = JSON.parse(planned.stdout) as Planned;
      const resumed = await sauce("send", "--cursor", cursor, "--rpc-url", RPC_URL, "--json");
      expect(resumed.code).toBe(0);
      expect(resumed.stderr).toContain(cookTold(pot));
      expect(resumed.stderr).toContain("simulated now, the cook would fail");
      const ran = await sauce(
        ...["run", ownerCheck, ...signedAs(owner.path, "old-check"), ...accounts, "--yes"],
      );
      expect(ran.code).toBe(1);
      expect(ran.stderr).toContain("the cook would fail, so it was not sent");
      // A run that stops before its cook is sent is told what the Pot is, beside why it stopped.
      expect(ran.stderr).toContain("the engine does not own the Pot");
      expect(ran.stderr).toContain(cookTold(pot));
      expect(shim.sent.length).toBe(sent);

      // The same program on a Pot the installed engine created: its owner is ctx.self().
      const fresh = await keypair("new-check");
      const created = await createUnder(fresh.signer, "new-check", INSTALLED);
      const control = await sauce(
        ...["simulate", ownerCheck, ...named(fresh.signer.address, "new-check")],
        ...[...accounts, "--json"],
      );
      expect(read<Simulated>(control)).toMatchObject({ ok: true, pot: created });
    }, 180_000);

    it("stops a staged program that fails the owner check before its cook: the setup landed, no cook did, and the buffer is closed", async () => {
      const owner = await keypair("old-staged");
      const pot = await plantOld(owner.signer.address, "old-staged");
      const accounts = ["--account", "pot=pot"];
      // The plan's setup, as asking for it lists it: nothing is sent by asking.
      const planned = read<Planned>(
        await sauce(
          ...["tx", ownerCheckBlob, ...named(owner.signer.address, "old-staged"), ...accounts],
        ),
      );
      expect(planned.step).toBe("setup");
      const setup = planned.transactions!.map((tx) => tx.what);
      expect(setup).not.toContain("creating the Pot");
      expect(setup[0]).toBe("creating the code buffer");
      const sent = shim.sent.length;

      const ran = await sauce(
        ...["run", ownerCheckBlob, ...signedAs(owner.path, "old-staged"), ...accounts, "--yes"],
      );
      expect(ran.code).toBe(1);
      expect(ran.stderr).toContain("the cook would fail, so it was not sent");
      expect(ran.stderr).toContain("the engine does not own the Pot");
      expect(ran.stderr).toContain(cookTold(pot));
      // What landed: every setup transaction (the code buffer made, written and finalized), no cook,
      // and then the buffer's close.
      const landed = shim.sent.slice(sent);
      expect(cooksOf(sent)).toEqual([]);
      expect(landed).toHaveLength(setup.length + 1);
      // Closed again by the run itself, its rent back: nothing of the failed cook is left open.
      const closed = /The code buffer (\w+) was closed again/.exec(ran.stderr);
      expect(closed).not.toBeNull();
      expect(account(closed![1] as Address).exists).toBe(false);
      expect(account(pot)).toMatchObject({ programAddress: OLD });
    }, 180_000);

    it("sends a transaction someone else built that names that engine no further than its digest: not refused for the compiler's pairing", async () => {
      const owner = await keypair("old-send");
      const pot = await plantOld(owner.signer.address, "old-send");
      harness.svm.expireBlockhash();
      // The SDK's builder refuses an engine its compiler does not pair with, so the cook is built
      // for the installed engine and its engine account swapped, as another tool would write it:
      // the engine is the cook's second account.
      const cook = buildCookInstruction({
        kitchen: KITCHEN,
        owner: owner.signer.address,
        engineProgram: INSTALLED,
        potSalt: hexToBytes(potSalt("old-send")),
        pot,
        feeConfig: harness.feeConfig,
        bytecode: compileSauceProgram("solana", "function main(): Uint256 {\n  return 7;\n}\n")
          .bytecode,
        maxExecutionFee: 0n,
        tail: [],
      });
      const wire = getBase64EncodedWireTransaction(
        await buildExecuteTransaction({
          payer: owner.signer,
          instructions: [
            {
              ...cook,
              accounts: (cook.accounts ?? []).map((meta, at) =>
                at === 1 ? { ...meta, address: OLD } : meta,
              ),
            },
          ],
          latestBlockhash: {
            blockhash: harness.svm.latestBlockhash(),
            lastValidBlockHeight: 1_000_000n,
          },
        }),
      );
      const sent = shim.sent.length;
      const run = await sauce("send", wire, "--rpc-url", RPC_URL);
      // The bank holds no program at that engine's id, so what is refused is the cluster, by that
      // release's digest, as for any engine: not this SDK's compiler, which did not build the cook.
      expect(run.code).toBe(1);
      expect(run.stderr).toContain(
        `the engine ${OLD} (v12-svm 1.3.0) is not deployed on solana as that release's build`,
      );
      expect(run.stderr).not.toContain("which runs compiler");
      expect(shim.sent.length).toBe(sent);
    }, 180_000);

    describe("a cook that is not sent says what the Pot is whichever step stops it", () => {
      it("says it when the endpoint fails the read that builds the run's first step", async () => {
        const owner = await keypair("old-first");
        const pot = await plantOld(owner.signer.address, "old-first");
        const sent = shim.sent.length;

        const ran = await through(
          (request) =>
            request.method === "getLatestBlockhash" ? failing(request, "first-step") : undefined,
          () => sauce("run", seven, ...signedAs(owner.path, "old-first"), "--yes"),
        );
        expect(ran.code).toBe(1);
        expect(ran.stderr).toContain("reading the latest blockhash failed");
        expect(ran.stderr).toContain(cookTold(pot));
        expect(shim.sent.length).toBe(sent);
      }, 180_000);

      it("says it when the endpoint fails the blockhash read made just before the cook is sent", async () => {
        const owner = await keypair("old-before-send");
        const pot = await plantOld(owner.signer.address, "old-before-send");
        const sent = shim.sent.length;
        const seen: string[] = [];

        const ran = await through(
          (request) => {
            seen.push(request.method);
            // The plan's cook step reads one to simulate the cook on; the run reads the second.
            return request.method === "getLatestBlockhash" &&
              seen.filter((method) => method === "getLatestBlockhash").length === 2
              ? failing(request, "before-send")
              : undefined;
          },
          () => sauce("run", seven, ...signedAs(owner.path, "old-before-send"), "--yes"),
        );
        // The failing read is the one after the cook's simulation: the plan's step was built.
        expect(seen.indexOf("simulateTransaction")).toBeGreaterThan(-1);
        expect(seen.lastIndexOf("getLatestBlockhash")).toBeGreaterThan(
          seen.indexOf("simulateTransaction"),
        );
        expect(ran.code).toBe(1);
        expect(ran.stderr).toContain("reading the latest blockhash failed");
        expect(ran.stderr).toContain(cookTold(pot));
        expect(shim.sent.length).toBe(sent);
      }, 180_000);

      // A plan whose cook fails its simulation hands out no cook, so a cursor resumed later builds it
      // again from the cluster: the step these two cases make fail.
      const planFailing = async (owner: KeyPairSigner, salt: string, extra: string[] = []) => {
        const planned = await sauce(
          ...["tx", ownerCheck, ...named(owner.address, salt), "--account", "pot=pot", ...extra],
        );
        expect(planned.code).toBe(1);
        expect(planned.stderr).toContain("the engine does not own the Pot");

        return (JSON.parse(planned.stdout) as Planned).cursor;
      };

      it("says it when a plan resumed from its cursor cannot build its cook", async () => {
        const owner = await keypair("old-cursor");
        const pot = await plantOld(owner.signer.address, "old-cursor");
        const cursor = await planFailing(owner.signer, "old-cursor");
        const sent = shim.sent.length;

        const resumed = await through(
          (request) =>
            request.method === "getLatestBlockhash" ? failing(request, "cursor") : undefined,
          () => sauce("send", "--cursor", cursor, "--rpc-url", RPC_URL, "--json"),
        );
        expect(resumed.code).toBe(1);
        expect(resumed.stderr).toContain("reading the latest blockhash failed");
        expect(resumed.stderr).toContain(cookTold(pot));
        expect(shim.sent.length).toBe(sent);
      }, 180_000);

      it("says it when a plan resumed from its cursor is refused for the execution fee", async () => {
        const owner = await keypair("old-fee");
        const pot = await plantOld(owner.signer.address, "old-fee");
        // Made while the fee is free, so under the cap; the Kitchen's fee rises before it is resumed.
        const cursor = await planFailing(owner.signer, "old-fee", ["--max-execution-fee", "100"]);
        const sent = shim.sent.length;
        await setFee(5_000n);
        try {
          const resumed = await sauce("send", "--cursor", cursor, "--rpc-url", RPC_URL);
          expect(resumed.code).toBe(1);
          expect(resumed.stderr).toContain(
            "the execution fee is 5000 lamports, above --max-execution-fee 100: nothing was built",
          );
          expect(resumed.stderr).toContain(cookTold(pot));
          expect(shim.sent.length).toBe(sent);
        } finally {
          await setFee(0n);
        }
      }, 180_000);

      it("says it when `sauce tx`, `sauce simulate` or `sauce run` is refused for the execution fee before it builds anything", async () => {
        // The command's own refusal, made while it prepares the cook (nothing is signed or sent): the
        // Pot was read first, so what its state means for a cook is told beside it.
        const owner = await keypair("old-fee-first");
        const pot = await plantOld(owner.signer.address, "old-fee-first");
        const sent = shim.sent.length;
        await setFee(5_000n);
        try {
          for (const ran of [
            await sauce(
              ...["tx", seven, ...named(owner.signer.address, "old-fee-first")],
              ...["--max-execution-fee", "100"],
            ),
            await sauce(
              ...["simulate", seven, ...named(owner.signer.address, "old-fee-first")],
              ...["--max-execution-fee", "100"],
            ),
            await sauce(
              ...["run", seven, ...signedAs(owner.path, "old-fee-first")],
              ...["--max-execution-fee", "100", "--yes"],
            ),
          ]) {
            expect(ran.code).toBe(1);
            expect(ran.stderr).toContain(
              "the execution fee is 5000 lamports, above --max-execution-fee 100: nothing was signed or sent",
            );
            expect(ran.stderr).toContain(cookTold(pot));
          }
          expect(shim.sent.length).toBe(sent);
        } finally {
          await setFee(0n);
        }
      }, 180_000);

      it("says it when the run is refused for an approval it has no one to ask for, before it sends anything", async () => {
        // The recipient's token account is not there, so the plan's setup creates it, which asks the
        // owner: with no terminal and no --yes, the run stops before it sends a thing.
        const owner = await keypair("old-approval");
        const pot = await plantOld(owner.signer.address, "old-approval");
        const usdc = address(
          svmTokenRows(requireChain("solana")).find((row) => row.symbol === "USDC")!.mint,
        );
        setMint(harness, usdc, 6);
        setTokenAccount(harness, await ataOf(pot, usdc), usdc, pot, 3_000_000n);
        const to = randomAddress();
        const sent = shim.sent.length;

        const ran = await sauce(
          ...["run", PAY, ...signedAs(owner.path, "old-approval")],
          ...["--args", to, "1000000"],
        );
        expect(ran.code).toBe(1);
        expect(ran.stderr).toContain("nothing was sent: this run needs an approval");
        expect(ran.stderr).toContain(cookTold(pot));
        expect(shim.sent.length).toBe(sent);
      }, 180_000);
    });

    it("is created, on its own engine, and `sauce pot` says it is cooked on the installed one", async () => {
      const owner = await keypair("old-status");
      const pot = await plantOld(owner.signer.address, "old-status");
      const status = await sauce("pot", ...named(owner.signer.address, "old-status"));
      expect(read<PotStatus>(status).deployment.pot).toEqual({
        address: pot,
        deployed: true,
        engine: OLD,
      });
      expect(status.stderr).toContain(`${told(pot)}.`);
      expect(status.stderr).not.toContain("cooks on it run there");
    });
  });

  describe("an address a program this SDK does not know as an engine owns", () => {
    it("refuses a cook there, naming the owner as one it does not know, and sends nothing", async () => {
      // A later release's engine would look like this to an SDK older than it: the refusal is of the
      // owner, never a claim that the account is no Pot.
      const owner = await keypair("unknown-owner");
      const pot = await potOf(owner.signer.address, "unknown-owner");
      const unknown = randomAddress();
      harness.svm.setAccount({
        address: pot,
        data: new Uint8Array(165),
        executable: false,
        lamports: lamports(1_000_000_000n),
        programAddress: unknown,
        space: 165n,
      });
      const sent = shim.sent.length;
      const refusal =
        `the account at ${pot}, the Pot's address, is owned by ${unknown}, which is not an ` +
        "engine this SDK knows";
      const named = (extra: string[]) => [seven, ...extra];
      for (const ran of [
        await sauce(
          "simulate",
          ...named(["--chain", "solana", "--owner", owner.signer.address]),
          "--salt",
          "unknown-owner",
          "--rpc-url",
          RPC_URL,
        ),
        await sauce(
          "tx",
          ...named(["--chain", "solana", "--owner", owner.signer.address]),
          "--salt",
          "unknown-owner",
          "--rpc-url",
          RPC_URL,
        ),
        await sauce("run", seven, ...signedAs(owner.path, "unknown-owner"), "--yes"),
      ]) {
        expect(ran.code).toBe(1);
        expect(ran.stderr).toContain(refusal);
        expect(ran.stderr).not.toContain("it is no Pot");
      }
      expect(shim.sent.length).toBe(sent);
    }, 180_000);

    it("says whose account it is in `sauce pot` and `sauce pot --deploy`, and sends nothing", async () => {
      const owner = await keypair("unknown-status");
      const pot = await potOf(owner.signer.address, "unknown-status");
      const unknown = randomAddress();
      harness.svm.setAccount({
        address: pot,
        data: new Uint8Array(165),
        executable: false,
        lamports: lamports(1_000_000_000n),
        programAddress: unknown,
        space: 165n,
      });
      const sent = shim.sent.length;
      const note =
        `The Pot's account is owned by ${unknown}, which is not an engine this SDK knows. This SDK ` +
        "cooks nothing on it; where a later release's engine owns it, a newer SDK does.";

      const status = await sauce("pot", ...named(owner.signer.address, "unknown-status"));
      expect(status.code).toBe(0);
      expect(status.stderr).toContain(note);
      expect(read<PotStatus>(status).deployment.pot).toEqual({
        address: pot,
        deployed: true,
        ownerProgram: unknown,
      });

      const deployed = await sauce("pot", "--deploy", ...signedAs(owner.path, "unknown-status"));
      expect(deployed.code).toBe(0);
      expect(deployed.stderr).toContain(note);
      expect(read<{ deployed: boolean; ownerProgram?: string }>(deployed)).toMatchObject({
        deployed: true,
        ownerProgram: unknown,
      });
      expect(shim.sent.length).toBe(sent);
    }, 180_000);
  });
});

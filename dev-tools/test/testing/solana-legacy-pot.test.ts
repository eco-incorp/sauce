/**
 * A Pot an earlier release's engine created cooks on that engine in the kit, and a Pot the kit
 * creates cooks on the installed one. The bank serves the earlier engine (v12-svm 1.4.0) from a
 * source standing for a cluster that runs it, and holds what the source serves to that release's
 * committed digest; the cook names the program that owns the Pot, never `chain.engine` in its place.
 * A source serving another build than the release's, or a Pot of an engine whose code the chain does
 * not hold, is refused rather than run on other code.
 *
 * Runs wherever LiteSVM and the synced engine artifacts, the earlier engine's included, are; skips
 * without them locally, and fails under CI, where it must run.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  address,
  createKeyPairSignerFromBytes,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";

import {
  Bank,
  type AccountSource,
  type ClusterHeader,
  type ReadAccount,
} from "../../src/testing/solana-bank.js";
import { sendStep } from "../../src/testing/solana-cook.js";
import { SolanaTestChain } from "../../src/testing/solana.js";
import {
  buildCreatePotInstruction,
  deriveExecutionFeeConfigPda,
  MAX_POT_LEN,
  requireChain,
  svmEnginePath,
  v12SvmEngineProgramId,
  v12SvmKitchenProgramId,
} from "../../src/testing/sdk.js";
import { solanaMissing } from "./solana-support.js";

const HERE = dirname(fileURLToPath(import.meta.url));
/** v12-svm 1.4.0's mainnet build, as `sync-engine-artifacts` takes it from its release's package. */
const EARLIER_ELF = resolve(HERE, "../../../sdk/src/artifacts/legacy/2.6.2/svm/engine-mainnet.so");
const EARLIER = address("53eS7GGeU9QPaGCUmHgDSToPf61sLwGZqBGLG9JT2nSW");
const INSTALLED = address(v12SvmEngineProgramId());
const KITCHEN = address(v12SvmKitchenProgramId());
const UPGRADEABLE_LOADER = address("BPFLoaderUpgradeab1e11111111111111111111111");
const SOLANA = requireChain("solana");

/** Why the earlier engine's artifacts are missing, or false; under CI, a throw. */
function legacyMissing(): string | false {
  if (existsSync(EARLIER_ELF)) return false;
  const why =
    "the earlier Solana engine's artifacts are not synced (sdk/src/artifacts/legacy, which " +
    "sync-engine-artifacts writes)";
  if (process.env.CI) throw new Error(`${why}, and CI must run the kit's earlier-engine suite`);

  return why;
}

/** An account as a source serves it. */
type Served = ReadAccount;

/** A source that serves what `held` holds, and nothing else. */
const sourceOf = (held: Map<Address, Served>): AccountSource => ({
  read: async (keys) => keys.map((key) => held.get(key) ?? null),
});

/** A program as a cluster serves it: executable, its code the program data past its header, with
 *  the zero padding of an account sized past it. */
const programServed = (elf: Uint8Array): Served => {
  const code = new Uint8Array(elf.length + 64);
  code.set(elf);

  return {
    lamports: 1_000_000_000n,
    owner: UPGRADEABLE_LOADER,
    data: new Uint8Array(),
    executable: true,
    code,
  };
};

const TIMESTAMP = 1_700_000_000n;
/** The fixed clock `local()` starts a chain from. */
const HEADER: ClusterHeader = {
  clock: {
    slot: 0n,
    epochStartTimestamp: TIMESTAMP,
    epoch: 0n,
    leaderScheduleEpoch: 0n,
    unixTimestamp: TIMESTAMP,
  },
};

/** A program of `steps` arithmetic steps on `a`: past one transaction's 1,232 bytes. */
function large(steps: number): { source: string; expected: (a: bigint) => bigint } {
  let body = "  let x = a;\n";
  for (let i = 0; i < steps; i++) body += `  x = (x * ${i + 3} + ${i + 1}) % 1000003;\n`;

  return {
    source: `function main(a: Uint256): Uint256 {\n${body}  return x;\n}\n`,
    expected: (a) => {
      let x = a;
      for (let i = 0; i < steps; i++) x = (x * BigInt(i + 3) + BigInt(i + 1)) % 1000003n;
      return x;
    },
  };
}

const SEVEN = "function main(): Uint256 { return 7; }";
const invokes = (logs: readonly string[], engine: Address): boolean =>
  logs.some((line) => line.startsWith(`Program ${engine} invoke`));

describe(
  "a Pot an earlier release's engine created",
  { skip: solanaMissing() || legacyMissing() },
  () => {
    const served = new Map<Address, Served>();
    let bank: Bank;
    let chain: SolanaTestChain;
    let signer: KeyPairSigner;

    /** A new bank over `held`, on the fixed clock, with its chain started. */
    const open = async (held: Map<Address, Served>) => {
      const opened = await Bank.open({
        mode: "live",
        source: sourceOf(held),
        header: HEADER,
        engine: INSTALLED,
        kitchen: KITCHEN,
      });
      opened.moveClock(1_000n, TIMESTAMP);

      return {
        bank: opened,
        chain: await SolanaTestChain.start(SOLANA, opened, { zeroFee: true }),
      };
    };

    /** Creates test account `index`'s Pot under the earlier engine, as a cluster that ran it did. */
    const createUnderEarlier = async (on: { bank: Bank }, test: SolanaTestChain, index: number) => {
      const account = test.account(index);
      const owner = await createKeyPairSignerFromBytes(account.secretKey);
      const { address: feeConfig } = await deriveExecutionFeeConfigPda(KITCHEN);
      await sendStep(
        { bank: on.bank, chain: SOLANA, engine: EARLIER, kitchen: KITCHEN, feeConfig },
        owner,
        [
          buildCreatePotInstruction({
            kitchen: KITCHEN,
            owner: account.address,
            engineProgram: EARLIER,
            pot: account.pot,
            salt: new Uint8Array(32),
            space: MAX_POT_LEN,
          }),
        ],
        `creating account ${index}'s Pot under the earlier engine`,
      );

      return owner;
    };

    before(async () => {
      served.set(EARLIER, programServed(new Uint8Array(readFileSync(EARLIER_ELF))));
      ({ bank, chain } = await open(served));
      signer = await createUnderEarlier({ bank }, chain, 1);
    });

    it("cooks on 1.4.0's code, and a Pot the kit created on 1.4.1's", async () => {
      assert.equal(bank.account(chain.account(1).pot)?.owner, EARLIER);
      const earlier = await chain.run({ source: SEVEN }, { from: 1 });
      assert.equal(earlier.returned, 7n);
      assert.equal(earlier.engine, EARLIER);
      assert.ok(invokes(earlier.logs, EARLIER), "the earlier engine ran");
      assert.ok(!invokes(earlier.logs, INSTALLED), "the installed engine did not");
      // Account 0's Pot, created by `start` under the installed release's engine.
      assert.equal(bank.account(chain.account(0).pot)?.owner, INSTALLED);
      const created = await chain.run({ source: SEVEN }, { from: 0 });
      assert.equal(created.returned, 7n);
      assert.equal(created.engine, INSTALLED);
      assert.ok(invokes(created.logs, INSTALLED));
      assert.ok(!invokes(created.logs, EARLIER));
      assert.ok(signer.address === chain.account(1).address);
    });

    it("stages a program past one transaction and cooks it from its code buffer on the same engine", async () => {
      const { source, expected } = large(300);
      const staged = await chain.run({ source }, { from: 1, args: [7n] });
      assert.equal(staged.staged, true);
      assert.equal(staged.returned, expected(7n));
      assert.equal(staged.engine, EARLIER);
      assert.ok(invokes(staged.logs, EARLIER));
      assert.ok(!invokes(staged.logs, INSTALLED));
    });

    it("refuses a source whose earlier engine is another build than its release's", async () => {
      // The installed engine's ELF at the earlier engine's id: not the 1.4.0 release's build.
      const other = new Map<Address, Served>([
        [EARLIER, programServed(new Uint8Array(readFileSync(svmEnginePath("mainnet"))))],
      ]);
      const { bank: wrong, chain: on } = await open(other);
      await assert.rejects(
        createUnderEarlier({ bank: wrong }, on, 1),
        /the source holds 53eS7GGeU9QPaGCUmHgDSToPf61sLwGZqBGLG9JT2nSW, engine v12-svm 1\.4\.0, as another build/,
      );
    });

    it("refuses a Pot whose engine's code the chain does not hold, never running it on another engine", async () => {
      // A Pot owned by the earlier engine, and no program at that id.
      const bare = new Map<Address, Served>();
      const { chain: on } = await open(bare);
      bare.set(on.account(2).pot, {
        lamports: 1_000_000_000n,
        owner: EARLIER,
        data: new Uint8Array(MAX_POT_LEN),
        executable: false,
      });
      await assert.rejects(
        on.run({ source: SEVEN }, { from: 2 }),
        /is owned by engine 53eS7GGeU9QPaGCUmHgDSToPf61sLwGZqBGLG9JT2nSW \(v12-svm 1\.4\.0\), whose code this chain does not hold/,
      );
    });

    it("refuses a cluster whose Kitchen is another program than the package's, and an account no engine owns as a Pot", async () => {
      // Another program's bytes at the Kitchen's id: the engine's ELF is not kitchen.so.
      const other = new Map<Address, Served>([
        [KITCHEN, programServed(new Uint8Array(readFileSync(svmEnginePath("mainnet"))))],
      ]);
      await assert.rejects(
        open(other),
        /the cluster runs another build at .* than this package's kitchen-svm/,
      );
      // A Pot's address held by a program no release names.
      const system = new Map<Address, Served>();
      const { chain: on } = await open(system);
      system.set(on.account(3).pot, {
        lamports: 1_000_000_000n,
        owner: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        data: new Uint8Array(165),
        executable: false,
      });
      await assert.rejects(
        on.run({ source: SEVEN }, { from: 3 }),
        /a Pot's address, is owned by TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA, not by an engine/,
      );
    });
  },
);

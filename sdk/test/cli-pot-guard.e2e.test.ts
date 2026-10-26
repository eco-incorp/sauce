/**
 * The Pot a command cooks on, deploys or signs for is checked against the deployed Kitchen before
 * anything is simulated, built or sent. An SDK that predicts a Pot address the live Kitchen does
 * not — as 0.99.15 did after the Kitchen's upgrade to v12 1.3.0 — would send its cook to an
 * address with no code, where it "succeeds", runs nothing and keeps the cook's value.
 *
 * On a local anvil with the released gated stack (`cli-anvil.ts`): the Kitchen proxy is pointed at
 * `MispredictingKitchen` (`evm/fixtures/`), the released implementation in every respect but its
 * `predictPot`, and `simulate`, `tx`, `run`, `sign` and `pot` (with and without `--deploy`) are
 * refused naming both addresses, for a Pot not deployed yet and for one that is; code at the Pot's
 * address that is no Pot of this release is refused; `sendAndWait`, which every send passes, refuses
 * both too; the normal path is what it was; and offline, where nothing can be checked, says so.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite (CLAUDE.md), and a hard
 * failure without it in CI. The offline half needs no chain.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  pad,
  parseEther,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { requireReleasePot, sendAndWait } from "../src/cli/chain.js";
import type { CliIo } from "../src/cli/run.js";
import { v12KitchenAddress, v12KitchenImplementationAddress } from "../src/deployments/index.js";
import { potSalt, v12PredictPot } from "../src/deployments/pot.js";
import { v12KitchenAbi, v12PotAbi } from "../src/evm/engine.js";
import mispredicting from "./evm/fixtures/MispredictingKitchen.json" with { type: "json" };
import { describeEvm, sauce, sauceWith, startChain, type LocalChain } from "./cli-anvil.js";

/** A program that needs no token: what is under test is the Pot it runs on. */
const PROGRAM = "function main(x: Uint256): Uint256 {\n  return x + 1;\n}\n";

/** No terminal, and nothing to answer: what a pipe, CI or an agent's shell gives the command. */
const NO_TERMINAL: Partial<CliIo> = { canAsk: () => false, confirm: async () => undefined };

/** EIP-1967's implementation slot, which the Kitchen's UUPS proxy delegates through. */
const IMPLEMENTATION_SLOT: Hex =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

/** Where the mispredicting Kitchen says every Pot is: an address with no code. */
const ELSEWHERE = getAddress("0x00000000000000000000000000000000005e1f00");

/** What every refusal of a mismatched Kitchen says. */
const MISMATCH = /this SDK does not match the deployed Kitchen/;
const UPGRADE = /Upgrade @eco-incorp\/sauce/;

/**
 * Runtime code that answers each of `answers` — a function's signature and the word it returns —
 * and returns successfully, with nothing, to anything else: a contract at the Pot's address that
 * reads as the Pot would, and that a cook "succeeds" on without running anything.
 */
function posingAsPot(answers: ReadonlyArray<readonly [string, Hex]>): Hex {
  const word = (value: number, bytes: number) => value.toString(16).padStart(bytes * 2, "0");
  // PUSH1 0 CALLDATALOAD PUSH1 0xe0 SHR; per answer DUP1 PUSH4 <selector> EQ PUSH2 <body> JUMPI;
  // STOP; per answer JUMPDEST PUSH32 <word> PUSH1 0 MSTORE PUSH1 32 PUSH1 0 RETURN.
  const head = 6 + answers.length * 11 + 1;
  const dispatch = answers
    .map(
      ([signature], index) =>
        `8063${toFunctionSelector(signature).slice(2)}1461${word(head + index * 42, 2)}57`,
    )
    .join("");
  const bodies = answers.map(([, value]) => `5b7f${pad(value).slice(2)}60005260206000f3`).join("");

  return `0x60003560e01c${dispatch}00${bodies}`.toLowerCase() as Hex;
}

describeEvm("the Pot is checked against the deployed Kitchen", () => {
  let local: LocalChain;
  let work: string;
  let program: string;
  let mispredictingKitchen: Address;
  const kitchen = getAddress(v12KitchenAddress());
  const implementation = getAddress(v12KitchenImplementationAddress());

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-pot-guard-e2e-"));
    program = join(work, "next.sauce.ts");
    writeFileSync(program, PROGRAM);
    local = await startChain("ethereum");
    mispredictingKitchen = await local.plant(
      encodeDeployData({
        abi: mispredicting.abi,
        bytecode: mispredicting.creationCode as Hex,
        args: [implementation, ELSEWHERE],
      }),
    );
  }, 120_000);
  afterAll(async () => {
    await local?.stop();
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  /** A test owner: its key and address, and the Pot its label names. */
  interface Owner {
    readonly key: Hex;
    readonly address: Address;
    readonly label: string;
    readonly salt: Hex;
    readonly pot: Address;
  }

  /** A fresh owner with ETH and no Pot. */
  async function owner(label: string): Promise<Owner> {
    const key = generatePrivateKey();
    const address = privateKeyToAccount(key).address;
    await local.testClient.setBalance({ address, value: parseEther("10") });
    const salt = potSalt(label);

    return { key, address, label, salt, pot: getAddress(v12PredictPot(address, salt) as Address) };
  }

  /** Runs `body` with the Kitchen proxy delegating to the mispredicting implementation. */
  async function whileMispredicting(body: () => Promise<void>): Promise<void> {
    await local.testClient.setStorageAt({
      address: kitchen,
      index: IMPLEMENTATION_SLOT,
      value: pad(mispredictingKitchen),
    });
    try {
      const live = await local.publicClient.readContract({
        address: kitchen,
        abi: v12KitchenAbi,
        functionName: "predictPot",
        args: [ELSEWHERE, potSalt("any")],
      });
      expect(getAddress(live)).toBe(ELSEWHERE);
      await body();
    } finally {
      await local.testClient.setStorageAt({
        address: kitchen,
        index: IMPLEMENTATION_SLOT,
        value: pad(implementation),
      });
    }
  }

  /** `command` on `who`'s Pot, signing where the command signs. */
  const command = (command: string, who: Owner, ...more: string[]) =>
    sauceWith(
      NO_TERMINAL,
      ...(command === "pot"
        ? ["pot", "--chain", "ethereum", "--rpc-url", local.rpcUrl, "--owner", who.address]
        : command === "pot --deploy"
          ? ["pot", "--deploy", "--chain", "ethereum", "--rpc-url", local.rpcUrl]
          : [command, program, "--chain", "ethereum", "--rpc-url", local.rpcUrl]),
      ...(command === "run" || command === "sign" || command === "pot --deploy"
        ? ["--private-key", who.key]
        : command === "pot"
          ? []
          : ["--owner", who.address]),
      ...(command === "run" ? ["--yes"] : []),
      "--salt",
      who.label,
      ...(command.startsWith("pot") ? [] : ["--args", "41"]),
      ...more,
    );

  /** Nothing was sent from `who`, it holds what it held, and nothing was deployed where it says. */
  async function nothingSent(who: Owner, balance: bigint, potCode: Hex | undefined) {
    expect(await local.publicClient.getTransactionCount({ address: who.address })).toBe(0);
    expect(await local.publicClient.getBalance({ address: who.address })).toBe(balance);
    expect(await local.publicClient.getCode({ address: who.pot })).toBe(potCode);
    expect(await local.publicClient.getCode({ address: ELSEWHERE })).toBeUndefined();
  }

  it("leaves the normal path as it was", async () => {
    const fresh = await owner("normal");
    for (const each of ["pot", "tx", "simulate", "sign"]) {
      const result = await command(each, fresh, ...(each === "simulate" ? ["--json"] : []));
      if (result.code !== 0) {
        throw new Error(`${each} exited ${result.code}: ${result.stderr}${result.stdout}`);
      }
      if (each === "simulate") {
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, returned: "42" });
      }
    }
    const ran = await command("run", fresh, "--json");
    expect(ran.code).toBe(0);
    expect(JSON.parse(ran.stdout)).toMatchObject({
      pot: fresh.pot,
      deployPot: { status: "success" },
      cook: { status: "success" },
    });
    // On the Pot it deployed, every command again, with the Pot named by owner and by address.
    for (const each of ["tx", "simulate", "sign", "run"]) {
      const result = await command(each, fresh, ...(each === "tx" ? [] : ["--json"]));
      if (result.code !== 0) {
        throw new Error(`${each} exited ${result.code}: ${result.stderr}${result.stdout}`);
      }
    }
    const byAddress = await sauceWith(
      NO_TERMINAL,
      ...["tx", program, "--chain", "ethereum", "--rpc-url", local.rpcUrl],
      ...["--pot", fresh.pot, "--args", "41"],
    );
    expect(byAddress.code).toBe(0);
  }, 180_000);

  it.each(["simulate", "tx", "run", "sign", "pot", "pot --deploy"])(
    "refuses %s for a Pot not deployed yet when the Kitchen predicts another address",
    async (each) => {
      const fresh = await owner(`undeployed-${each}`);
      const balance = await local.publicClient.getBalance({ address: fresh.address });
      await whileMispredicting(async () => {
        const refused = await command(each, fresh);
        const said = refused.stdout + refused.stderr;
        expect(refused.code).toBe(1);
        expect(said).toMatch(MISMATCH);
        expect(said).toMatch(UPGRADE);
        expect(said).toContain(fresh.pot);
        expect(said).toContain(ELSEWHERE);
        await nothingSent(fresh, balance, undefined);
      });
    },
    120_000,
  );

  it.each(["simulate", "tx", "run", "sign"])(
    "refuses %s on a deployed Pot when the Kitchen predicts another address",
    async (each) => {
      const fresh = await owner(`deployed-${each}`);
      await local.send(
        local.deployer,
        kitchen,
        encodeFunctionData({
          abi: v12KitchenAbi,
          functionName: "deployPot",
          args: [fresh.address, fresh.salt],
        }),
      );
      const code = await local.publicClient.getCode({ address: fresh.pot });
      expect(code).toBeDefined();
      const balance = await local.publicClient.getBalance({ address: fresh.address });
      await whileMispredicting(async () => {
        const refused = await command(each, fresh);
        const said = refused.stdout + refused.stderr;
        expect(refused.code).toBe(1);
        expect(said).toMatch(MISMATCH);
        expect(said).toContain(fresh.pot);
        expect(said).toContain(ELSEWHERE);
        await nothingSent(fresh, balance, code);
        // Named by its address, the Pot's owner and salt are read off it, and refused the same.
        if (each === "tx" || each === "simulate") {
          const byAddress = await sauceWith(
            NO_TERMINAL,
            ...[each, program, "--chain", "ethereum", "--rpc-url", local.rpcUrl],
            ...["--pot", fresh.pot, "--args", "41"],
          );
          expect(byAddress.code).toBe(1);
          expect(byAddress.stdout + byAddress.stderr).toMatch(MISMATCH);
        }
      });
    },
    120_000,
  );

  /** Reads the three getters a Pot answers its owner, salt and Kitchen with. */
  const getters = (pot: Address) =>
    Promise.all(
      (["owner", "userSalt", "kitchen"] as const).map((functionName) =>
        local.publicClient.readContract({ address: pot, abi: v12PotAbi, functionName }),
      ),
    );

  /** Code at `who`'s Pot address that answers every getter as the real Pot would. */
  const impostors: Record<string, (who: Owner) => Promise<Hex>> = {
    // A contract of its own, answering the three getters and taking any cook without running.
    "a contract posing as the Pot": async (who) => {
      const code = posingAsPot([
        ["function owner()", pad(who.address)],
        ["function userSalt()", who.salt],
        ["function kitchen()", pad(kitchen)],
      ]);
      await local.testClient.setCode({ address: who.pot, bytecode: code });

      return code;
    },
    // The real Pot, with one of the copies of its owner the constructor wrote changed: the
    // getters still answer as the Pot does, and no constructor writes copies that disagree.
    "the release's Pot with one immutable copy changed": async (who) => {
      await local.send(
        local.deployer,
        kitchen,
        encodeFunctionData({
          abi: v12KitchenAbi,
          functionName: "deployPot",
          args: [who.address, who.salt],
        }),
      );
      const real = (await local.publicClient.getCode({ address: who.pot }))!.toLowerCase();
      const copy = who.address.slice(2).toLowerCase();
      const other = ELSEWHERE.slice(2).toLowerCase();
      for (let at = real.indexOf(copy); at !== -1; at = real.indexOf(copy, at + 1)) {
        const changed = `${real.slice(0, at)}${other}${real.slice(at + copy.length)}` as Hex;
        await local.testClient.setCode({ address: who.pot, bytecode: changed });
        const [answered] = await getters(who.pot);
        if (getAddress(answered) === who.address) return changed;
      }
      throw new Error("every copy of the owner is the one owner() reads");
    },
  };

  describe.each(Object.keys(impostors))("%s", (impostor) => {
    it.each(["simulate", "tx", "run", "sign"])(
      "refuses %s",
      async (each) => {
        const fresh = await owner(`${impostor}-${each}`);
        const code = await impostors[impostor]!(fresh);
        // Only its code tells it from the Pot: it answers every getter as the Pot would.
        expect(await getters(fresh.pot)).toEqual([fresh.address, fresh.salt, kitchen]);
        const balance = await local.publicClient.getBalance({ address: fresh.address });
        const refused = await command(each, fresh);
        const said = refused.stdout + refused.stderr;
        expect(refused.code).toBe(1);
        expect(said).toContain(`${fresh.pot} on ethereum has code, but not the code of a Pot`);
        expect(said).toMatch(UPGRADE);
        await nothingSent(fresh, balance, code);
      },
      120_000,
    );
  });

  it("refuses at the send itself: a deployment the Kitchen puts elsewhere, a cook on no Pot", async () => {
    const fresh = await owner("at-the-send");
    const account = privateKeyToAccount(fresh.key);
    const balance = await local.publicClient.getBalance({ address: fresh.address });
    const deploy = {
      to: kitchen,
      data: encodeFunctionData({
        abi: v12KitchenAbi,
        functionName: "deployPot",
        args: [fresh.address, fresh.salt],
      }),
      value: 0n,
    };
    // Signed elsewhere and handed to `sauce send`: refused the same, before it is broadcast.
    const signed = (tx: { to: Address; data: Hex; value: bigint }, nonce: number) =>
      account.signTransaction({
        ...tx,
        chainId: local.chain.id,
        nonce,
        gas: 1_000_000n,
        maxFeePerGas: 100_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
      });
    const send = (raw: Hex) =>
      sauceWith(NO_TERMINAL, "send", raw, "--chain", "ethereum", "--rpc-url", local.rpcUrl);
    await whileMispredicting(async () => {
      await expect(sendAndWait(local.publicClient, local.rpcUrl, account, deploy)).rejects.toThrow(
        MISMATCH,
      );
      const sent = await send(await signed(deploy, 0));
      expect(sent.code).toBe(1);
      expect(sent.stdout + sent.stderr).toMatch(MISMATCH);
    });
    const cook = {
      to: fresh.pot,
      data: encodeFunctionData({
        abi: v12PotAbi,
        functionName: "cook",
        args: [getAddress(ELSEWHERE), "0x00"],
      }),
      value: 1_234n,
    };
    const noPot = `the cook goes to ${fresh.pot}, which has no code on ethereum`;
    await expect(sendAndWait(local.publicClient, local.rpcUrl, account, cook)).rejects.toThrow(
      noPot,
    );
    const sent = await send(await signed(cook, 0));
    expect(sent.code).toBe(1);
    expect(sent.stdout + sent.stderr).toContain(noPot);
    await nothingSent(fresh, balance, undefined);
  }, 120_000);

  it("takes a Pot of every kind the release deploys, and refuses each while the Kitchen predicts another", async () => {
    const fresh = await owner("kinds");
    const salt = potSalt("kinds");
    const deploy = async (
      functionName: "deployPot" | "deploySharedPot",
      args: readonly unknown[],
    ) => {
      await local.send(
        local.deployer,
        kitchen,
        encodeFunctionData({ abi: v12KitchenAbi, functionName, args: args as never }),
      );
    };
    await deploy("deployPot", [fresh.address, salt]);
    await deploy("deployPot", [fresh.address, salt, true]);
    await deploy("deploySharedPot", [salt]);
    const pots = await Promise.all([
      local.publicClient.readContract({
        address: kitchen,
        abi: v12KitchenAbi,
        functionName: "predictPot",
        args: [fresh.address, salt, true],
      }),
      local.publicClient.readContract({
        address: kitchen,
        abi: v12KitchenAbi,
        functionName: "predictSharedPot",
        args: [salt],
      }),
    ]);
    for (const pot of [fresh.pot, ...pots]) {
      await expect(
        requireReleasePot(local.publicClient, local.chain, pot),
      ).resolves.toBeUndefined();
    }
    await whileMispredicting(async () => {
      for (const pot of [fresh.pot, ...pots]) {
        await expect(requireReleasePot(local.publicClient, local.chain, pot)).rejects.toThrow(
          MISMATCH,
        );
      }
    });
  }, 120_000);
});

describe("offline, the Pot's address cannot be checked", () => {
  const OWNER = getAddress("0x5a0Ce0000000000000000000000000000000Beef");
  let work: string;
  let program: string;
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "sauce-pot-guard-offline-"));
    program = join(work, "next.sauce.ts");
    writeFileSync(program, PROGRAM);
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it.each([
    ["tx", ["--value", "1234"]],
    ["sign", ["--max-fee", "1234"]],
  ])("%s says so", async (each, more) => {
    const result = await sauce(
      ...[each, program, "--chain", "ethereum", "--offline", "--owner", OWNER],
      ...more,
      ...["--args", "41"],
    );
    if (result.code !== 0) throw new Error(`exited ${result.code}: ${result.stderr}`);
    expect(result.stdout + result.stderr).toContain(
      "The Pot's address is NOT checked against the deployed Kitchen",
    );
  });

  it("pot says so", async () => {
    const result = await sauce("pot", "--chain", "ethereum", "--offline", "--owner", OWNER);
    if (result.code !== 0) throw new Error(`exited ${result.code}: ${result.stderr}`);
    expect(result.stdout + result.stderr).toContain(
      "The Pot's address is NOT checked against the deployed Kitchen",
    );
  });
});

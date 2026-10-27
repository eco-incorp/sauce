/**
 * `sauce sign` (`cli/sign.ts`), offline: the typed data it prints is the SDK's
 * (`signedCookTypedDataJson`), the signature recovers the Pot's owner, `cook` is `cookSigned` with
 * exactly the signed fields and the program with its arguments, a signature made elsewhere is checked
 * before a cook is built, `--cancel` builds one `invalidateNonces` per nonce word, and what it refuses
 * — a signer that is not the owner, both deadlines, no fee ceiling offline, Solana, a preview chain
 * before any endpoint or key, and a wallet whose policy limits what a signed cook would move.
 * Submitting on a chain is `cli-sign.e2e.test.ts`. Every key and password here is thrown away.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bytesToHex,
  decodeFunctionData,
  getAddress,
  recoverTypedDataAddress,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { requireChain } from "../src/chains/canonical.js";
import { guardWallet, PolicyRefusal, readPolicy } from "../src/cli/policy.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { plannedTransactions } from "../src/cli/wallet-send.js";
import { WalletStore } from "../src/cli/wallets.js";
import { v12EngineAddress } from "../src/deployments/index.js";
import { v12PredictPot } from "../src/deployments/pot.js";
import {
  cookNonceWordBit,
  signedCookDigest,
  signedCookTypedData,
  signedCookTypedDataJson,
  v12PotAbi,
  type SignedCookExecution,
} from "../src/evm/engine.js";
import { encodeEntryArguments } from "../src/routes/entry.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";

const KEY = generatePrivateKey();
const OWNER = privateKeyToAccount(KEY);
const STRANGER = privateKeyToAccount(generatePrivateKey());
const RECIPIENT = getAddress("0x6666666666666666666666666666666666666666");
const RELAYER = getAddress("0x3333333333333333333333333333333333333333");
const BASE = requireChain("base");
const SOURCE = `function main(recipient: Address, amount: Uint256): void {
  USDC.transfer(recipient, amount);
}
`;
/** The program with its arguments appended, as the Pot runs it. */
const PROGRAM = (() => {
  const compiled = compileSauceProgram(BASE, SOURCE);

  return `${bytesToHex(compiled.bytecode)}${bytesToHex(
    encodeEntryArguments(compiled, [RECIPIENT, 1_000_000n]),
  ).slice(2)}` as Hex;
})();
const PASSWORD = `throwaway-${process.pid}-${Date.now()}`;

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

let work: string;
let file: string;

async function sauce(...argv: string[]): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    ...nodeIo(),
    walletsDir: join(work, "wallets"),
    readEnv: (name) => (name === "SAUCE_TEST_SIGN_PW" ? PASSWORD : undefined),
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
  };

  return { code: await runCli(argv, io), stdout, stderr };
}

interface Signed {
  chainId: number;
  pot: Address;
  owner?: Address;
  engine: Address;
  program: Hex;
  value: string;
  maxExecutionFee: string;
  nonce: string;
  deadline: string;
  submitter: Address;
  typedData: unknown;
  digest: Hex;
  signature?: Hex;
  cook?: { chainId: number; to: Address; data: Hex; value: Hex };
  deployPot?: unknown;
}

const signedOf = (run: Run): Signed => {
  if (run.code !== 0) throw new Error(`sauce exited ${run.code}: ${run.stderr}${run.stdout}`);

  return JSON.parse(run.stdout) as Signed;
};

const ARGS = ["--args", RECIPIENT, "1000000"];

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "sauce-sign-"));
  file = join(work, "pay.sauce.ts");
  writeFileSync(file, SOURCE);
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("sauce sign", () => {
  it("signs every field for the signer's Pot, and builds cookSigned with exactly them", async () => {
    const run = await sauce(
      ...["sign", file, "--chain", "base", "--private-key", KEY, "--offline", "--json"],
      ...["--max-fee", "1234", "--nonce", "7", "--deadline", "2000000000"],
      ...["--value", "5", "--submitter", RELAYER, ...ARGS],
    );
    const signed = signedOf(run);
    const pot = getAddress(v12PredictPot(OWNER.address));
    const execution: SignedCookExecution = {
      chainId: BASE.id,
      pot,
      engine: getAddress(v12EngineAddress()),
      program: PROGRAM,
      value: 5n,
      maxExecutionFee: 1234n,
      nonce: 7n,
      deadline: 2_000_000_000n,
      submitter: RELAYER,
    };
    expect(signed).toMatchObject({
      chainId: 8453,
      pot,
      owner: OWNER.address,
      engine: execution.engine,
      program: PROGRAM,
      value: "5",
      maxExecutionFee: "1234",
      nonce: "7",
      deadline: "2000000000",
      submitter: RELAYER,
    });
    // The SDK's typed data, as eth_signTypedData_v4 takes it, and its digest.
    expect(signed.typedData).toEqual(signedCookTypedDataJson(execution));
    expect(signed.digest).toBe(signedCookDigest(execution));
    expect(
      await recoverTypedDataAddress({
        ...signedCookTypedData(execution),
        signature: signed.signature!,
      }),
    ).toBe(OWNER.address);

    // The cook: cookSigned with exactly the signed fields, sent with exactly the signed value.
    expect(signed.cook).toMatchObject({ chainId: 8453, to: pot, value: "0x5" });
    const call = decodeFunctionData({ abi: v12PotAbi, data: signed.cook!.data });
    expect(call.functionName).toBe("cookSigned");
    expect(call.args).toEqual([
      execution.engine,
      PROGRAM,
      1234n,
      7n,
      2_000_000_000n,
      RELAYER,
      signed.signature,
    ]);
    expect(signed.deployPot).toBeUndefined();
    expect(run.stderr).toContain(`Only ${RELAYER} may submit this cook, once (nonce 7)`);
    expect(run.stderr).toContain("until 2000000000");
    expect(run.stderr).toContain(`with exactly 5 wei of value`);
    expect(run.stderr).toContain("sauce sign --cancel 7 --chain base");
    expect(run.stderr).toContain("nothing was read (no endpoint)");

    // sauce inspect takes the cook apart; with no transaction around it, it checks no signature.
    const inspected = await sauce("inspect", signed.cook!.data, "--json");
    expect(inspected.code).toBe(0);
    expect(JSON.parse(inspected.stdout)).toMatchObject({
      call: "Pot.cookSigned",
      engine: { address: execution.engine, released: true },
      maxExecutionFee: "1234",
      nonce: "7",
      deadline: "2000000000",
      submitter: RELAYER,
      signature: signed.signature,
      signedByOwner: null,
    });

    // sauce_wallet_send takes the result whole: the cook, as a signed cook on the Pot.
    expect(plannedTransactions(signed)).toEqual([
      {
        kind: "evm",
        chainId: 8453,
        to: pot,
        data: signed.cook!.data,
        value: 5n,
        what: `signed cook on Pot ${pot}`,
      },
    ]);
    expect(
      plannedTransactions({
        ...signed,
        deployPot: { chainId: 8453, to: RELAYER, data: "0x01" },
      }).map((tx) => tx.what),
    ).toEqual([`Kitchen.deployPot of Pot ${pot}`, `signed cook on Pot ${pot}`]);
  });

  it("defaults: value 0, anyone may submit, a random nonce, and a deadline --within from now", async () => {
    const argv = [
      ...["sign", file, "--chain", "base", "--private-key", KEY, "--offline", "--json"],
      ...["--max-fee", "1", "--within", "600", ...ARGS],
    ];
    const first = signedOf(await sauce(...argv));
    const second = signedOf(await sauce(...argv));
    const now = Math.floor(Date.now() / 1000);
    expect(Number(first.deadline)).toBeGreaterThanOrEqual(now + 590);
    expect(Number(first.deadline)).toBeLessThanOrEqual(now + 610);
    expect(first).toMatchObject({ value: "0", submitter: zeroAddress });
    expect(first.cook!.value).toBe("0x0");
    expect(first.nonce).not.toBe(second.nonce);

    const hour = signedOf(
      await sauce(
        ...["sign", file, "--chain", "base", "--private-key", KEY, "--offline", "--json"],
        ...["--max-fee", "1", ...ARGS],
      ),
    );
    expect(Number(hour.deadline)).toBeGreaterThanOrEqual(now + 3590);
    expect(Number(hour.deadline)).toBeLessThanOrEqual(now + 3610);
  });

  it("prints the JSON on stdout and its notes on stderr, with --json or without", async () => {
    const argv = [
      ...["sign", file, "--chain", "base", "--private-key", KEY, "--offline"],
      ...["--max-fee", "1", "--nonce", "9", "--deadline", "2000000000", ...ARGS],
    ];
    const plain = await sauce(...argv);
    const json = await sauce(...argv, "--json");
    expect(signedOf(plain)).toMatchObject({ nonce: "9", deadline: "2000000000" });
    expect(json.stdout).toBe(plain.stdout);
    // --json takes nothing away from stderr: the notes are there either way.
    expect(plain.stderr).toContain("Anyone may submit this cook, once (nonce 9)");
    expect(json.stderr).toBe(plain.stderr);
  });

  it("prints the typed data alone with no signer, and builds the cook from a signature made elsewhere", async () => {
    const fields = [
      ...["--chain", "base", "--owner", OWNER.address, "--offline", "--json"],
      ...["--max-fee", "99", "--nonce", "300", "--deadline", "2000000000"],
    ];
    const unsigned = await sauce("sign", file, ...fields, ...ARGS);
    const typed = signedOf(unsigned);
    expect(typed.signature).toBeUndefined();
    expect(typed.cook).toBeUndefined();
    expect(unsigned.stderr).toContain("No signer was given: sign typedData with the Pot's owner");
    const execution: SignedCookExecution = {
      chainId: BASE.id,
      pot: typed.pot,
      engine: typed.engine,
      program: PROGRAM,
      maxExecutionFee: 99n,
      nonce: 300n,
      deadline: 2_000_000_000n,
    };
    expect(typed.typedData).toEqual(signedCookTypedDataJson(execution));

    // The owner signs it somewhere else; the command checks it, then builds the cook.
    const signature = await OWNER.signTypedData(signedCookTypedData(execution));
    const built = signedOf(await sauce("sign", file, ...fields, "--signature", signature, ...ARGS));
    expect(built.signature).toBe(signature);
    const call = decodeFunctionData({ abi: v12PotAbi, data: built.cook!.data });
    expect(call.args).toEqual([
      typed.engine,
      PROGRAM,
      99n,
      300n,
      2_000_000_000n,
      zeroAddress,
      signature,
    ]);

    // Anyone else's signature, or the owner's over other fields, is refused: no cook.
    const stranger = await STRANGER.signTypedData(signedCookTypedData(execution));
    const refused = await sauce("sign", file, ...fields, "--signature", stranger, ...ARGS);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain(
      `the signature given is not ${OWNER.address}'s over this cook`,
    );
    const other = await sauce(
      ...["sign", file, ...fields, "--value", "1", "--signature", signature, ...ARGS],
    );
    expect(other.code).toBe(1);
    expect(other.stderr).toContain("BadSignature");
    // Checked against whom: with --pot and no endpoint the owner is not known.
    const potOnly = await sauce(
      ...["sign", file, "--chain", "base", "--pot", typed.pot, "--offline", "--max-fee", "1"],
      ...["--signature", signature, ...ARGS],
    );
    expect(potOnly.code).toBe(2);
    expect(potOnly.stderr).toContain("a signature is checked against the Pot's owner");
  });

  it("refuses what it cannot sign, before any endpoint or key is reached", async () => {
    const offline = ["--offline", "--max-fee", "1"];
    const cases: Array<[string[], number, string]> = [
      [
        ["sign", file, "--chain", "base", "--owner", RELAYER, "--private-key", KEY, ...offline],
        2,
        `${OWNER.address} does not own the Pot: only its owner, ${RELAYER}, signs`,
      ],
      [
        ["sign", file, "--chain", "base", "--owner", RELAYER, ...offline, "--within", "60"],
        2,
        "give --within or --deadline, not both",
      ],
      [
        ["sign", file, "--chain", "base", "--owner", RELAYER, "--offline"],
        2,
        "missing --max-fee <wei>",
      ],
      [
        ["sign", file, "--chain", "base", "--private-key", KEY, ...offline, "--signature", "0x01"],
        2,
        "give a signer or --signature, not both",
      ],
      [
        ["sign", file, "--chain", "base", "--cancel", "1", "--owner", RELAYER, "--offline"],
        2,
        "--cancel cancels nonces, and signs no program",
      ],
      [
        ["sign", file, "--chain", "solana", "--owner", RELAYER, ...offline],
        2,
        "signed cooks are the EVM Pot's (Pot.cookSigned)",
      ],
      // A preview chain: refused before the endpoint (unreachable) or the keystore (absent).
      [
        ["sign", file, "--chain", "arbitrum", "--keystore", join(work, "absent.json")],
        1,
        "signing a cook is refused: it involves arbitrum",
      ],
      [
        ["sign", "--cancel", "1", "--chain", "arbitrum", "--owner", RELAYER],
        1,
        "cancelling signed cooks is refused: it involves arbitrum",
      ],
      // The zero owner is a Shared Pot's, which signs and cancels nothing: no private Pot of it exists.
      [
        ["sign", "--cancel", "1", "--chain", "base", "--owner", zeroAddress, "--offline"],
        2,
        "Kitchen.deployPot reverts for the owner 0x0000000000000000000000000000000000000000",
      ],
    ];
    for (const [argv, code, message] of cases) {
      const deadline = argv.includes("--within") ? ["--deadline", "2000000000"] : [];
      const run = await sauce(
        ...argv,
        ...deadline,
        ...(argv.includes("--cancel") && !argv.includes(file) ? [] : ARGS),
        ...(argv.includes("arbitrum") ? ["--rpc-url", "http://127.0.0.1:9"] : []),
      );
      expect([argv, run.code, run.stderr]).toEqual([argv, code, expect.stringContaining(message)]);
    }
  });

  it("--cancel builds one invalidateNonces per nonce word, unsigned, for the owner", async () => {
    const high = 1n << 255n;
    const run = await sauce(
      ...["sign", "--cancel", "1", "--cancel", "2", "--cancel", "300", "--cancel", high.toString()],
      ...["--chain", "base", "--owner", OWNER.address, "--offline", "--json"],
    );
    expect(run.code).toBe(0);
    const out = JSON.parse(run.stdout) as {
      pot: Address;
      nonces: string[];
      transactions: Array<{ to: Address; data: Hex; value: string; word: string; mask: string }>;
      sendCalls?: { calls: unknown[] };
    };
    const pot = getAddress(v12PredictPot(OWNER.address));
    expect(out.pot).toBe(pot);
    const words = out.transactions.map((tx) => {
      expect([tx.to, tx.value]).toEqual([pot, "0x0"]);
      const call = decodeFunctionData({ abi: v12PotAbi, data: tx.data });
      expect(call.functionName).toBe("invalidateNonces");

      return call.args as readonly [bigint, bigint];
    });
    expect(words).toEqual([
      [0n, (1n << 1n) | (1n << 2n)],
      [1n, 1n << 44n],
      [cookNonceWordBit(high).word, 1n],
    ]);
    expect(out.transactions.map((tx) => [tx.word, tx.mask])).toEqual(
      words.map(([word, mask]) => [word!.toString(), mask!.toString()]),
    );
    // A wallet's send_calls takes them as one batch.
    expect(out.sendCalls?.calls).toHaveLength(3);
    expect(run.stderr).toContain("only the owner (or the Pot itself, from a cook) sets a nonce");
    expect(plannedTransactions(out)).toHaveLength(3);
  });
});

describe("sauce sign from a wallet with a policy", () => {
  let address: Address;
  let pot: Address;
  const policy = (fields: Record<string, unknown>) =>
    writeFileSync(join(work, "wallets", "agent.policy.json"), JSON.stringify(fields), {
      mode: 0o600,
    });
  const sign = () =>
    sauce(
      ...["sign", file, "--chain", "base", "--wallet", "agent"],
      ...["--password-env", "SAUCE_TEST_SIGN_PW", "--offline", "--max-fee", "1", "--json", ...ARGS],
    );

  beforeAll(async () => {
    const { info } = await new WalletStore(join(work, "wallets")).create("agent", "evm", PASSWORD);
    address = getAddress(info.address);
    pot = getAddress(v12PredictPot(address));
  }, 60_000);

  it("signs with no policy, and with one that only names its chains and the Pot", async () => {
    const free = await sauce(
      ...["sign", file, "--chain", "base", "--wallet", "agent", "--password-env"],
      ...["SAUCE_TEST_SIGN_PW", "--offline", "--max-fee", "1", "--json", ...ARGS],
    );
    expect(signedOf(free).owner).toBe(address);
    expect(free.stderr).toContain("wallet agent has no policy");

    policy({ chains: ["base"], to: [pot.toLowerCase()] });
    const signed = signedOf(await sign());
    expect(signed.pot).toBe(pot);
    const execution = {
      chainId: BASE.id,
      pot,
      engine: signed.engine,
      program: PROGRAM,
      maxExecutionFee: 1n,
      nonce: BigInt(signed.nonce),
      deadline: BigInt(signed.deadline),
    };
    expect(
      await recoverTypedDataAddress({
        ...signedCookTypedData(execution),
        signature: signed.signature!,
      }),
    ).toBe(address);
  }, 60_000);

  it("refuses a native or token limit, and a chain or a Pot the policy does not name", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ native: { perTransaction: "0.01" } }, "native is limited, and a signed cook runs when"],
      [{ tokens: { USDC: { perDay: "100" } } }, "tokens.USDC is limited, and a signed cook runs"],
      [
        { to: [RELAYER.toLowerCase()] },
        `to allows 1 address(es), and this cook runs on Pot ${pot}`,
      ],
      [{ chains: ["ethereum"] }, "chains allows ethereum, and this cook is on base"],
    ];
    for (const [fields, message] of cases) {
      policy(fields);
      const run = await sign();
      expect([fields, run.code, run.stderr]).toEqual([
        fields,
        1,
        expect.stringContaining(`refused by the policy of wallet agent`),
      ]);
      expect(run.stderr).toContain(message);
      expect(run.stdout).toBe("");
    }
  }, 120_000);

  it("names the limit each refusal hits", () => {
    const info = new WalletStore(join(work, "wallets")).info("agent");
    const limits: Array<[Record<string, unknown>, string]> = [
      [{ native: { perDay: "1" } }, "native"],
      [{ tokens: { WETH: { perTransaction: "1" } } }, "tokens.WETH"],
      [{ to: [RELAYER.toLowerCase()] }, "to"],
      [{ chains: ["ethereum"] }, "chains"],
    ];
    for (const [fields, limit] of limits) {
      policy(fields);
      const guard = guardWallet(info, readPolicy(info));
      let refusal: unknown;
      try {
        guard.authorizeSignedCook(BASE, pot);
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toBeInstanceOf(PolicyRefusal);
      expect((refusal as PolicyRefusal).limit).toBe(limit);
    }
    policy({ chains: ["base"], to: [pot.toLowerCase()] });
    expect(() => guardWallet(info, readPolicy(info)).authorizeSignedCook(BASE, pot)).not.toThrow();
  });
});

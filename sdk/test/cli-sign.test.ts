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
import { decodeFunctionData, getAddress, zeroAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { requireChain } from "../src/chains/canonical.js";
import { guardWallet, PolicyRefusal, readPolicy } from "../src/cli/policy.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { plannedTransactions } from "../src/cli/wallet-send.js";
import { WalletStore } from "../src/cli/wallets.js";
import { v12PredictPot } from "../src/deployments/pot.js";
import { cookNonceWordBit, v12PotAbi } from "../src/evm/engine.js";

const KEY = generatePrivateKey();
const OWNER = privateKeyToAccount(KEY);
const RECIPIENT = getAddress("0x6666666666666666666666666666666666666666");
const RELAYER = getAddress("0x3333333333333333333333333333333333333333");
const BASE = requireChain("base");
const SOURCE = `function main(recipient: Address, amount: Uint256): void {
  USDC.transfer(recipient, amount);
}
`;
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

const ARGS = ["--args", RECIPIENT, "1000000"];

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "sauce-sign-"));
  file = join(work, "pay.sauce.ts");
  writeFileSync(file, SOURCE);
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("sauce sign", () => {
  it.each([
    ["--private-key", KEY],
    ["--owner", OWNER.address],
    ["--pot", getAddress(v12PredictPot(OWNER.address)), "--signature", "0x01"],
  ])(
    "refuses offline cook authorization without a verified deployed binding: %s",
    async (...target) => {
      const result = await sauce(
        "sign",
        file,
        "--chain",
        "base",
        "--offline",
        "--max-fee",
        "1",
        ...target,
        ...ARGS,
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("authenticated deployed Pot");
      expect(result.stdout).toBe("");
    },
  );

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
      // Refused before the signer is unlocked (here a keystore that is not there) or an endpoint.
      [
        ["sign", "--cancel", "1", "--chain", "base", "--owner", zeroAddress],
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
        ...(argv.includes(zeroAddress) && !argv.includes("--offline")
          ? ["--keystore", join(work, "absent.json"), "--rpc-url", "http://127.0.0.1:9"]
          : []),
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

  it("does not let an unrestricted wallet policy authorize an unverified offline Pot", async () => {
    const result = await sign();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("authenticated deployed Pot");
    expect(result.stdout).toBe("");
  });

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

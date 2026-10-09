/**
 * `sauce sign` (`cli/sign.ts`): a program signed for a Pot with `@sauce/signed`. The typed data it
 * prints is the SDK's (`routes/signed.ts`), which `std/signed/evm.e2e.test.ts` holds to what the
 * Pot checks; here, that the command prints it, that its signature recovers to the Pot's owner, that
 * `execute` carries exactly the program with its arguments, and what it refuses. Reads no chain.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  decodeFunctionData,
  getAddress,
  recoverTypedDataAddress,
  type Hex,
  type TypedDataDefinition,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { v12PredictPot } from "../src/deployments/pot.js";
import { SAUCE_INTENT_POT_SALT } from "../src/deployments/pot.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";
import { executeTypedData, signedAbi, signedProgram } from "../src/routes/signed.js";

/** Anvil's first dev key: generated for tests, thrown away. */
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const OWNER = privateKeyToAccount(KEY);
const RECIPIENT = "0x000000000000000000000000000000000000bEEF";
const SOURCE = `function main(recipient: Address, amount: Uint256): void {
  USDC.transfer(recipient, amount);
}
`;

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function sauce(...argv: string[]): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    ...nodeIo(),
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
  };
  const code = await runCli(argv, io);

  return { code, stdout, stderr };
}

let work: string;
let file: string;
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "sauce-sign-"));
  file = join(work, "pay.sauce.ts");
  writeFileSync(file, SOURCE);
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

interface Signed {
  chainId: number;
  pot: Hex;
  program: Hex;
  salt: Hex;
  deadline: string;
  typedData: TypedDataDefinition & { message: { deadline: string } };
  signature?: Hex;
  execute?: { chainId: number; to: Hex; data: Hex; value: string };
}

describe("sauce sign", () => {
  it("signs the program with its arguments for the signer's Pot, and builds its execute", async () => {
    const salt = `0x${"ab".repeat(32)}` as Hex;
    const run = await sauce(
      "sign",
      file,
      "--chain",
      "base",
      "--private-key",
      KEY,
      "--deadline",
      "2000000000",
      "--signed-salt",
      salt,
      "--args",
      RECIPIENT,
      "1000000",
    );
    expect(run.code).toBe(0);
    const signed = JSON.parse(run.stdout) as Signed;
    const pot = getAddress(v12PredictPot(OWNER.address, SAUCE_INTENT_POT_SALT));
    expect(signed.pot).toBe(pot);
    const program = signedProgram(compileSauceProgram("base", SOURCE), [RECIPIENT, 1_000_000n]);
    expect(signed.program).toBe(program);
    expect(signed).toMatchObject({ chainId: 8453, salt, deadline: "2000000000" });

    // What it prints is the SDK's typed data, with the domain's type spelled out.
    const expected = executeTypedData({
      pot,
      chainId: 8453,
      program,
      salt,
      deadline: 2_000_000_000n,
    });
    expect(signed.typedData.types).toEqual({
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ...expected.types,
    });
    expect(await recoverTypedDataAddress({ ...expected, signature: signed.signature! })).toBe(
      OWNER.address,
    );

    expect(signed.execute).toMatchObject({ chainId: 8453, to: pot, value: "0" });
    const call = decodeFunctionData({ abi: signedAbi, data: signed.execute!.data });
    expect(call.functionName).toBe("execute");
    expect(call.args).toEqual([program, salt, 2_000_000_000n, signed.signature]);
    expect(run.stderr).toContain("@sauce/signed installed");
  });

  it("prints the typed data alone with no signer, for the owner to sign elsewhere", async () => {
    const run = await sauce(
      "sign",
      file,
      "--chain",
      "base",
      "--owner",
      OWNER.address,
      "--within",
      "600",
      "--args",
      RECIPIENT,
      "5",
    );
    expect(run.code).toBe(0);
    const signed = JSON.parse(run.stdout) as Signed;
    expect(signed.signature).toBeUndefined();
    expect(signed.execute).toBeUndefined();
    expect(signed.salt).toMatch(/^0x[0-9a-f]{64}$/);
    const now = Math.floor(Date.now() / 1000);
    expect(Number(signed.deadline)).toBeGreaterThanOrEqual(now + 590);
    expect(Number(signed.deadline)).toBeLessThanOrEqual(now + 610);
    expect(run.stderr).toContain("No signer was given");
  });

  it("refuses a signer that does not own the Pot, both deadlines, and Solana", async () => {
    const other = await sauce(
      "sign",
      file,
      "--chain",
      "base",
      "--owner",
      RECIPIENT,
      "--private-key",
      KEY,
      "--args",
      RECIPIENT,
      "5",
    );
    expect(other.code).not.toBe(0);
    expect(other.stderr).toContain("does not own the Pot");

    const both = await sauce(
      "sign",
      file,
      "--chain",
      "base",
      "--owner",
      OWNER.address,
      "--within",
      "60",
      "--deadline",
      "2000000000",
      "--args",
      RECIPIENT,
      "5",
    );
    expect(both.code).not.toBe(0);
    expect(both.stderr).toContain("give --within or --deadline, not both");

    const svm = join(work, "svm.sauce.ts");
    writeFileSync(svm, "function main(): void {}\n");
    const solana = await sauce("sign", svm, "--chain", "solana", "--owner", OWNER.address);
    expect(solana.code).not.toBe(0);
    expect(solana.stderr).toContain("solana has none");
  });

  it("refuses a preview chain, as every command that builds a transaction does", async () => {
    const run = await sauce(
      "sign",
      file,
      "--chain",
      "arbitrum",
      "--owner",
      OWNER.address,
      "--args",
      RECIPIENT,
      "5",
    );
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("signing a program for a Pot is refused: it involves arbitrum");
  });
});

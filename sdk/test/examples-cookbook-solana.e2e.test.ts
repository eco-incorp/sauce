/**
 * The `sauce-examples` skill's Solana program, `skills/sauce-examples/examples/pay-stock.sauce.ts`,
 * EXECUTED: run as its header says, through `sauce run` itself, which stages it (it is past one
 * transaction with its accounts) and cooks it on the owner's Pot, against the released Kitchen and
 * engine in LiteSVM behind a JSON-RPC shim (`svm/rpc-shim.ts`). No cluster, no network.
 *
 * TSLAx is its mint as Solana mainnet holds it (`svm/fixtures/token-2022/stock-mints.json`: every
 * extension an xStocks mint carries), at its registry address, the harness's payer made its mint
 * authority so the Pot can be given some. Each account is passed by the names the header gives
 * (`program:TSLAx`, `pot:TSLAx`, `mint:TSLAx`). What `main` returns is read from the engine's
 * return data in the cook's logs, as the type it declares; what moved, from the token accounts.
 * The EVM programs run in `actions/tests/examples-cookbook.mainnet.test.ts`.
 *
 * GATED on the engine artifacts like every engine-executing suite, and a hard failure without them
 * in CI.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  address,
  createKeyPairSignerFromBytes,
  getAddressCodec,
  getBase64Encoder,
  lamports,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getMintToCheckedInstruction,
} from "@solana-program/token";
import { bytesToHex } from "viem";

import { requireChain } from "../src/chains/canonical.js";
import { decodeReturned } from "../src/cli/returned.js";
import { nodeIo, runCli } from "../src/cli/run.js";
import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../src/deployments/index.js";
import { svmTokenRows } from "../src/routes/token-registry.js";
import { derivePotPda } from "../src/svm/index.js";
import {
  describeSvm,
  ENGINE_SO,
  randomAddress,
  sendInstructions,
  startEngine,
  TOKEN_2022_PROGRAM,
  tokenAmount,
  type EngineHarness,
} from "./svm/engine-harness.js";
import { solanaShim, type SolanaShim } from "./svm/rpc-shim.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(HERE, "../../skills/sauce-examples/examples/pay-stock.sauce.ts");
const RETURNS = "{ received: Uint256; left: Uint256 }";
const SOLANA_URL = "http://127.0.0.1:65534/";
const KITCHEN = address(v12SvmKitchenProgramId());
const ENGINE = v12SvmEngineProgramId();

/** TSLAx as Solana mainnet holds it. */
const TSLAX_IMAGE = (
  JSON.parse(readFileSync(join(HERE, "svm/fixtures/token-2022/stock-mints.json"), "utf8")) as {
    mints: { TSLAx: { dataBase64: string } };
  }
).mints.TSLAx;

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function sauce(...argv: string[]): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const code = await runCli(argv, {
    ...nodeIo(),
    confirm: async () => undefined,
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
  });

  return { code, stdout, stderr };
}

/** A keypair file as solana-keygen writes it, and the signer it holds. */
async function keypairFile(dir: string): Promise<{ path: string; signer: KeyPairSigner }> {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const bytes = new Uint8Array([...seed, ...pub]);
  const path = join(dir, "owner.json");
  writeFileSync(path, JSON.stringify([...bytes]));

  return { path, signer: await createKeyPairSignerFromBytes(bytes) };
}

describeSvm("pay-stock: a TSLAx payment from the Pot, with its accounts bound", () => {
  let harness: EngineHarness;
  let shim: SolanaShim;
  let work: string;
  let owner: { path: string; signer: KeyPairSigner };
  let mint: Address;
  let pot: Address;
  let potTslax: Address;

  /** The TSLAx account of `holder`: created, and given `amount` from the mint. */
  async function tslaxAccount(holder: Address, amount: bigint): Promise<Address> {
    const [account] = await findAssociatedTokenPda({
      owner: holder,
      mint,
      tokenProgram: TOKEN_2022_PROGRAM,
    });
    const made = await sendInstructions(harness, [
      getCreateAssociatedTokenIdempotentInstruction({
        payer: harness.payer,
        ata: account,
        owner: holder,
        mint,
        tokenProgram: TOKEN_2022_PROGRAM,
      }),
      ...(amount === 0n
        ? []
        : [
            getMintToCheckedInstruction(
              { mint, token: account, mintAuthority: harness.payer, amount, decimals: 8 },
              { programAddress: TOKEN_2022_PROGRAM },
            ),
          ]),
    ]);
    if (!made.ok) throw new Error(`creating ${account} failed: ${made.err}`);

    return account;
  }

  /** `sauce run` of the example as its header gives it, to `destination`, for `payee`. */
  const pay = (destination: Address, payee: Address, amount: bigint, keep: bigint) =>
    sauce(
      ...["run", EXAMPLE, "--chain", "solana", "--rpc-url", SOLANA_URL, "--keypair", owner.path],
      ...["--auto-approve", "--json"],
      ...["--account", "tokenProgram=program:TSLAx", "--account", "source=pot:TSLAx"],
      ...["--account", "mint=mint:TSLAx", "--account", `destination=${destination}`],
      ...["--account", "pot=pot", "--args", payee, String(amount), String(keep)],
    );

  /** What `main` returned: the engine's return data in the cook's logs, read as its type. */
  async function returned(run: Run): Promise<unknown> {
    const { cook } = JSON.parse(run.stdout) as { cook: { signature: string } };
    const response = await fetch(SOLANA_URL, {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [cook.signature, { encoding: "base64" }],
      }),
    });
    const { result } = (await response.json()) as { result: { meta: { logMessages: string[] } } };
    let data: Uint8Array | undefined;
    for (const line of result.meta.logMessages) {
      const match = /^Program return: (\w+) ([A-Za-z0-9+/=]*)$/.exec(line);
      if (match !== null && match[1] === ENGINE) {
        data = new Uint8Array(getBase64Encoder().encode(match[2]!));
      }
    }
    if (data === undefined) throw new Error("the cook's logs carry no return from the engine");

    return decodeReturned(RETURNS, bytesToHex(data), requireChain("solana"));
  }

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n, ENGINE_SO as string, address(ENGINE));
    work = mkdtempSync(join(tmpdir(), "sauce-cookbook-solana-"));
    owner = await keypairFile(work);
    harness.svm.airdrop(owner.signer.address, lamports(10_000_000_000n));
    // TSLAx as mainnet holds it, at its address, the harness's payer its mint authority.
    const row = svmTokenRows(requireChain("solana")).find((one) => one.symbol === "TSLAx")!;
    expect(row.tokenProgram).toBe(TOKEN_2022_PROGRAM);
    mint = address(row.mint);
    const image = new Uint8Array(Buffer.from(TSLAX_IMAGE.dataBase64, "base64"));
    image.set(getAddressCodec().encode(harness.payer.address), 4);
    harness.svm.setAccount({
      address: mint,
      data: image,
      executable: false,
      lamports: lamports(harness.svm.minimumBalanceForRentExemption(BigInt(image.length))),
      programAddress: TOKEN_2022_PROGRAM,
      space: BigInt(image.length),
    });
    // The owner's Pot, salt zero as the header runs it, holding 5 TSLAx.
    pot = (await derivePotPda(KITCHEN, owner.signer.address, new Uint8Array(32))).address;
    potTslax = await tslaxAccount(pot, 500_000_000n);
    shim = solanaShim(harness.svm, SOLANA_URL);
    shim.install();
  }, 120_000);

  afterAll(() => {
    shim?.restore();
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  it("pays the payee's account and returns what arrived and what the Pot has left", async () => {
    const payee = randomAddress();
    const destination = await tslaxAccount(payee, 0n);
    const run = await pay(destination, payee, 100_000_000n, 200_000_000n);
    expect(run.code).toBe(0);
    const out = JSON.parse(run.stdout) as { cook: { status?: string }; staged?: unknown };
    expect(out.staged).toBeDefined(); // past one transaction: staged, as the header says
    expect(tokenAmount(harness, destination)).toBe(100_000_000n);
    expect(tokenAmount(harness, potTslax)).toBe(400_000_000n);
    expect(await returned(run)).toEqual({ received: "100000000", left: "400000000" });
  }, 120_000);

  it("refuses a destination that is not the payee's, and a payment that leaves less than keep", async () => {
    const payee = randomAddress();
    const theirs = await tslaxAccount(payee, 0n);
    const someoneElse = await tslaxAccount(randomAddress(), 0n);
    const held = tokenAmount(harness, potTslax);

    const wrong = await pay(someoneElse, payee, 1n, 0n);
    expect(wrong.code).not.toBe(0);
    expect(`${wrong.stdout}${wrong.stderr}`).toContain("not the payee's TSLAx account");
    const greedy = await pay(theirs, payee, held, 1n);
    expect(greedy.code).not.toBe(0);
    expect(`${greedy.stdout}${greedy.stderr}`).toContain("the Pot would keep less than keep");
    expect(tokenAmount(harness, potTslax)).toBe(held);
    expect(tokenAmount(harness, theirs)).toBe(0n);
  }, 120_000);
});

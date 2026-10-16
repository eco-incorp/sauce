/**
 * `svm/portal-source.ts` against the programs' own definitions, offline: the Anchor discriminators
 * from their derivation, the PDAs and the intent hash against eco-routes-svm's goldens for the
 * rotated ids (`programs/{portal,hyper-prover}/src/**\/testdata/*.golden` at aa8059e), the
 * HyperProver's whitelist as mainnet holds it (the pinned dump), and what each instruction carries,
 * read back. `cli-intent-solana-source.e2e.test.ts` runs them against the programs.
 */
import { createHash } from "node:crypto";
import { address, getAddressEncoder, type Address } from "@solana/kit";
import { bytesToHex, concat, keccak256, toHex, type Hex } from "viem";

import { ecoRoutesContract } from "../src/protocols/eco-routes/lookup.js";
import { encodeRewardSvm, hashIntent } from "../src/routes/encode.js";
import { toUniversalAddress } from "../src/routes/normalize.js";
import { compileSauceProgram, lowerProgramIntents } from "../src/routes/sauce-route.js";
import type { Intent } from "../src/routes/types.js";
import {
  buildPortalFundInstruction,
  buildPortalPublishInstruction,
  buildPortalRefundInstruction,
  buildPortalWithdrawInstruction,
  decodeHyperWhitelist,
  decodePortalPublish,
  decodeSvmProof,
  PORTAL_SOURCE_DISCRIMINATORS,
  SOLANA_CHAIN_ID,
  svmHyperConfigPda,
  svmHyperPdaPayerPda,
  svmProofCloserPda,
  svmProofPda,
  svmRewardTokens,
  svmVaultPda,
  svmWithdrawnMarkerPda,
  TOKEN_PROGRAM_ID,
  universalOfSvmKey,
} from "../src/svm/index.js";
import { svmSourceInstruction } from "../src/cli/lifecycle-svm-source.js";
import { accountAddress, fixtureBytes, MANIFEST } from "./svm/eco-routes-svm.js";

const PORTAL = address("EcoowmRRrMyYtQCuh5fCvMDWcD6B9ZDZkpgedf2bWKXi");
const HYPER = address("EcoHjwFYKtiHp5ZuFQBc87GDikm9Lc5EYapKywjNAQQF");
const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const keyOf = (value: string): Hex =>
  bytesToHex(new Uint8Array(getAddressEncoder().encode(address(value))));
const bytes = (fill: number): Hex => toHex(new Uint8Array(32).fill(fill));
/** `types::intent_hash(1000, [6; 32], [8; 32])`, which the PDA goldens key on. */
const GOLDEN_INTENT = keccak256(concat([toHex(1000n, { size: 8 }), bytes(6), bytes(8)]));

const intent = (creator: Address): Intent => ({
  sourceChainId: SOLANA_CHAIN_ID,
  destination: 8453n,
  route: {
    salt: bytes(1),
    deadline: 1_900_000_000n,
    portal: toUniversalAddress("0xEC000769A73b70e16f361a442292500b3BCf4A85"),
    nativeAmount: 0n,
    tokens: [],
    calls: [],
  },
  reward: {
    deadline: 1_900_007_200n,
    creator: universalOfSvmKey(creator),
    prover: universalOfSvmKey(HYPER),
    nativeAmount: 0n,
    tokens: [{ token: universalOfSvmKey(USDC), amount: 1_050_000n }],
  },
});

describe("svm/portal-source.ts", () => {
  it("names each instruction, account and event by its Anchor discriminator", () => {
    const anchor = (name: string) => [...createHash("sha256").update(name).digest().subarray(0, 8)];
    const d = PORTAL_SOURCE_DISCRIMINATORS;
    expect([...d.publish]).toEqual(anchor("global:publish"));
    expect([...d.fund]).toEqual(anchor("global:fund"));
    expect([...d.withdraw]).toEqual(anchor("global:withdraw"));
    expect([...d.refund]).toEqual(anchor("global:refund"));
    expect([...d.proofAccount]).toEqual(anchor("account:ProofAccount"));
    expect([...d.config]).toEqual(anchor("account:Config"));
    expect([...d.intentPublished]).toEqual(anchor("event:IntentPublished"));
    expect([...d.intentFunded]).toEqual(anchor("event:IntentFunded"));
    expect([...d.intentWithdrawn]).toEqual(anchor("event:IntentWithdrawn"));
    expect([...d.intentRefunded]).toEqual(anchor("event:IntentRefunded"));
  });

  it("derives the PDAs eco-routes-svm pins for the rotated ids", async () => {
    // portal/src/state/testdata/vault_pda_deterministic.golden
    expect(keyOf(await svmVaultPda(PORTAL, GOLDEN_INTENT))).toBe(
      toHex(
        Uint8Array.from([
          27, 210, 34, 34, 108, 81, 253, 26, 213, 137, 118, 194, 60, 189, 174, 167, 191, 169, 13,
          103, 235, 221, 229, 20, 33, 217, 38, 125, 37, 74, 2, 37,
        ]),
      ),
    );
    // portal/src/state/testdata/withdrawn_marker_pda_deterministic.golden
    expect(keyOf(await svmWithdrawnMarkerPda(PORTAL, GOLDEN_INTENT))).toBe(
      toHex(
        Uint8Array.from([
          105, 36, 17, 191, 152, 189, 47, 120, 38, 122, 66, 84, 194, 74, 0, 23, 184, 186, 56, 76,
          89, 219, 165, 110, 26, 208, 9, 210, 45, 115, 245, 144,
        ]),
      ),
    );
    // portal/src/state/testdata/proof_closer_pda_deterministic.golden: the prover [9; 32]
    expect(
      keyOf(
        await svmProofCloserPda(PORTAL, address("cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN")),
      ),
    ).toBe(
      toHex(
        Uint8Array.from([
          189, 189, 156, 115, 234, 15, 114, 30, 28, 111, 190, 85, 196, 235, 7, 209, 207, 209, 4, 27,
          212, 68, 33, 139, 7, 51, 7, 143, 92, 190, 23, 106,
        ]),
      ),
    );
    // hyper-prover/src/state/testdata/{pda_payer,config}_pda_deterministic.golden
    expect(keyOf(await svmHyperPdaPayerPda(HYPER))).toBe(
      toHex(
        Uint8Array.from([
          120, 64, 66, 232, 189, 72, 233, 252, 234, 51, 70, 47, 238, 137, 139, 162, 7, 135, 187,
          133, 250, 181, 249, 147, 170, 32, 235, 238, 134, 236, 88, 32,
        ]),
      ),
    );
    expect(await svmHyperConfigPda(HYPER)).toBe(accountAddress("hyper_prover_config"));
    // eco-svm-std prover/testdata/proof_pda_deterministic.golden: [42; 32] under [123; 32]
    expect(
      await svmProofPda(address("9K2Mc3HFjgXsA8mRek81nfvq2XskqpSrjByiAkWgtyfx"), bytes(42)),
    ).toBe("3wEBEXgS4aVt7PpcjZgs8hCC5rtu3hcLBLvDWAYsxvzM");
  });

  it("hashes a Solana reward as the Portal does", () => {
    // portal/src/types/testdata/intent_hash_deterministic.golden
    const reward = {
      deadline: 1_500_000n,
      creator: bytes(0),
      prover: bytes(7),
      nativeAmount: 250n,
      tokens: [
        { token: bytes(40), amount: 1000n },
        { token: bytes(50), amount: 2000n },
      ],
    };
    expect(
      keccak256(concat([toHex(1000n, { size: 8 }), bytes(6), keccak256(encodeRewardSvm(reward))])),
    ).toBe(
      toHex(
        Uint8Array.from([
          47, 43, 194, 187, 39, 236, 51, 33, 185, 71, 17, 103, 14, 78, 239, 174, 115, 168, 25, 103,
          247, 164, 53, 96, 182, 71, 91, 199, 1, 176, 236, 18,
        ]),
      ),
    );
  });

  it("reads mainnet's HyperProver whitelist: the EVM HyperProver it takes proofs from", () => {
    const config = MANIFEST.accounts.find((entry) => entry.name === "hyper_prover_config")!;
    expect(decodeHyperWhitelist(fixtureBytes(config.file))).toEqual([
      toUniversalAddress(ecoRoutesContract("base", "HyperProver")).toLowerCase(),
    ]);
  });

  it("orders the reward's mints as the Portal's map does, adding a mint listed twice", () => {
    const low = universalOfSvmKey(address("11111111111111111111111111111112"));
    const reward = {
      ...intent(USDC).reward,
      tokens: [
        { token: universalOfSvmKey(USDC), amount: 1n },
        { token: low, amount: 5n },
        { token: universalOfSvmKey(USDC), amount: 2n },
      ],
    };
    expect(svmRewardTokens(reward)).toEqual([
      { mint: "11111111111111111111111111111112", amount: 5n },
      { mint: USDC, amount: 3n },
    ]);
  });

  it("publishes, funds, withdraws and refunds the intent its hash names", async () => {
    const creator = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
    const solved = intent(creator);
    const { intentHash } = hashIntent(solved);
    const publish = buildPortalPublishInstruction({ intent: solved, portal: PORTAL });
    expect(publish.accounts).toEqual([]);
    const decoded = decodePortalPublish(new Uint8Array(publish.data!))!;
    expect(decoded.destination).toBe(8453n);
    expect(decoded.reward).toEqual(solved.reward);
    const programs = { [USDC]: TOKEN_PROGRAM_ID };
    const fund = await buildPortalFundInstruction({
      intent: solved,
      portal: PORTAL,
      payer: creator,
      tokenPrograms: programs,
    });
    expect(svmSourceInstruction(new Uint8Array(fund.data!))).toEqual({
      event: "funded",
      intentHash,
    });
    // The vault is the intent's: the third account, then one (from, to, mint) chunk.
    expect(fund.accounts![2]!.address).toBe(await svmVaultPda(PORTAL, intentHash));
    expect(fund.accounts!.length).toBe(7 + 3);
    const withdraw = await buildPortalWithdrawInstruction({
      intent: solved,
      portal: PORTAL,
      payer: creator,
      claimant: creator,
      tokenPrograms: programs,
    });
    expect(svmSourceInstruction(new Uint8Array(withdraw.data!))).toEqual({
      event: "claimed",
      intentHash,
    });
    expect(withdraw.accounts![3]!.address).toBe(await svmProofPda(HYPER, intentHash));
    expect(withdraw.accounts!.at(-1)!.address).toBe(await svmHyperPdaPayerPda(HYPER));
    for (const closesProof of [false, true]) {
      const refund = await buildPortalRefundInstruction({
        intent: solved,
        portal: PORTAL,
        payer: creator,
        mints: [USDC],
        tokenPrograms: programs,
        closesProof,
      });
      expect(svmSourceInstruction(new Uint8Array(refund.data!))).toEqual({
        event: "refunded",
        intentHash,
      });
      expect(refund.data!.at(-1)).toBe(closesProof ? 1 : 0);
      // An optional account left out is the program's own id.
      expect(refund.accounts![4]!.address).toBe(
        closesProof ? await svmProofCloserPda(PORTAL, HYPER) : PORTAL,
      );
    }
  });

  it("decodes a proof the HyperProver records, and refuses what is not one", () => {
    const claimant = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
    const data = new Uint8Array(48);
    data.set(PORTAL_SOURCE_DISCRIMINATORS.proofAccount);
    new DataView(data.buffer).setBigUint64(8, 8453n, true);
    data.set(getAddressEncoder().encode(claimant), 16);
    expect(decodeSvmProof(data)).toEqual({
      destination: 8453n,
      claimant: universalOfSvmKey(claimant),
    });
    expect(decodeSvmProof(new Uint8Array(48))).toBeNull();
  });
});

describe("an intent from Solana, lowered", () => {
  const FILE = `function main(recipient: Address) {
  Base(() => {
    USDC.transfer(recipient, 1000000);
  }).reward({ tokens: [{ token: USDC, amount: 1050000 }] });
}`;
  const creator = universalOfSvmKey(address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"));

  it("escrows a Solana reward, named on Solana, for Solana's HyperProver", () => {
    const { intents } = lowerProgramIntents("solana", FILE, {
      args: ["0x00000000000000000000000000000000000000aa"],
      intents: { deadline: 1_900_000_000n, creator },
    });
    expect(intents).toHaveLength(1);
    const { intent: opened, destination } = intents[0]!;
    expect(destination.slug).toBe("base");
    expect(opened.sourceChainId).toBe(SOLANA_CHAIN_ID);
    expect(opened.reward).toEqual({
      deadline: 1_900_000_000n,
      creator,
      prover: universalOfSvmKey(HYPER),
      nativeAmount: 0n,
      tokens: [{ token: universalOfSvmKey(USDC), amount: 1_050_000n }],
    });
    // The body is Base's: Base's USDC, delivered by the solver.
    expect(opened.route.tokens).toEqual([
      {
        token: toUniversalAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913").toLowerCase(),
        amount: 1_000_000n,
      },
    ]);
  });

  it("is refused as a program running on Solana", () => {
    expect(() =>
      compileSauceProgram("solana", FILE, { intents: { deadline: 1_900_000_000n, creator } }),
    ).toThrow(/a program running on solana cannot open an intent: publish it from a wallet/);
  });
});

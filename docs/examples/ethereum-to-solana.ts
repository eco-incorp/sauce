// An intent from Ethereum to Solana: "pay this Solana wallet 1 USDC, and whoever does it earns
// 1.05 USDC on Ethereum."
//
// You publish it on Ethereum, from your own wallet, and the reward waits there in escrow. A solver
// pays the USDC on Solana from its own funds, proves it did, and claims the reward. If nobody does
// it in time, you take the reward back. You never send a Solana transaction yourself.
//
// This file only builds the transactions: the addresses are fixtures, and nothing is sent. Your
// Ethereum wallet sends the two it prints, in order: the reward's approval, then the publish.
// `sauce intent import <tx hash> --chain ethereum` then follows the intent from that transaction.
import { Ethereum, Solana, routes } from "@eco-incorp/sauce";
import { ecoRoutesPortal, ecoRoutesProver } from "@eco-incorp/sauce/protocols/eco-routes";
import {
  address,
  associatedTokenAccount,
  svmKeyOf,
  svmTokenTransferCall,
  TOKEN_PROGRAM_ID,
} from "@eco-incorp/sauce/svm";

/** What you decide. The SDK knows the rest: the Portals, the prover and the USDC on each chain. */
export interface PaySolanaWallet {
  /** Your Ethereum address. You publish the intent, and you take the reward back if nobody earns it. */
  readonly creator: `0x${string}`;
  /** The Solana wallet paid, in base58. */
  readonly recipient: string;
  /** The USDC it receives, in USDC's smallest unit: 6 decimals, so 1000000 is 1 USDC. */
  readonly amount: bigint;
  /** The USDC a solver earns on Ethereum for delivering it. */
  readonly reward: bigint;
  /** The last moment a solver may deliver, in unix seconds. */
  readonly deliverBy: bigint;
  /** From when you may take back a reward nobody earned, in unix seconds. */
  readonly refundableFrom: bigint;
  /** Any 32 bytes, so that two intents with the same terms are still two intents. */
  readonly salt: `0x${string}`;
}

export async function paySolanaWallet(input: PaySolanaWallet) {
  const portal = svmKeyOf(ecoRoutesPortal("solana"));
  const mint = svmKeyOf(Solana.USDC.address);
  // The solver pays the wallet's USDC account. It must exist by then: a wallet that has held USDC
  // before has one.
  const account = await associatedTokenAccount(address(input.recipient), mint, TOKEN_PROGRAM_ID);

  const intent = routes.assembleIntent(
    Ethereum.chain,
    Solana.chain,
    {
      salt: input.salt,
      deadline: input.deliverBy,
      portal: ecoRoutesPortal("solana"),
      // What the solver brings to Solana, and what the Portal does with it there.
      tokens: [{ token: Solana.USDC.address, amount: input.amount }],
      calls: [
        await svmTokenTransferCall({
          portal,
          mint,
          amount: input.amount,
          decimals: Solana.USDC.decimals,
          recipient: account,
        }),
      ],
    },
    {
      deadline: input.refundableFrom,
      creator: input.creator,
      prover: ecoRoutesProver("ethereum", "solana"),
      // What waits in escrow on Ethereum until a solver proves it delivered.
      tokens: [{ token: Ethereum.USDC.address, amount: input.reward }],
    },
  );
  const sourcePortal = { portal: ecoRoutesPortal("ethereum") };

  return {
    intent,
    intentHash: routes.hashIntent(intent).intentHash,
    // Approve the Portal for the reward, then publish the intent and escrow the reward in one call.
    transactions: [
      ...routes.approvalTxs(intent, sourcePortal),
      routes.publishAndFundTx(intent, false, sourcePortal),
    ],
  };
}

// Fixtures: who publishes, who is paid, and deadlines an hour and a day after a fixed moment.
const built = await paySolanaWallet({
  creator: "0x4444444444444444444444444444444444444444",
  recipient: "6666666666666666666666666666666666666666666",
  amount: 1_000_000n,
  reward: 1_050_000n,
  deliverBy: 2_000_003_600n,
  refundableFrom: 2_000_086_400n,
  salt: `0x${"01".repeat(32)}`,
});

console.log(`Ethereum to Solana: intent ${built.intentHash}`);
for (const { to, data } of built.transactions) {
  console.log(`  send to ${to}: ${data.slice(0, 10)}…, ${(data.length - 2) / 2} bytes`);
}

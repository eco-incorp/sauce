/**
 * A chain on an anvil that runs what a program opens: the released gated stack (`cli-anvil.ts`'s
 * `startChain`), eco-routes' real Portal at the address the registry records for the chain
 * (`placePortal`), and a mock ERC-20 at the registry's address of each token a suite names, the
 * harness Pot holding plenty of every one.
 *
 * `publish` cooks a compiled program on that Pot and returns each intent the Portal logged, rebuilt
 * in full from its `IntentPublished` (`portal.ts#intentFromPublished`, which holds the rebuilt intent
 * to the hash the log announces). An intent a program opens is built by `@sauce/intents` while the
 * program compiles and encoded as the program runs, so this is where a suite reads it.
 *
 * NOT a `.test.ts`, so jest never collects it. Gated like every executing EVM suite: use
 * `describeEvm`.
 */
import {
  bytesToHex,
  encodeFunctionData,
  getAddress,
  numberToHex,
  parseAbi,
  type Address,
  type Hex,
} from "viem";

import { v12PredictPot } from "../src/deployments/pot.js";
import { v12EngineAddress } from "../src/deployments/index.js";
import { intentFromPublished } from "../src/routes/portal.js";
import type { CompiledSauceProgram } from "../src/routes/sauce-route.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";
import type { Intent } from "../src/routes/types.js";
import { DEPLOYER, FEE, fixture, placePortal, startChain, type LocalChain } from "./cli-anvil.js";
import { POT_SALT } from "./evm/gated-engine.js";

const COOK = parseAbi(["function cook(address engine, bytes program) payable returns (bytes)"]);

/** One intent a program published, rebuilt from the Portal's log. */
export interface PublishedIntent {
  readonly intent: Intent;
  readonly intentHash: Hex;
}

export interface IntentChain {
  readonly local: LocalChain;
  /** The Pot every program runs on: the harness account's. */
  readonly pot: Address;
  /** The Portal, at the chain's registry address. */
  readonly portal: Address;
  /** A token's address on this chain, as the registry records it. */
  token(symbol: string): Address;
  /** Cooks `program`, with `args` appended, and returns what the Portal logged. */
  publish(program: CompiledSauceProgram, args?: Hex): Promise<readonly PublishedIntent[]>;
  stop(): Promise<void>;
}

/** Enough of each token for any intent a suite opens. */
const HELD = 10n ** 30n;

export async function startIntentChain(
  slug: string,
  port: number,
  symbols: readonly string[],
): Promise<IntentChain> {
  const local = await startChain(slug, port);
  const { portal } = await placePortal(local);
  const pot = getAddress(v12PredictPot(DEPLOYER.address, POT_SALT));
  const token = (symbol: string): Address => {
    const address = registryTokenAddress(local.chain, symbol);
    if (address === undefined) throw new Error(`${symbol} is not a token on ${local.chain.slug}`);
    return getAddress(numberToHex(address, { size: 20 }));
  };
  for (const symbol of symbols) {
    await local.plant(fixture("MockERC20"), token(symbol));
    await local.mint(token(symbol), pot, HELD);
  }
  // The native coin a reward pays, from the Pot's own balance.
  await local.testClient.setBalance({ address: pot, value: HELD });

  return {
    local,
    pot,
    portal,
    token,
    publish: async (program, args = "0x") => {
      const hash = await local.send(
        local.deployer,
        pot,
        encodeFunctionData({
          abi: COOK,
          functionName: "cook",
          args: [getAddress(v12EngineAddress()), `${bytesToHex(program.bytecode)}${args.slice(2)}`],
        }),
        FEE,
      );
      const receipt = await local.publicClient.getTransactionReceipt({ hash });

      return receipt.logs
        .filter((log) => getAddress(log.address) === portal)
        .flatMap((log) => {
          const published = intentFromPublished(log, BigInt(local.chain.id));
          return published === undefined ? [] : [published];
        });
    },
    stop: () => local.stop(),
  };
}

/**
 * `sauce sign`: a program signed for a Private Pot with `@sauce/signed`, which anyone may then
 * submit to the Pot's `execute` (a relayer, a hop's body). The command compiles the file with
 * `main`'s arguments as `tx` does, and prints the EIP-712 typed data the Pot's owner signs
 * (`routes/signed.ts`), the signature when a signer is given, and the `execute` call that submits
 * it: `{ to: the Pot, data, value: 0 }`, for any account to send.
 *
 * A stranger's `execute` reaches only a Pot that answers it, and only the owner can make it answer,
 * so the first signature for a Pot sets the Pot up. With an endpoint, the command reads the Pot: its
 * code, and the Router's records for `@sauce/signed`'s handlers (`handlersInPlace`, the core
 * Handler's own check). What is missing becomes steps it sends first (`approvals.ts`), asking once
 * or approved with `--yes`: the Pot's deployment, then the owner's cook of `Signed.setup()`, which
 * installs the handlers. With no signer, the steps are a plan, listed before the signature they
 * lead to. With `--offline`, nothing is read and the Pot is not checked.
 */
import { bytesToHex, getAddress, type Address, type Hex, type PublicClient } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

import { v12EngineAddress } from "../deployments/v12-addresses.js";
import { v12PredictPot } from "../deployments/pot.js";
import { buildSauceEvmCall } from "../routes/sauce-calls.js";
import { compileSauceProgram } from "../routes/sauce-route.js";
import { encodeExecute, executeTypedData, signedSalt } from "../routes/signed.js";
import { approveAll, gasEstimate, type Approver, type SetupStep } from "./approvals.js";
import { CliError, UsageError } from "./args.js";
import { connect, kitchenFee, potState, sendAndWait, type TxRequest } from "./chain.js";
import {
  castSend,
  compileProgram,
  payloadOf,
  potDeployStep,
  type CliFiles,
  type CommandOutput,
  type CookInput,
} from "./commands.js";
import { handlersInPlace } from "./handlers.js";
import { intentDestinations, requireSupported } from "./support.js";

export interface SignInput extends CookInput {
  /** The last unix time the program may run. */
  readonly deadline: bigint;
  /** The salt it is signed under, 32 bytes; a fresh one when left out. */
  readonly signedSalt?: Hex;
  /** An endpoint for the chain: the Pot is read, and what it lacks set up first. */
  readonly rpcUrl?: string;
  /** Who approves the setup a signer sends: the terminal, or `--yes`. */
  readonly approver?: Approver;
}

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

/** The owner cook that installs `@sauce/signed`'s handlers on the Pot it runs on. */
export const SIGNED_SETUP_SOURCE = `import { Signed } from "@sauce/signed";

Signed.setup();
`;

/**
 * What the Pot lacks to run a signed program, as steps sent before the signature (`approvals.ts`):
 * its deployment, when it has no code and its owner is known, and the owner's cook of
 * `Signed.setup()` when the Router's records do not name the handlers. Empty when it is set up.
 */
export async function signedSetupSteps(input: {
  readonly chain: SignInput["chain"];
  readonly target: SignInput["target"];
  readonly pot: Address;
  readonly client: PublicClient;
  readonly rpcUrl: string;
  readonly account?: PrivateKeyAccount;
}): Promise<{ readonly steps: SetupStep[]; readonly owner?: Address }> {
  const { chain, target, pot, client } = input;
  const state = await potState(client, pot);
  const setup = compileSauceProgram(chain, SIGNED_SETUP_SOURCE);
  if (state.deployed && (await handlersInPlace(client, pot, setup.handlers))) {
    return { steps: [], ...(state.owner === undefined ? {} : { owner: state.owner }) };
  }
  const steps: SetupStep[] = [];
  if (!state.deployed) {
    if (!("owner" in target)) {
      throw new CliError(
        `Pot ${pot} has no code: name it by --owner (and --salt), so the command can deploy it first`,
      );
    }
    steps.push(
      await potDeployStep({
        chain,
        target,
        pot,
        client,
        rpcUrl: input.rpcUrl,
        ...(input.account === undefined ? {} : { account: input.account }),
      }),
    );
  }
  const engine = getAddress(v12EngineAddress());
  const fee = await kitchenFee(client, chain);
  const tx: TxRequest = {
    to: pot,
    data: buildSauceEvmCall({ pot, engine, program: bytesToHex(setup.bytecode) }).data,
    value: fee,
  };
  const estimate =
    !state.deployed || input.account === undefined
      ? "its gas"
      : await gasEstimate(client, input.account.address, tx, chain);
  const selectors = setup.handlers.map((handler) => `0x${handler.selector.toString(16)}`);
  steps.push({
    action: `set up Pot ${pot} for signed programs`,
    reason: `Pot ${pot} on ${chain.slug} can't run signed programs yet`,
    offer: "Install the signed-program handlers now",
    estimate,
    byHand: `set it up yourself with sauce run @sauce/signed --chain ${chain.slug}`,
    planned: {
      what: `Pot.cook(engine, Signed.setup()): installs @sauce/signed's handlers (${selectors.join(", ")})`,
      installsHandlers: selectors,
      to: tx.to,
      data: tx.data,
      value: fee.toString(),
    },
    send: async () => {
      if (input.account === undefined) {
        throw new Error("internal: a planned setup has no signer to send it");
      }
      const sent = await sendAndWait(client, input.rpcUrl, input.account, tx);
      if (sent.status !== "success") {
        throw new CliError(
          `setting the Pot up ${sent.hash}: ${sent.status}` +
            (sent.reason === undefined ? "" : `, reverted: ${sent.reason}`) +
            "; it can't run signed programs yet",
        );
      }

      return sent;
    },
  });

  return { steps, ...(state.owner === undefined ? {} : { owner: state.owner }) };
}

/** `sauce sign`'s result: the typed data, and with `signer` the signature and the call. */
export async function signCommand(
  input: SignInput,
  files: CliFiles,
  signer?: PrivateKeyAccount,
): Promise<CommandOutput> {
  if (input.chain.kind !== "evm") {
    throw new UsageError(
      `a signed program runs on a Private Pot's Router, an EVM contract: ${input.chain.slug} has none`,
    );
  }
  const salt = input.signedSalt ?? signedSalt();
  if (!BYTES32.test(salt)) {
    throw new UsageError(`--signed-salt is 32 bytes as hex, not ${salt}`);
  }
  const target = input.target;
  const pot = "pot" in target ? target.pot : (v12PredictPot(target.owner, target.salt) as Address);
  const named = "owner" in target ? getAddress(target.owner) : undefined;
  if (signer !== undefined && named !== undefined && getAddress(signer.address) !== named) {
    throw new UsageError(
      `${signer.address} does not own the Pot: only its owner, ${named}, signs what it runs`,
    );
  }
  const compiled = compileProgram(input, files);
  requireSupported("signing a program for a Pot", [
    input.chain,
    ...intentDestinations(compiled.bodies),
  ]);
  const program = payloadOf(compiled, input.args);

  // The Pot, read where the command reaches the chain: what it lacks is set up first.
  const setup =
    input.rpcUrl === undefined
      ? undefined
      : await signedSetupSteps({
          chain: input.chain,
          target,
          pot,
          client: await connect(input.rpcUrl, input.chain),
          rpcUrl: input.rpcUrl,
          ...(signer === undefined ? {} : { account: signer }),
        });
  const owner = named ?? setup?.owner;
  if (signer !== undefined && owner !== undefined && getAddress(signer.address) !== owner) {
    throw new UsageError(
      `${signer.address} does not own the Pot: only its owner, ${owner}, signs what it runs`,
    );
  }
  const steps = setup?.steps ?? [];
  const sent: { readonly what: string; readonly hash: Hex }[] = [];
  if (signer !== undefined && steps.length > 0) {
    if (input.approver === undefined) throw new Error("internal: a signed setup has no approver");
    await approveAll(input.approver, steps, "sign");
    for (const step of steps)
      sent.push({ what: step.planned.what, hash: (await step.send()).hash });
  }

  const execution = {
    pot,
    chainId: input.chain.id,
    program,
    salt: salt.toLowerCase() as Hex,
    deadline: input.deadline,
  };
  const typedData = executeTypedData(execution);
  const signature = signer === undefined ? undefined : await signer.signTypedData(typedData);
  const data = signature === undefined ? undefined : encodeExecute({ ...execution, signature });
  const json = {
    chainId: input.chain.id,
    pot,
    program,
    salt: execution.salt,
    deadline: input.deadline.toString(),
    // What the Pot needs first, unsent: deploying it, setting it up. Signed, they are `setupSent`.
    ...(signer === undefined && steps.length > 0
      ? { setup: steps.map((step) => step.planned) }
      : {}),
    ...(sent.length > 0 ? { setupSent: sent } : {}),
    // As eth_signTypedData_v4 takes it, the domain's type spelled out.
    typedData: {
      ...typedData,
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        ...typedData.types,
      },
      domain: { ...typedData.domain, chainId: input.chain.id },
      message: { ...typedData.message, deadline: input.deadline.toString() },
    },
    ...(signature === undefined
      ? {}
      : { signature, execute: { chainId: input.chain.id, to: pot, data, value: "0" } }),
  };
  const notes = [
    `Pot ${pot}${owner === undefined ? "" : `, owned by ${owner}`}: it runs the program once the ` +
      `Pot's owner has signed it, for anyone who sends the execute call, until ${input.deadline} ` +
      `(unix seconds), under salt ${execution.salt}, once.`,
    setup === undefined
      ? "The Pot was not read (no endpoint): it runs signed programs once it is set up, by any " +
        `owner cook with Signed or sauce run @sauce/signed --chain ${input.chain.slug}.`
      : steps.length === 0
        ? "The Pot is set up to run signed programs."
        : signer === undefined
          ? `The Pot is not set up yet: send \`setup\` first, from its owner, in order.`
          : `The Pot is set up now (${sent.length} transaction${sent.length === 1 ? "" : "s"}).`,
    "The Pot pays the Kitchen's fee for each execute from its balance: keep the native coin in it.",
    signature === undefined
      ? "No signer was given: sign `typedData` with the Pot's owner (eth_signTypedData_v4), " +
        "or run again with --wallet, --keystore or --private-key."
      : "Send `execute` from any account; the program checks what it needs, since anyone may " +
        "send it as soon as it is signed.",
  ];

  return {
    text: JSON.stringify(json, null, 2),
    json,
    ...(data === undefined ? {} : { cast: castSend(pot, data, 0n) }),
    notes,
  };
}

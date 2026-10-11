/**
 * Succinct's SP1 template ported (`skills/sauce-zk/examples/fibonacci.sauce.ts`) EXECUTED: a program
 * checks a real SP1 proof through Succinct's verifier gateway, in the same transaction, and returns
 * the public values the proof shows its program committed — on an anvil at each chain's id running
 * the gated engine and Kitchen. A proof that arrives with the call needs no handler and no promise,
 * so the Pot is cooked as any program is, on the released Router.
 *
 * Nothing is mocked. The Groth16 gateway and two of its verifiers are their chains' runtimes at
 * their addresses, the gateway's owner and its route words as the chain holds them
 * (`fixtures/Succinct.json`, each runtime held to the chain's keccak256), and the proof is the
 * template's own fixture: a real Groth16 proof that its Fibonacci program computed fib(20).
 *
 * That proof is for SP1 v6.0.0, whose route Succinct has frozen on both chains (on Base at block
 * 52,444,424), so through the gateway as the chain holds it the proof is refused, as it is live.
 * With that one route as it stood before the freeze, its frozen flag cleared and nothing else
 * changed, v6.0.0's verifier checks the proof and the program returns (20, 6765, 10946). The same
 * proof labelled for the live v6.1.0 route reaches v6.1.0's verifier, which refuses it.
 */
import {
  concat,
  encodeErrorResult,
  encodeFunctionData,
  keccak256,
  parseAbi,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SP1VerifierGatewayABI } from "../../../src/protocols/succinct/abis.js";
import { describeOnEngine, FEE, OWNER, startZkChain, type ZkChain } from "./harness.js";

/** A test compiles programs and replays calls on anvil: seconds each, more with other suites. */
const TEST_TIMEOUT = 60_000;

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
interface Code {
  readonly address: Address;
  readonly codeHash: Hex;
  readonly runtime: Hex;
}
const SUCCINCT = JSON.parse(readFileSync(join(FIXTURES, "Succinct.json"), "utf8")) as {
  chains: Record<
    string,
    {
      block: number;
      gateway: Code & { owner: Hex; routes: Record<Hex, { slot: Hex; value: Hex }> };
      verifiers: Record<string, Code & { selector: Hex }>;
    }
  >;
  template: { vkey: Hex; publicValues: Hex; proof: Hex; n: number; a: number; b: number };
};
const TEMPLATE = SUCCINCT.template;

/** The skill's port of the template's Fibonacci contract. */
const FIBONACCI = readFileSync(
  join(FIXTURES, "../../../../../skills/sauce-zk/examples/fibonacci.sauce.ts"),
  "utf8",
);

const potAbi = parseAbi(["function cook(address engine, bytes program) payable returns (bytes)"]);
/** The errors a v6 SP1VerifierGroth16 and its Groth16 verifier revert with. */
const verifierAbi = parseAbi([
  "error InvalidVkRoot()",
  "error ProofInvalid()",
  "error WrongVerifierSelector(bytes4 received, bytes4 expected)",
]);

const V6_0_0 = "0x0e78f4db";
const V6_1_0 = "0x4388a21c";

describeOnEngine.each([
  { slug: "ethereum", chainId: 1 },
  { slug: "base", chainId: 8453 },
])("Succinct's SP1 template ported, on $slug", ({ slug, chainId }) => {
  const fixture = SUCCINCT.chains[String(chainId)]!;
  const gateway = fixture.gateway.address;
  const frozenRoute = fixture.gateway.routes[V6_0_0]!;

  let chain: ZkChain;

  const cookData = (publicValues: Hex, proof: Hex): Hex =>
    encodeFunctionData({
      abi: potAbi,
      functionName: "cook",
      args: [chain.stack.engine, chain.compiled(FIBONACCI, [publicValues, proof])],
    });

  /** What the cook returns, as `main` returns it, unframed: its record's three words. */
  const returned = async (publicValues: Hex, proof: Hex): Promise<bigint[]> => {
    const { data } = await chain.publicClient.call({
      account: OWNER.address,
      to: chain.stack.pot,
      data: cookData(publicValues, proof),
      value: FEE,
    });
    expect((data!.length - 2) / 2).toBe(96);

    return [0, 1, 2].map((i) => BigInt(`0x${data!.slice(2 + 64 * i, 2 + 64 * (i + 1))}`));
  };

  const refusal = (publicValues: Hex, proof: Hex) =>
    chain.revertOf(OWNER.address, chain.stack.pot, cookData(publicValues, proof), FEE);

  /** The v6.0.0 route with its frozen flag cleared, or as the chain holds it. */
  const thawed = (): Hex => `0x${"00".repeat(12)}${frozenRoute.value.slice(26)}`;
  const setRoute = (value: Hex) =>
    chain.testClient.setStorageAt({ address: gateway, index: frozenRoute.slot, value });

  beforeAll(async () => {
    chain = await startZkChain(slug, chainId, { releasedRouter: true });
    const { testClient, publicClient } = chain;
    for (const code of [fixture.gateway, ...Object.values(fixture.verifiers)]) {
      await testClient.setCode({ address: code.address, bytecode: code.runtime });
      expect(keccak256((await publicClient.getCode({ address: code.address }))!)).toBe(
        code.codeHash,
      );
    }
    await testClient.setStorageAt({
      address: gateway,
      index: `0x${"00".repeat(32)}`,
      value: fixture.gateway.owner,
    });
    for (const route of Object.values(fixture.gateway.routes)) {
      await testClient.setStorageAt({ address: gateway, index: route.slot, value: route.value });
    }
    // The routes as the chain holds them: v6.0.0's frozen, v6.1.0's live.
    for (const [selector, version, frozen] of [
      [V6_0_0, "v6.0.0", true],
      [V6_1_0, "v6.1.0", false],
    ] as const) {
      expect(
        await publicClient.readContract({
          address: gateway,
          abi: SP1VerifierGatewayABI,
          functionName: "routes",
          args: [selector],
        }),
      ).toEqual([fixture.verifiers[version]!.address, frozen]);
    }
  }, 180_000);

  afterAll(async () => {
    await chain?.stop();
  });

  it(
    "refuses the template's proof through the gateway as the chain holds it: its version's route is frozen",
    async () => {
      expect(TEMPLATE.proof.slice(0, 10)).toBe(V6_0_0);
      expect(await refusal(TEMPLATE.publicValues, TEMPLATE.proof)).toBe(
        encodeErrorResult({
          abi: SP1VerifierGatewayABI,
          errorName: "RouteIsFrozen",
          args: [V6_0_0],
        }),
      );
    },
    TEST_TIMEOUT,
  );

  it(
    "with that route as it stood before the freeze, verifies the template's proof and returns fib(20)",
    async () => {
      await setRoute(thawed());
      try {
        expect(await returned(TEMPLATE.publicValues, TEMPLATE.proof)).toEqual([
          BigInt(TEMPLATE.n),
          BigInt(TEMPLATE.a),
          BigInt(TEMPLATE.b),
        ]);
        // Cooked: one transaction, the proof checked inside it.
        const sent = await chain.cook(
          chain.compiled(FIBONACCI, [TEMPLATE.publicValues, TEMPLATE.proof]),
        );
        expect(sent.ok).toBe(true);
        const verifyProof = toFunctionSelector("verifyProof(bytes32,bytes,bytes)");
        const gas = await chain.callGas(sent.hash, gateway, verifyProof);
        console.log(`${slug}: the gateway verified the proof with ${gas} gas`);
      } finally {
        await setRoute(frozenRoute.value);
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "refuses a tampered proof and public values the proof does not show",
    async () => {
      await setRoute(thawed());
      try {
        const invalid = encodeErrorResult({ abi: verifierAbi, errorName: "ProofInvalid" });
        // The proof's last word changed.
        const tampered =
          `${TEMPLATE.proof.slice(0, -2)}${TEMPLATE.proof.slice(-2) === "00" ? "01" : "00"}` as Hex;
        expect(await refusal(TEMPLATE.publicValues, tampered)).toBe(invalid);
        // fib(21) claimed with fib(20)'s proof.
        const claimed = concat([
          `0x${(21).toString(16).padStart(64, "0")}`,
          `0x${TEMPLATE.publicValues.slice(66)}`,
        ]);
        expect(await refusal(claimed, TEMPLATE.proof)).toBe(invalid);
      } finally {
        await setRoute(frozenRoute.value);
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "takes the same proof labelled for the live v6.1.0 route to v6.1.0's verifier, which refuses it",
    async () => {
      const relabelled = concat([V6_1_0, `0x${TEMPLATE.proof.slice(10)}`]);
      expect(await refusal(TEMPLATE.publicValues, relabelled)).toBe(
        encodeErrorResult({ abi: verifierAbi, errorName: "InvalidVkRoot" }),
      );
    },
    TEST_TIMEOUT,
  );
});

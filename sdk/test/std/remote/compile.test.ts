/**
 * `@sauce/remote` (sdk/src/std/remote), compiled through the SDK as a program for a chain uses it:
 * what the library spells out by hand, which bridge a message takes, what each chain's module
 * gives it, and what it refuses. Execution, over each bridge's own contracts, is
 * `evm.e2e.test.ts`'s.
 *
 * The library writes its sends raw, so each selector it carries, the LayerZero options header, the
 * Polymer topic and its storage namespace are derived here from their definitions, and each send is
 * found in the bytecode of the program that makes it. Its reads are typed calls through the ABI
 * fragments beside it, held here to the registry's evidenced ABIs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { encodeAbiParameters, keccak256, toFunctionSelector, toHex, type AbiFunction } from "viem";

import { requireChain } from "../../../src/chains/canonical.js";
import { CrossL2ProverV2ABI } from "../../../src/protocols/polymer/abis.js";
import { HyperlaneMailboxABI } from "../../../src/protocols/hyperlane/abis.js";
import { LayerZeroEndpointV2ABI } from "../../../src/protocols/layerzero/abis.js";
import { MetalayerRouterABI } from "../../../src/protocols/metalayer/abis.js";
import { packageHandlerDeclarations, packageHandlers } from "../../../src/routes/handlers.js";
import { remoteLink } from "../../../src/routes/remote-link.js";
import { registryTokenAddress } from "../../../src/routes/token-registry.js";
import { compileSauceProgram } from "../../../src/routes/sauce-route.js";

/** jest's cwd is `sdk/`. */
const DIR = join(process.cwd(), "src", "std", "remote");
const SOURCE = readFileSync(join(DIR, "remote.evm.js"), "utf8");

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const compile = (source: string, chain = "ethereum") => compileSauceProgram(chain, source);
const ONE_WAY = (options = "") => `function main(value: Uint256) {
  Base.remote(() => {
    evm.sstore(1, value);
  }${options});
}`;

describe("what the library writes out by hand", () => {
  it.each([
    ["dispatch(uint32,bytes32,bytes,bytes)", "hyperlane"],
    ["send((uint32,bytes32,bytes,bytes,bool),address)", "layerzero"],
    ["dispatch(uint32,bytes32,(uint32,address,bytes)[],bytes,uint8,uint256)", "metalayer"],
  ])(
    "%s's selector is derived from its signature, and in a message sent over %s",
    (signature, via) => {
      const selector = toFunctionSelector(signature).slice(2);
      expect(SOURCE).toContain(`hex\`${selector}\``);
      expect(hex(compile(ONE_WAY(`, { via: "${via}" }`)).bytecode)).toContain(selector);
    },
  );

  it("its LayerZero options are type 3 with one executor option, lzReceive, and its gas", () => {
    // uint16 type 3 | uint8 worker 1 (executor) | uint16 length 17 | uint8 option 1 (lzReceive),
    // then the gas, 16 bytes, as LayerZero's OptionsBuilder and eco-routes' prover write them.
    expect(SOURCE).toContain("hex`000301001101`.concat(gas.toBytesBe(16))");
  });

  it("its Polymer topic is the RemoteMessage event's, and in the log a message is sent by", () => {
    const topic = keccak256(toHex("RemoteMessage(uint256,bytes)"));
    expect(SOURCE).toContain(`const SAUCE_REMOTE_TOPIC = ${topic};`);
    expect(hex(compile(ONE_WAY(`, { via: "polymer" }`)).bytecode)).toContain(topic.slice(2));
  });

  it("its namespace is ERC-7201's location for sauce.storage.Remote", () => {
    const inner = BigInt(keccak256(toHex("sauce.storage.Remote"))) - 1n;
    const location =
      BigInt(keccak256(encodeAbiParameters([{ type: "uint256" }], [inner]))) & ~0xffn;
    expect(SOURCE).toContain(
      `const SAUCE_REMOTE_NAMESPACE = 0x${location.toString(16).padStart(64, "0")};`,
    );
  });

  it.each([
    ["hyperlane-mailbox.abi.json", HyperlaneMailboxABI],
    ["layerzero-endpoint.abi.json", LayerZeroEndpointV2ABI],
    ["metalayer-router.abi.json", MetalayerRouterABI],
    ["polymer-prover.abi.json", CrossL2ProverV2ABI],
  ] as const)("%s is the registry's ABI, function for function", (file, registry) => {
    const ours = (
      JSON.parse(readFileSync(join(DIR, file), "utf8")) as { abi: readonly AbiFunction[] }
    ).abi;
    expect(ours.length).toBeGreaterThan(0);
    for (const fragment of ours) {
      const theirs = (registry as readonly AbiFunction[]).find(
        (entry) => toFunctionSelector(entry) === toFunctionSelector(fragment),
      );
      expect(theirs).toEqual(fragment);
    }
  });
});

describe("the handlers", () => {
  it("answer each bridge's callback, by its signature, each named by its protocol", () => {
    expect(packageHandlerDeclarations("@sauce/remote")).toEqual([
      expect.objectContaining({
        selector: "handle(uint32,bytes32,bytes)",
        program: "hyperlane.handler.js",
      }),
      expect.objectContaining({
        selector: "handle(uint32,bytes32,bytes,(uint32,address,bytes)[],bytes[])",
        program: "metalayer.handler.js",
      }),
      expect.objectContaining({
        selector: "lzReceive((uint32,bytes32,uint64),bytes32,bytes,address,bytes)",
        program: "layerzero.handler.js",
      }),
      expect.objectContaining({
        selector: "allowInitializePath((uint32,bytes32,uint64))",
        program: "layerzero-path.handler.js",
        readOnly: true,
      }),
      expect.objectContaining({
        selector: "nextNonce(uint32,bytes32)",
        program: "layerzero-nonce.handler.js",
        readOnly: true,
      }),
      expect.objectContaining({ selector: "deliver(bytes)", program: "polymer.handler.js" }),
    ]);
  });

  it.each(["ethereum", "base"])(
    "compile for %s, each with its bridge's contract there",
    (chain) => {
      const handlers = packageHandlers(chain, "@sauce/remote");
      const link = remoteLink(requireChain(chain));
      const contract = {
        "hyperlane.handler.js": link.hyperlane!.mailbox,
        "metalayer.handler.js": link.metalayer!.router,
        "layerzero.handler.js": link.layerzero!.endpoint,
        "polymer.handler.js": link.polymer!.prover,
      } as Record<string, string>;
      for (const handler of handlers) {
        expect(handler.bytecode.length).toBeGreaterThan(0);
        const address = contract[handler.program];
        if (address !== undefined) {
          expect(hex(handler.bytecode)).toContain(address.slice(2).toLowerCase());
        }
      }
    },
  );
});

describe("which bridge a message takes", () => {
  it("the first both chains have, Hyperlane before LayerZero, Metalayer and Polymer", () => {
    // Ethereum and Base have all four.
    expect(hex(compile(ONE_WAY()).bytecode)).toContain(
      toFunctionSelector("dispatch(uint32,bytes32,bytes,bytes)").slice(2),
    );
    // Unichain has only Polymer: a log, and no call.
    const toUnichain = compile(`function main(value: Uint256) {
  Unichain.remote(() => {
    evm.sstore(1, value);
  });
}`);
    expect(hex(toUnichain.bytecode)).toContain(
      keccak256(toHex("RemoteMessage(uint256,bytes)")).slice(2),
    );
  });

  it("each addresses the destination by its bridge's id for it", () => {
    const base = remoteLink(requireChain("base"));
    const word = (value: number) => value.toString(16).padStart(4, "0");
    expect(hex(compile(ONE_WAY(`, { via: "layerzero" }`)).bytecode)).toContain(
      word(base.layerzero!.eid),
    );
  });

  it("refuses a bridge one of the chains lacks, naming it", () => {
    expect(() =>
      compile(`function main(value: Uint256) {
  Optimism.remote(() => {
    evm.sstore(1, value);
  }, { via: "metalayer" });
}`),
    ).toThrow("`via: metalayer` needs metalayer on both chains, and optimism has none");
  });

  it("refuses an option it does not take, and a chain it cannot reach", () => {
    expect(() => compile(ONE_WAY(`, { bridge: "hyperlane" }`))).toThrow(
      "`remote` takes no `bridge`: its options are via, gas and replyGas",
    );
    expect(() =>
      compile(`function main() {
  Ethereum.remote(() => {
    evm.sstore(1, 1);
  });
}`),
    ).toThrow("a remote message runs on another chain");
    expect(() =>
      compile(`function main() {
  Solana.remote(() => {
    evm.sstore(1, 1);
  });
}`),
    ).toThrow("a remote message runs between EVM chains");
  });
});

describe("what runs where", () => {
  it("a one-way message is the body, compiled for the destination, and opens no intent", () => {
    const program = compile(ONE_WAY());
    expect(program.bodies).toEqual([]);
    expect(program.continuations.map((body) => body.destination.slug)).toEqual(["base"]);
    expect(program.continuations[0]!.captures).toEqual(["value"]);
  });

  it("a round trip is a continuation for here, and a program for there that runs the body", () => {
    const program = compile(`function main(bump: Uint256) {
  Base.remote(() => {
    return USDC.balanceOf(self);
  }).then((result) => {
    const [balance] = abi.decode(result, ["Uint256"]);
    evm.sstore(1, balance + bump);
  });
}`);
    const bySlug = program.continuations.map(
      (body) => `${body.destination.slug}:${body.path.length}`,
    );
    // The continuation, for Ethereum; the program sent to Base; the frame it runs the body in,
    // caught; the body.
    expect(bySlug.sort()).toEqual(["base:0", "base:1", "base:2", "ethereum:0"]);
    // The body reads Base's USDC.
    const body = program.continuations.find((each) => each.path.length === 2)!;
    const usdc = remoteBodyToken("base", "USDC");
    expect(hex(body.bytecode)).toContain(usdc);
  });

  it("a combinator's children are round trips, answered into the combinator here", () => {
    const program = compile(`import { Promise } from "@sauce/async";

function main(bump: Uint256) {
  Promise.all([
    Base.remote(() => {
      return 1;
    }),
    Optimism.remote(() => {
      return 2;
    }),
  ]).then((r) => {
    evm.sstore(1, r[0].length + r[1].length + bump);
  });
}`);
    const top = program.continuations
      .filter((body) => body.path.length === 0)
      .map((body) => body.destination.slug)
      .sort();
    // The combinator's continuation and each child's, here; the program each message runs there.
    expect(top).toEqual(["base", "ethereum", "ethereum", "ethereum", "optimism"]);
  });

  it("a deadline bounds an answer, so a one-way message refuses one", () => {
    expect(() =>
      compile(`function main() {
  Base.remote(() => {
    evm.sstore(1, 1);
  }).within(60);
}`),
    ).toThrow("`.within(...)` bounds the answer");
  });

  it("refuses a step out of order", () => {
    expect(() =>
      compile(`function main() {
  Base.remote(() => {
    evm.sstore(1, 1);
  }).catch((e) => {}).then((r) => {});
}`),
    ).toThrow("`.then(...)` follows `remote(...)` once, and before `.catch(...)`");
  });
});

/** The registry's address of `symbol` on `chain`, as 20 bytes of hex. */
function remoteBodyToken(chain: string, symbol: string): string {
  const address = registryTokenAddress(requireChain(chain), symbol);
  if (address === undefined) throw new Error(`no ${symbol} on ${chain}`);

  return address.toString(16).padStart(40, "0");
}

describe("the bridges' own examples, ported", () => {
  const REPOSITORY = join(process.cwd(), "..");
  const PORTS = ["hello-world", "my-oapp", "block-height", "state-sync"];
  const file = (name: string): string =>
    readFileSync(
      join(REPOSITORY, "skills", "sauce-remote", "examples", `${name}.sauce.ts`),
      "utf8",
    );
  /** The program a file holds, its header comment left out. */
  const program = (text: string): string => text.replace(/^(\/\/.*\n)+/, "").trimEnd();
  /** Its code lines: neither blank nor only a comment. */
  const codeLines = (text: string): number =>
    text.split("\n").filter((line) => line.replace(/\/\/.*/, "").trim() !== "").length;
  /** The Sauce column of each row of the ports' table under `heading` in `page`, in order. */
  const sauceColumn = (page: string, heading: string): number[] => {
    const lines = page.slice(page.indexOf(heading)).split("\n");
    const cells = (line: string): string[] => line.split("|").map((cell) => cell.trim());
    const column = cells(lines.find((line) => line.startsWith("| Bridge"))!).indexOf("Sauce");

    return lines
      .filter((line) => /^\| (Hyperlane|LayerZero|Metalayer|Polymer) /.test(line))
      .slice(0, PORTS.length)
      .map((line) => Number(cells(line)[column]));
  };

  it("each states its own size, which the skill's table and the manual's give", () => {
    const sizes = PORTS.map((name) => codeLines(file(name)));
    for (const [i, name] of PORTS.entries()) {
      // The header, its lines joined as it reads.
      expect(file(name).replace(/\n\/\/ /g, " ")).toContain(
        `This program is ${sizes[i]} and deploys nothing`,
      );
    }
    const skill = readFileSync(join(REPOSITORY, "skills", "sauce-remote", "SKILL.md"), "utf8");
    expect(sauceColumn(skill, "## The bridges' own examples, in Sauce")).toEqual(sizes);
    const guide = readFileSync(join(REPOSITORY, "docs", "guides", "async.md"), "utf8");
    expect(sauceColumn(guide, "### The bridges' own examples, in Sauce")).toEqual(sizes);
  });

  it("the manual carries each program as the skill's file has it", () => {
    const guide = readFileSync(join(REPOSITORY, "docs", "guides", "async.md"), "utf8");
    const section = guide.slice(guide.indexOf("### The bridges' own examples, in Sauce"));
    const blocks = [...section.matchAll(/```js\n([\s\S]*?)\n```/g)].map((match) => match[1]);
    expect(blocks).toEqual(PORTS.map((name) => program(file(name))));
  });
});

describe("the receivers a round trip installs for its answer", () => {
  const RECEIVERS: Record<string, string[]> = {
    hyperlane: ["handle(uint32,bytes32,bytes)"],
    metalayer: ["handle(uint32,bytes32,bytes,(uint32,address,bytes)[],bytes[])"],
    layerzero: [
      "lzReceive((uint32,bytes32,uint64),bytes32,bytes,address,bytes)",
      "allowInitializePath((uint32,bytes32,uint64))",
      "nextNonce(uint32,bytes32)",
    ],
    polymer: ["deliver(bytes)"],
  };

  it.each(Object.keys(RECEIVERS))(
    "over %s: that bridge's receivers only, each the package's handler file byte for byte",
    (via) => {
      const program = compile(`function main(bump: Uint256) {
  Base.remote(() => {
    return 1;
  }, { via: "${via}" }).then((result) => {
    evm.sstore(1, result.length + bump);
  });
}`);
      const files = new Map(
        packageHandlers("ethereum", "@sauce/remote").map((file) => [BigInt(file.selector), file]),
      );
      expect(program.handlers.map((handler) => files.get(handler.selector)?.signature)).toEqual(
        RECEIVERS[via],
      );
      for (const handler of program.handlers) {
        const file = files.get(handler.selector)!;
        expect(handler.destination.slug).toBe("ethereum");
        expect(handler.readOnly).toBe(file.readOnly);
        expect(hex(handler.bytecode)).toBe(hex(file.bytecode));
      }
    },
  );

  it("a one-way message installs none: nothing comes back", () => {
    expect(compile(ONE_WAY()).handlers).toEqual([]);
  });
});

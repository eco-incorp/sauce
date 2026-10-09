/**
 * `@sauce/random` (sdk/src/std/random), compiled through the SDK as a program for a chain imports
 * it: what compiles, what the library spells out by hand, and what it refuses.
 *
 * The library writes its two requests raw (a bound call sends no value) and VRF's native-payment
 * `extraArgs` by hand, so each is derived here from its definition, held to the registry's ABI —
 * itself held to the deployed contracts by `registry-abi.test.ts` — and found in the source and the
 * emitted bytecode. Execution — a request, the provider's callback through the Router's fallback,
 * the body run in the handler's cook — is `evm.e2e.test.ts`'s.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { concat, keccak256, toFunctionSelector, toFunctionSignature, toHex } from "viem";

import { requireChain } from "../../../src/chains/canonical.js";
import { sdkPackageFile } from "../../../src/embedded/resolve.js";
import { EntropyABI } from "../../../src/protocols/pyth-entropy/abis.js";
import { VRFV2PlusWrapperABI } from "../../../src/protocols/chainlink-vrf/abis.js";
import { contractAddressOn } from "../../../src/routes/chain-module.js";
import { packageHandlerDeclarations, packageHandlers } from "../../../src/routes/handlers.js";
import { compileSauceProgram } from "../../../src/routes/sauce-route.js";

/** jest's cwd is `sdk/`. */
const SOURCE = readFileSync(join(process.cwd(), "src", "std", "random", "random.evm.js"), "utf8");

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const compile = (source: string, chain = "base") => compileSauceProgram(chain, source);
const declared = (abi: readonly { type: string }[]): string[] =>
  abi.filter((item) => item.type === "function").map((item) => toFunctionSignature(item as never));

const VRF = `import { Random } from "@sauce/random";

function main(bump: Uint256): void {
  Random.vrf({ words: 2 }).then((words) => {
    evm.sstore(1, words[0] + words[1] + bump);
  });
}`;

const ENTROPY = `import { Random } from "@sauce/random";

function main(bump: Uint256): void {
  Random.entropy().then((value) => {
    evm.sstore(1, value + bump);
  });
}`;

describe("what the library writes out by hand", () => {
  it.each([
    ["requestRandomWordsInNative(uint32,uint16,uint32,bytes)", VRFV2PlusWrapperABI, VRF],
    ["requestV2(address,uint32)", EntropyABI, ENTROPY],
  ] as const)(
    "%s's selector is derived from its signature, the registry's ABI declares it, and the request carries it",
    (signature, abi, program) => {
      const selector = toFunctionSelector(signature).slice(2);
      expect(declared(abi)).toContain(signature);
      expect(SOURCE).toContain(`\`${signature}\` (0x${selector})`);
      expect(SOURCE).toContain(`hex\`${selector}\``);
      expect(hex(compile(program).bytecode)).toContain(selector);
    },
  );

  it("VRF's extraArgs are ExtraArgsV1's tag and nativePayment = true", () => {
    const extraArgs = concat([
      keccak256(toHex("VRF ExtraArgsV1")).slice(0, 10) as `0x${string}`,
      toHex(1n, { size: 32 }),
    ]).slice(2);
    expect(SOURCE).toContain(`hex\`${extraArgs}\``);
    expect(hex(compile(VRF).bytecode)).toContain(extraArgs);
  });

  it("the event the handlers log is keccak256 of RandomDelivered(bytes32,bytes), in each handler", () => {
    const topic = keccak256(toHex("RandomDelivered(bytes32,bytes)")).slice(2);
    expect(SOURCE).toContain(`const SAUCE_RANDOM_DELIVERED = 0x${topic};`);
    for (const handler of packageHandlers("base", "@sauce/random").slice(0, 2)) {
      expect(hex(handler.bytecode)).toContain(topic);
    }
  });

  it("the package answers each provider's callback, by its signature", () => {
    expect(packageHandlerDeclarations("@sauce/random")).toEqual([
      {
        selector: "rawFulfillRandomWords(uint256,uint256[])",
        program: "vrf.handler.js",
        requires: ["ChainlinkVrf.Wrapper"],
      },
      {
        selector: "_entropyCallback(uint64,address,bytes32)",
        program: "entropy.handler.js",
        requires: ["PythEntropy.Entropy"],
      },
    ]);
    for (const [signature, selector] of [
      ["rawFulfillRandomWords(uint256,uint256[])", "0x1fe543e3"],
      ["_entropyCallback(uint64,address,bytes32)", "0x52a5f1f8"],
    ]) {
      expect(toFunctionSelector(signature!)).toBe(selector);
      expect(SOURCE).toContain(signature!.split("(")[0]);
    }
  });

  it("each handler, compiled for Base, names Base's provider: the one caller it answers", () => {
    const base = requireChain("base");
    // The package's two, and the core's public `expire(bytes32)`, installed with every package.
    const handlers = packageHandlers("base", "@sauce/random");
    expect(handlers.map((h) => h.selector)).toEqual([
      "0x1fe543e3",
      "0x52a5f1f8",
      toFunctionSelector("expire(bytes32)"),
    ]);
    const wrapper = contractAddressOn(base, "ChainlinkVrf", "Wrapper")!;
    const entropy = contractAddressOn(base, "PythEntropy", "Entropy")!;
    expect(hex(handlers[0]!.bytecode)).toContain(wrapper.slice(2).toLowerCase());
    expect(hex(handlers[1]!.bytecode)).toContain(entropy.slice(2).toLowerCase());
    for (const handler of handlers.slice(0, 2)) {
      const source = sdkPackageFile("@sauce/random", handler.program)!;
      expect(compile(source).entryParams.map((p) => p.type)).toEqual([
        "Address",
        "Uint256",
        "bytes",
      ]);
    }
  });
});

describe("which handlers a chain installs", () => {
  const signatures = (chain: string) =>
    packageHandlers(chain, "@sauce/random").map((h) => h.signature);

  it("each provider's where the registry has it, and the core's expire everywhere", () => {
    expect(signatures("base")).toEqual([
      "rawFulfillRandomWords(uint256,uint256[])",
      "_entropyCallback(uint64,address,bytes32)",
      "expire(bytes32)",
    ]);
    expect(signatures("ethereum")).toEqual([
      "rawFulfillRandomWords(uint256,uint256[])",
      "expire(bytes32)",
    ]);
    expect(signatures("arbitrum")).toEqual(["expire(bytes32)"]);
  });
});

describe("what compiles", () => {
  it("a request's body is a program of its own for this chain, reading what it captures", () => {
    for (const source of [VRF, ENTROPY]) {
      const program = compile(source);
      expect(program.bodies).toHaveLength(1);
      expect(program.bodies[0]!.destination.slug).toBe("base");
      expect(program.bodies[0]!.captures).toEqual(["body.bump"]);
    }
  });

  it("VRF on Ethereum and Base, each naming its own wrapper", () => {
    for (const chain of ["ethereum", "base"]) {
      const wrapper = contractAddressOn(requireChain(chain), "ChainlinkVrf", "Wrapper")!;
      expect(hex(compile(VRF, chain).bytecode)).toContain(wrapper.slice(2).toLowerCase());
    }
  });

  it("every field, `.catch`, and a callback gas given", () => {
    const program = compile(`import { Random } from "@sauce/random";

function main(provider: Address, confirmations: Uint256, deadline: Uint256): void {
  Random.vrf({ words: 3, confirmations, gas: 300000, deadline })
    .then((words) => {
      evm.sstore(1, words[2]);
    })
    .catch((e) => {
      evm.sstore(2, 1);
    });
  Random.entropy({ provider, gas: 700000, deadline }).then((value) => {
    evm.sstore(3, value);
  });
}`);
    expect(program.bodies).toHaveLength(2);
    expect(hex(program.bytecode)).toContain((300000).toString(16).padStart(6, "0"));
    expect(hex(program.bytecode)).toContain((700000).toString(16).padStart(6, "0"));
  });
});

describe("as a promise", () => {
  it("a request raced against a timeout, joined with another, and given a deadline with `within`", () => {
    const program = compile(`import { Async, Promise } from "@sauce/async";
import { Random } from "@sauce/random";

function main(bump: Uint256): void {
  Promise.race([Random.vrf({ words: 1, gas: 500000 }), Async.timeout(3600)])
    .then((words) => {
      evm.sstore(1, words[0] + bump);
    })
    .catch((e) => {
      evm.sstore(2, e.length);
    });
  Promise.all([Random.vrf({ words: 2, gas: 500000 }), Random.entropy({ gas: 500000 })]).then((r) => {
    evm.sstore(3, r[0][1] + r[1]);
  });
  Random.entropy()
    .within(600)
    .then((value) => {
      evm.sstore(4, value);
    });
}`);
    expect(program.bodies.length).toBeGreaterThanOrEqual(3);
  });

  it("a request checks the Pot keeps the Kitchen's fee for its callback", () => {
    expect(SOURCE).toContain("const needed = price + kitchenFee();");
    expect(SOURCE).toContain("require(ctx.selfBalance() >= needed, message);");
    const kitchen = toFunctionSelector("kitchen()").slice(2);
    const fee = toFunctionSelector("executionFee()").slice(2);
    for (const source of [VRF, ENTROPY]) {
      expect(hex(compile(source).bytecode)).toContain(kitchen);
      expect(hex(compile(source).bytecode)).toContain(fee);
    }
  });
});

describe("what it refuses", () => {
  const refuses = (source: string, message: string, chain = "base"): void => {
    expect(() => compile(source, chain)).toThrow(message);
  };
  const program = (call: string): string => `import { Random } from "@sauce/random";

function main(): void {
  ${call}.then((result) => {
    evm.sstore(1, 1);
  });
}`;

  it("a provider the registry has no deployment of on the chain", () => {
    refuses(
      program("Random.entropy()"),
      "`Random.entropy` requests from Pyth Entropy, and the registry has no Entropy contract on the chain this program is compiled for",
      "ethereum",
    );
    refuses(
      program("Random.vrf()"),
      "`Random.vrf` requests through Chainlink VRF's VRFV2PlusWrapper, and the registry has none on the chain this program is compiled for",
      "arbitrum",
    );
  });

  it("a field it does not take, by its name", () => {
    refuses(
      program("Random.vrf({ word: 2 })"),
      "`Random.vrf` takes no `word`: `Random.vrf({ words, confirmations, gas, deadline })`",
    );
    refuses(
      program("Random.entropy({ words: 2 })"),
      "`Random.entropy` takes no `words`: `Random.entropy({ provider, gas, deadline })`",
    );
  });

  it("a request with no body", () => {
    refuses(
      `import { Random } from "@sauce/random";
function main(): void {
  Random.vrf();
}`,
      "a request has no body",
    );
  });

  it("an import on Solana, where no arm exists", () => {
    expect(() =>
      compile(
        `import { Random } from "@sauce/random";
function main() {}`,
        "solana",
      ),
    ).toThrow();
  });
});

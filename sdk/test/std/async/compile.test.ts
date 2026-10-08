/**
 * `@sauce/async` (sdk/src/std/async), compiled through the SDK as a program for a chain imports it:
 * what compiles, what the library spells out by hand, and what it refuses.
 *
 * The library writes its calls raw, so each selector it carries and its storage namespace are
 * derived here from their definitions and found in the emitted bytecode. Execution — a request, a
 * callback through the Router's fallback, the continuation run in the handler's cook — is
 * `evm.e2e.test.ts`'s.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { encodeAbiParameters, keccak256, toFunctionSelector, toHex } from "viem";

import { compileSauceProgram } from "../../../src/routes/sauce-route.js";

/** jest's cwd is `sdk/`. */
const SOURCE = readFileSync(join(process.cwd(), "src", "std", "async", "async.evm.js"), "utf8");

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const compile = (source: string, chain = "base") => compileSauceProgram(chain, source);

/** A protocol in the shape a package writes one: a request method on an object the program reads,
 *  returning a `Request` that parks its continuation under the id the request call returns. */
const ECHO = `import { Request } from "@sauce/async";

class EchoProtocol {
  request(value: Uint256) {
    return new Request({
      send: (continuation) => {
        const [id] = abi.decode(
          evm.call(0x000000000000000000000000000000000000ec40, 0, abi.encode(value)),
          ["Uint256"],
        );
        return id;
      },
      deliver: (input, body, fail) => {
        const [echoed] = abi.decode(input, ["Uint256"]);
        body(echoed);
      },
    });
  }
}
const Echo = new EchoProtocol();
`;

describe("what the library writes out by hand", () => {
  it("its namespace is ERC-7201's location for sauce.storage.Async", () => {
    const inner = BigInt(keccak256(toHex("sauce.storage.Async"))) - 1n;
    const location =
      BigInt(keccak256(encodeAbiParameters([{ type: "uint256" }], [inner]))) & ~0xffn;
    expect(SOURCE).toContain(
      `const SAUCE_ASYNC_NAMESPACE = 0x${location.toString(16).padStart(64, "0")};`,
    );
  });

  it("its transient slot for what a callback delivered is keccak256 of its name", () => {
    expect(SOURCE).toContain(
      `const SAUCE_ASYNC_RECEIVED = ${keccak256(toHex("sauce.async.received"))};`,
    );
  });

  it.each(["inFlightEngine()", "setHandler(bytes4,address,bytes,bool)"])(
    "%s's selector is derived from its signature, and in the bytecode of `install`",
    (signature) => {
      const selector = toFunctionSelector(signature).slice(2);
      expect(SOURCE).toContain(`hex\`${selector}\``);
      const program = compile(`import { install } from "@sauce/async";
function main(handler: bytes) {
  install(0x1fe543e3, handler, false);
}`);
      expect(hex(program.bytecode)).toContain(selector);
    },
  );
});

describe("what compiles", () => {
  it("every function, in a handler and in the program that installs it", () => {
    const handler = compile(`import { requireCaller, requireSelf, run, take } from "@sauce/async";

function main(caller: Address, value: Uint256, data: bytes): bytes {
  requireCaller(0x000000000000000000000000000000000000ec40, caller);
  const [id, sender, echoed] = abi.decode(data.slice(4, data.length), ["Uint256", "Uint256", "Uint256"]);
  requireSelf(sender);
  return run(take(id), abi.encode(echoed));
}`);
    expect(handler.entryParams.map((p) => p.type)).toEqual(["Address", "Uint256", "bytes"]);

    const parks = compile(`import { install, park, received } from "@sauce/async";

function main(key: Uint256, continuation: bytes, handler: bytes): bytes {
  park(key, continuation);
  install(0x1fe543e3, handler, false);
  return received();
}`);
    expect(parks.bytecode.length).toBeGreaterThan(0);
  });

  it("a request's body is a program of its own for this chain, reading what it captures", () => {
    const program = compile(`${ECHO}
function main(value: Uint256, to: Address) {
  Echo.request(value).then((echoed) => {
    evm.sstore(1, echoed + to);
  });
}`);
    expect(program.bodies).toHaveLength(1);
    expect(program.bodies[0]!.destination.slug).toBe("base");
    expect(program.bodies[0]!.captures).toEqual(["body.to"]);
  });

  it("`await` folds onto the same `then`, and `.catch` joins the same program", () => {
    const awaited = compile(`${ECHO}
function main(value: Uint256, to: Address) {
  await Echo.request(value);
  evm.sstore(1, to);
}`);
    const caught = compile(`${ECHO}
function main(value: Uint256, to: Address) {
  Echo.request(value)
    .then((echoed) => {
      evm.sstore(1, echoed + to);
    })
    .catch((e) => {
      evm.sstore(2, to);
    });
}`);
    expect(awaited.bodies).toHaveLength(1);
    expect(caught.bodies).toHaveLength(1);
    expect(caught.bodies[0]!.captures).toEqual(["body.to"]);
  });

  it("a request on another chain compiles its body for that chain", () => {
    const program = compile(`import { Request } from "@sauce/async";

class Remote {
  send(chain) {
    return new Request({
      chain,
      send: (continuation) => {
        evm.call(0x000000000000000000000000000000000000ec40, 0, continuation.code.concat(continuation.args));
        return undefined;
      },
    });
  }
}
const Messenger = new Remote();

function main(to: Address) {
  Messenger.send(Ethereum.valueOf()).then((input) => {
    USDC.transfer(to, 1);
  });
}`);
    expect(program.bodies.map((b) => b.destination.slug)).toEqual(["ethereum"]);
  });
});

describe("what it refuses", () => {
  const refuses = (source: string, message: RegExp | string): void => {
    expect(() => compile(source)).toThrow(message);
  };

  it("a request with no body", () => {
    refuses(
      `${ECHO}
function main(value: Uint256) {
  Echo.request(value);
}`,
      "a request has no body",
    );
  });

  it("a second `.then`, and a `.catch` before `.then`", () => {
    refuses(
      `${ECHO}
function main(value: Uint256) {
  Echo.request(value).then(() => {}).then(() => {});
}`,
      "is not a step after `.then(...)`",
    );
    refuses(
      `${ECHO}
function main(value: Uint256) {
  Echo.request(value).catch(() => {});
}`,
      "`.catch(...)` follows `.then(...)`",
    );
  });

  it("a request with no `send`", () => {
    refuses(
      `import { Request } from "@sauce/async";
class Nothing {
  request() {
    return new Request({});
  }
}
const N = new Nothing();
function main() {
  N.request().then(() => {});
}`,
      "needs `send`",
    );
  });

  it("an import on Solana, where no arm exists", () => {
    expect(() =>
      compile(
        `import { take } from "@sauce/async";
function main() {}`,
        "solana",
      ),
    ).toThrow();
  });
});

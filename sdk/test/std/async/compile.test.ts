/**
 * `@sauce/async` (sdk/src/std/async), compiled through the SDK as a program for a chain imports it:
 * what compiles, what the library spells out by hand, and what it refuses.
 *
 * The library writes its calls raw, so each selector, event topic and storage location it carries
 * is derived here from its definition and found in the source, and the calls in the emitted
 * bytecode. Execution — requests, callbacks through the Router's fallback, settlement, the
 * combinators — is `evm.e2e.test.ts`'s.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { encodeAbiParameters, keccak256, toFunctionSelector, toHex } from "viem";

import { compileSauceProgram } from "../../../src/routes/sauce-route.js";

/** jest's cwd is `sdk/`. */
const SOURCE = readFileSync(join(process.cwd(), "src", "std", "async", "async.evm.js"), "utf8");
const EXPIRE = readFileSync(
  join(process.cwd(), "src", "std", "async", "expire.handler.js"),
  "utf8",
);

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const compile = (source: string, chain = "base") => compileSauceProgram(chain, source);

/** A protocol in the shape a package writes one: a request method on an object the program reads,
 *  returning a `Request` whose promise is keyed by the id the request call returns. */
const ECHO = `import { Async, Promise, Request, promiseKey } from "@sauce/async";

class EchoProtocol {
  request(value: Uint256) {
    return new Request({
      send: (continuation) => {
        const [id] = abi.decode(
          evm.call(0x000000000000000000000000000000000000ec40, 0, abi.encode(value)),
          ["Uint256"],
        );
        return promiseKey(7, id);
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

  it.each([
    ["SAUCE_ASYNC_RECEIVED", "sauce.async.received"],
    ["SAUCE_ASYNC_MODE", "sauce.async.mode"],
    ["SAUCE_ASYNC_INDEX", "sauce.async.index"],
    ["SAUCE_ASYNC_SALT", "sauce.async.salt"],
    ["SAUCE_ASYNC_PENDING", "PromisePending(bytes32,uint256)"],
    ["SAUCE_ASYNC_SETTLED", "PromiseSettled(bytes32,uint256)"],
    ["SAUCE_ASYNC_IGNORED", "PromiseIgnored(bytes32,uint256)"],
    ["SAUCE_ASYNC_UNHANDLED", "PromiseUnhandled(bytes32,bytes)"],
  ])("%s is keccak256 of %s", (name, text) => {
    expect(SOURCE).toContain(`const ${name} = ${keccak256(toHex(text))};`);
  });

  it.each([
    ["inFlightEngine()", "install(0x1fe543e3, handler, false);"],
    ["setHandler(bytes4,address,bytes,bool)", "install(0x1fe543e3, handler, false);"],
    ["setInterface(bytes4,bool)", "declareInterface(0x805f2132, true);"],
    ["kitchen()", "evm.sstore(1, kitchenFee());"],
    ["executionFee()", "evm.sstore(1, kitchenFee());"],
  ])(
    "%s's selector is derived from its signature, and in the bytecode of `%s`",
    (signature, call) => {
      const selector = toFunctionSelector(signature).slice(2);
      expect(SOURCE).toContain(`hex\`${selector}\``);
      const program = compile(`import { declareInterface, install, kitchenFee } from "@sauce/async";
function main(handler: bytes) {
  ${call}
}`);
      expect(hex(program.bytecode)).toContain(selector);
    },
  );

  it.each(["Timeout(bytes32)", "AggregateError(bytes32)"])(
    "the %s a rejection carries is that error's selector",
    (signature) => {
      expect(SOURCE).toContain(`hex\`${toFunctionSelector(signature).slice(2)}\``);
    },
  );

  it("the expire handler reads the key `expire(bytes32)` carries", () => {
    expect(EXPIRE).toContain('import { expire, kitchenFee } from "@sauce/async";');
    const handler = compile(EXPIRE);
    expect(handler.entryParams.map((p) => p.type)).toEqual(["Address", "Uint256", "bytes"]);
  });
});

describe("what compiles", () => {
  it("a handler, settling the promise its callback names", () => {
    const handler =
      compile(`import { fulfil, promiseKey, reject, requireCaller, requireSelf, settleCarried } from "@sauce/async";

function main(caller: Address, value: Uint256, data: bytes): void {
  requireCaller(0x000000000000000000000000000000000000ec40, caller);
  const [id, sender, echoed] = abi.decode(data.slice(4, data.length), ["Uint256", "Uint256", "Uint256"]);
  requireSelf(sender);
  if (echoed == 0) {
    reject(promiseKey(7, id), abi.encode(echoed));
  } else {
    fulfil(promiseKey(7, id), abi.encode(echoed));
  }
  settleCarried(id, false, data, abi.encode(echoed), true);
}`);
    expect(handler.entryParams.map((p) => p.type)).toEqual(["Address", "Uint256", "bytes"]);
  });

  it("the table's own parts, for a package that needs them directly", () => {
    const parts = compile(`import { isPending, park, received, run, salt } from "@sauce/async";

function main(code: bytes, args: bytes, program: bytes): bytes {
  const key = salt();
  park(key, code, args, 0, false);
  require(isPending(key));
  run(program, hex\`01\`);
  return received();
}`);
    expect(parts.bytecode.length).toBeGreaterThan(0);
  });

  it("a request's body is a program of its own for this chain, reading what it captures", () => {
    const program = compile(`${ECHO}
function main(value: Uint256, to: Address) {
  Echo.request(value).then((echoed) => {
    evm.sstore(1, echoed + to);
  });
}`);
    expect(program.continuations).toHaveLength(1);
    expect(program.continuations[0]!.destination.slug).toBe("base");
    expect(program.continuations[0]!.captures).toEqual(["body.to"]);
    // A continuation opens no intent: the program reports no intent body.
    expect(program.bodies).toEqual([]);
  });

  // await dropped from the compiler (v12 #554)
  it.skip("`await` folds onto the same `then`", () => {
    const awaited = compile(`${ECHO}
function main(value: Uint256, to: Address) {
  await Echo.request(value);
  evm.sstore(1, to);
}`);
    expect(awaited.continuations).toHaveLength(1);
  });

  it("`.catch` and a deadline fold onto the same promise", () => {
    const caught = compile(`${ECHO}
function main(value: Uint256, to: Address) {
  Echo.request(value)
    .within(3600)
    .then((echoed) => {
      evm.sstore(1, echoed + to);
    })
    .catch((e) => {
      evm.sstore(2, to);
    });
}`);
    expect(caught.continuations).toHaveLength(1);
    expect(caught.continuations[0]!.captures).toEqual(["body.to"]);
  });

  it("each combinator: one continuation for itself, and one per child", () => {
    for (const [combinator, body] of [
      ["all", "evm.sstore(1, r[0] + r[1] + to);"],
      ["race", "evm.sstore(1, r + to);"],
      ["any", "evm.sstore(1, r + to);"],
      ["allSettled", "evm.sstore(1, r[0].status + r[1].value.length + to);"],
    ] as const) {
      const program = compile(`${ECHO}
function main(value: Uint256, to: Address) {
  Promise.${combinator}([Echo.request(value), Echo.request(value + 1)]).then((r) => {
    ${body}
  });
}`);
      expect(program.continuations).toHaveLength(3);
      expect(program.continuations[1]!.captures).toEqual(["joinKey"]);
    }
  });

  it("a combinator's child is handed the combinator's continuation, to size its callback", () => {
    const program = compile(`import { Promise, Request, promiseKey } from "@sauce/async";

class Sized {
  request(id: Uint256) {
    return new Request({
      send: (continuation) => {
        evm.sstore(id, continuation.code.length + continuation.settles.code.length);
        return promiseKey(7, id);
      },
    });
  }
}
const S = new Sized();

function main(to: Address) {
  Promise.all([S.request(1), S.request(2)]).then((r) => {
    evm.sstore(3, r[0].length + to);
  });
}`);
    expect(program.continuations).toHaveLength(3);
  });

  it("a race against a timeout, an already settled promise, and a deferred", () => {
    const raced = compile(`${ECHO}
function main(value: Uint256, to: Address) {
  Promise.race([Echo.request(value), Async.timeout(3600)])
    .then((echoed) => {
      evm.sstore(1, echoed + to);
    })
    .catch((e) => {
      evm.sstore(2, to);
    });
}`);
    expect(raced.continuations).toHaveLength(3);
    const settled = compile(`${ECHO}
function main(value: Uint256, to: Address) {
  Promise.all([Promise.resolve(value), Echo.request(value)]).then((r) => {
    evm.sstore(1, r[0] + r[1] + to);
  });
}`);
    expect(settled.continuations).toHaveLength(2);
    const deferred = compile(`${ECHO}
function main(to: Address): Uint256 {
  const d = Promise.withResolvers();
  d.promise.then((value) => {
    evm.sstore(1, value.length + to);
  });
  return d.key;
}`);
    expect(deferred.continuations).toHaveLength(1);
    const later = compile(`${ECHO}
function main(key: Uint256, value: Uint256) {
  Async.resolve(key, abi.encode(value));
  Async.reject(key + 1, abi.encode(value));
  Async.expire(key + 2);
}`);
    expect(later.continuations).toHaveLength(0);
  });

  it("a request on another chain compiles its body for that chain", () => {
    const program = compile(`import { Request } from "@sauce/async";

class Remote {
  send(chain) {
    return new Request({
      chain,
      carries: true,
      send: (continuation) => {
        evm.call(0x000000000000000000000000000000000000ec40, 0, abi.encode(continuation.key, continuation.stored, continuation.program));
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
    expect(program.continuations.map((b) => b.destination.slug)).toEqual(["ethereum"]);
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

  it("a request with no `send`, and a `send` that answers no key", () => {
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
    refuses(
      `import { Request } from "@sauce/async";
class Keyless {
  request() {
    return new Request({ send: (continuation) => undefined });
  }
}
const K = new Keyless();
function main() {
  K.request().then(() => {});
}`,
      "answers the key of its promise",
    );
  });

  it("a combinator with no promises, or no body", () => {
    refuses(
      `${ECHO}
function main() {
  Promise.all([]).then(() => {});
}`,
      "a combinator takes a list of promises",
    );
    refuses(
      `${ECHO}
function main(value: Uint256) {
  Promise.all([Echo.request(value)]);
}`,
      "a combinator has no body",
    );
  });

  it("an import on Solana, where no arm exists", () => {
    expect(() =>
      compile(
        `import { fulfil } from "@sauce/async";
function main() {}`,
        "solana",
      ),
    ).toThrow();
  });
});

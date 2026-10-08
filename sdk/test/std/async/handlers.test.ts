/**
 * A package's handlers and the program installing them (`src/routes/handlers.ts`), and the `sauce`
 * command taking a package as its operand (`src/cli/handlers.ts`). Executing the install, and a
 * handler answering its protocol, is `evm.e2e.test.ts`'s.
 */
import { bytesToHex, toFunctionSelector } from "viem";

import { runCli, nodeIo, type CliIo } from "../../../src/cli/run.js";
import {
  compileHandlers,
  handlersInstallSource,
  packageHandlerDeclarations,
} from "../../../src/routes/handlers.js";
import { compileSauceProgram } from "../../../src/routes/sauce-route.js";

const PROTOCOL = "0x000000000000000000000000000000000000ec40";
const HANDLER = `import { requireCaller, run, take } from "@sauce/async";

function main(caller: Address, value: Uint256, data: bytes): bytes {
  requireCaller(${PROTOCOL}, caller);
  const [id, echoed] = abi.decode(data.slice(4, data.length), ["Uint256", "Uint256"]);
  return run(take(id), abi.encode(echoed));
}`;
const VIEW = `function main(caller: Address, value: Uint256, data: bytes): bool {
  return caller == ${PROTOCOL};
}`;
const FILES: Readonly<Record<string, string>> = {
  "echo.handler.js": HANDLER,
  "views/allowed.js": VIEW,
};
const read = (path: string): string | undefined => FILES[path];

describe("a package's handler declarations", () => {
  it("are none for a package that declares none", () => {
    expect(packageHandlerDeclarations("@sauce/async")).toEqual([]);
  });

  it("are refused for a package the SDK does not have", () => {
    expect(() => packageHandlerDeclarations("@sauce/nothing")).toThrow(
      "@sauce/nothing is no package of the SDK's",
    );
  });
});

describe("compiling them for a chain", () => {
  it("takes a signature or four bytes, and compiles each for the chain", () => {
    const handlers = compileHandlers(
      "base",
      [
        { selector: "echo(uint256,uint256)", program: "echo.handler.js" },
        { selector: "0x0A0B0C0D", program: "views/allowed.js", readOnly: true },
      ],
      read,
    );
    expect(handlers.map(({ selector, readOnly }) => ({ selector, readOnly }))).toEqual([
      { selector: toFunctionSelector("echo(uint256,uint256)"), readOnly: false },
      { selector: "0x0a0b0c0d", readOnly: true },
    ]);
    expect(bytesToHex(handlers[0]!.bytecode)).toBe(
      bytesToHex(compileSauceProgram("base", HANDLER).bytecode),
    );
  });

  it("refuses two handlers for one selector, a file it cannot read and a bad selector", () => {
    expect(() =>
      compileHandlers(
        "base",
        [
          { selector: "echo(uint256,uint256)", program: "echo.handler.js" },
          { selector: toFunctionSelector("echo(uint256,uint256)"), program: "views/allowed.js" },
        ],
        read,
      ),
    ).toThrow("a Pot answers it with one handler");
    expect(() =>
      compileHandlers("base", [{ selector: "echo(uint256)", program: "missing.js" }], read),
    ).toThrow("no handler at missing.js");
    expect(() =>
      compileHandlers("base", [{ selector: "0x0a0b", program: "echo.handler.js" }], read),
    ).toThrow("four bytes or a signature");
  });
});

describe("the program installing them", () => {
  it("installs each handler for its selector, its bytecode written in, and compiles", () => {
    const handlers = compileHandlers(
      "base",
      [
        { selector: "echo(uint256,uint256)", program: "echo.handler.js" },
        { selector: "allowed()", program: "views/allowed.js", readOnly: true },
      ],
      read,
    );
    const source = handlersInstallSource(handlers, "@sauce/echo");
    expect(source).toContain("Installs @sauce/echo's handlers");
    for (const handler of handlers) {
      expect(source).toContain(
        `install(${handler.selector}, hex\`${bytesToHex(handler.bytecode).slice(2)}\`, ${handler.readOnly});`,
      );
    }
    const program = compileSauceProgram("base", source);
    expect(program.entryParams).toEqual([]);
    const bytecode = bytesToHex(program.bytecode);
    for (const handler of handlers)
      expect(bytecode).toContain(bytesToHex(handler.bytecode).slice(2));
  });

  it("is refused with no handler to install", () => {
    expect(() => handlersInstallSource([], "@sauce/async")).toThrow(
      "@sauce/async declares no handlers",
    );
  });
});

describe("the `sauce` command, given a package", () => {
  const sauce = async (...argv: string[]): Promise<{ code: number; out: string }> => {
    let out = "";
    const io: CliIo = {
      ...nodeIo(),
      stdout: (text) => void (out += text),
      stderr: (text) => void (out += text),
    };

    return { code: await runCli(argv, io), out };
  };

  it("compiles it for the chain --chain names, and needs one", async () => {
    const missing = await sauce("compile", "@sauce/async");
    expect(missing.code).not.toBe(0);
    expect(missing.out).toContain("@sauce/async's handlers are compiled for a chain: give --chain");

    const none = await sauce("compile", "@sauce/async", "--chain", "base");
    expect(none.code).not.toBe(0);
    expect(none.out).toContain("@sauce/async declares no handlers: there is nothing to install");
  });
});

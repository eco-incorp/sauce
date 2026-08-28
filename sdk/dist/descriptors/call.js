/**
 * `ContractCall` — the inert value a `Base.<Proto>.<Contract>.<method>(...)`
 * leaf produces. Synchronous, no RPC, no compiler import: the same posture
 * as `swap/source.ts`/`deposit/source.ts`'s pure param-templating call
 * builders, which `toSauceScript` below deliberately mirrors.
 *
 * The `typeFidelity: "widened"` gate lives here, not in accessors.ts: every
 * production path (`data`, `encode`, `toCall`, `toSauceScript`) funnels
 * through `assertFidelity`, so a widened descriptor (three uniswap-v3
 * entries, uniswap-v4's PoolManager) can never silently hand out calldata
 * that will not hit the deployed contract — see links.ts's own caveats for
 * why each one is widened.
 */
import { encodeFunctionData } from "viem";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
/**
 * `baseDirs` for compiling a `toSauceScript()` program — same two-entry
 * shape (dist root + shipped `sdk/src`) and rationale as
 * `deposit/source.ts`'s `DEPOSIT_BASE_DIRS`: a contract's `.json` import
 * resolves against the SDK's protocol registry, not the engine-vendored
 * `dist/artifacts`.
 */
export const CONTRACT_BASE_DIRS = [join(__dirname, ".."), join(__dirname, "..", "..", "src")];
function widenedRealSelectorHint(descriptor) {
    return descriptor.coverage.caveats.length > 0 ? descriptor.coverage.caveats.join("; ") : "vendored types differ from the deployed contract";
}
function assertFidelity(descriptor, method, allowWidened) {
    if (descriptor.coverage.typeFidelity !== "widened")
        return;
    if (allowWidened)
        return;
    throw new Error(`${descriptor.protocol}.${descriptor.contract}.${method.name}: this descriptor's ABI is WIDENED (${widenedRealSelectorHint(descriptor)}) — ` +
        `selector ${method.selector} will NOT match the deployed contract. Pass { allowWidened: true } to encode anyway.`);
}
/** Renders one JS value as a SauceScript literal expression, or throws a named error for a shape
 *  `toSauceScript` can't spell yet (a caller should reach for `encode()`/`toCall()` instead). */
function renderSauceArg(value, methodName) {
    if (typeof value === "bigint")
        return `${value.toString()}n`;
    if (typeof value === "boolean")
        return value ? "true" : "false";
    if (typeof value === "number") {
        if (!Number.isInteger(value)) {
            throw new Error(`toSauceScript: cannot render non-integer number argument for ${methodName} — use encode()/toCall() instead`);
        }
        return `${value.toString()}n`;
    }
    if (typeof value === "string") {
        if (/^0x[0-9a-fA-F]{40}$/.test(value))
            return `${BigInt(value).toString()}n`;
        throw new Error(`toSauceScript: cannot render string argument "${value}" for ${methodName} (only a 20-byte address literal is supported) — use encode()/toCall() instead`);
    }
    if (Array.isArray(value)) {
        return `[${value.map((v) => renderSauceArg(v, methodName)).join(", ")}]`;
    }
    if (value instanceof Uint8Array) {
        return `Uint8Array.from([${Array.from(value).join(", ")}])`;
    }
    throw new Error(`toSauceScript: cannot render argument of type ${typeof value} for ${methodName} — use encode()/toCall() instead`);
}
export function makeContractCall(descriptor, chain, address, method, args) {
    const fidelity = descriptor.coverage.typeFidelity;
    const caveats = descriptor.coverage.caveats;
    function encode(opts = {}) {
        assertFidelity(descriptor, method, opts.allowWidened);
        return encodeFunctionData({ abi: descriptor.abi, functionName: method.name, args: args });
    }
    function toCall(opts = {}) {
        return { target: address, data: encode(opts), value: opts.value ?? 0n };
    }
    function toSauceScript(opts = {}) {
        assertFidelity(descriptor, method, undefined);
        if (descriptor.abiExport === undefined) {
            throw new Error(`toSauceScript: ${descriptor.protocol}.${descriptor.contract} has no vendored abiExport — use encode()/toCall() instead`);
        }
        const binding = opts.binding ?? descriptor.contract;
        const importLine = `import { ${binding} } from "./protocols/${descriptor.protocol}/${descriptor.abiExport}.json";`;
        const renderedArgs = args.map((a) => renderSauceArg(a, method.name)).join(", ");
        const statement = `${binding}.at(${address.length > 0 ? `${BigInt(address).toString()}n` : "0n"}).${method.name}(${renderedArgs});`;
        const source = [importLine, "", "function main() {", `  ${statement}`, "}", ""].join("\n");
        return { imports: [importLine], statement, source, baseDirs: CONTRACT_BASE_DIRS };
    }
    return {
        chain,
        protocol: descriptor.protocol,
        contract: descriptor.contract,
        address,
        method,
        args,
        fidelity,
        caveats,
        get data() {
            return encode();
        },
        encode,
        toCall,
        toSauceScript,
    };
}
//# sourceMappingURL=call.js.map
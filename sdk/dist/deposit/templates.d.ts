import type { DepositTemplate } from "./types.js";
export type DepositKey = "weth:wrap" | "weth:unwrap" | "aave-v3:supply" | "aave-v3:withdraw" | "spark:supply" | "spark:withdraw" | "compound-v3:supply" | "euler-v2:deposit" | "erc4626:deposit" | "lido:stake" | "lido:wrap";
export declare const DEPOSIT_TEMPLATES: Readonly<Record<DepositKey, DepositTemplate>>;
/** Looks up a template by `protocol:action`, throwing (and listing every registered key) rather
 *  than letting a caller emit a program that would misbehave on-chain — same posture as
 *  `toSwapParams`'s guard on `UndispatchablePoolType`. */
export declare function depositTemplateFor(protocol: string, action: string): DepositTemplate;
export declare function listDepositTemplates(): readonly DepositTemplate[];
//# sourceMappingURL=templates.d.ts.map
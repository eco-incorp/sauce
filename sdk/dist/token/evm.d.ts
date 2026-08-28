import type { TokenApproveSpec, TokenBalanceSpec, TokenTransferSpec } from "./types.js";
export declare const ERC20_IMPORT_LINE = "import { IERC20 } from \"./artifacts/IERC20.json\";";
export declare function evmTransferStatement(spec: TokenTransferSpec): string;
export declare function evmApproveStatement(spec: TokenApproveSpec): string;
export declare function evmBalanceExpression(spec: TokenBalanceSpec): string;
//# sourceMappingURL=evm.d.ts.map
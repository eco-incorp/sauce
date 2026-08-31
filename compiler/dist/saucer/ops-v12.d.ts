/**
 * V12 runtime-specific opcodes for stack manipulation and utilities.
 * Mirrors the engine-v12 Huff runtime (OPS_V12) — the 0xD0-0xF3 range.
 *
 * These are only emitted by the postfix `V12Saucer` builder; the v1 prefix
 * `Saucer` never references them.
 *
 * Layout:
 * - 0xD0-0xDF: Stack DUP (SDUP1-SDUP16) — duplicate the Nth stack item to top
 * - 0xE0-0xF0: Stack management (SDROP, SSWAP1-SSWAP16)
 * - 0xF1-0xF3: Utilities (SROT, MSTORE, FUNC_RETURN)
 */
export declare const OPS_V12: {
    readonly SDUP1: 208;
    readonly SDUP2: 209;
    readonly SDUP3: 210;
    readonly SDUP4: 211;
    readonly SDUP5: 212;
    readonly SDUP6: 213;
    readonly SDUP7: 214;
    readonly SDUP8: 215;
    readonly SDUP9: 216;
    readonly SDUP10: 217;
    readonly SDUP11: 218;
    readonly SDUP12: 219;
    readonly SDUP13: 220;
    readonly SDUP14: 221;
    readonly SDUP15: 222;
    readonly SDUP16: 223;
    readonly SDROP: 224;
    readonly SSWAP1: 225;
    readonly SSWAP2: 226;
    readonly SSWAP3: 227;
    readonly SSWAP4: 228;
    readonly SSWAP5: 229;
    readonly SSWAP6: 230;
    readonly SSWAP7: 231;
    readonly SSWAP8: 232;
    readonly SSWAP9: 233;
    readonly SSWAP10: 234;
    readonly SSWAP11: 235;
    readonly SSWAP12: 236;
    readonly SSWAP13: 237;
    readonly SSWAP14: 238;
    readonly SSWAP15: 239;
    readonly SSWAP16: 240;
    readonly SROT: 241;
    readonly MSTORE: 242;
    readonly FUNC_RETURN: 243;
};
export type OpcodeV12Name = keyof typeof OPS_V12;
export type OpcodeV12Byte = (typeof OPS_V12)[OpcodeV12Name];
//# sourceMappingURL=ops-v12.d.ts.map
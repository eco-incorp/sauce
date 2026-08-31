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
export const OPS_V12 = {
  // Stack DUP (0xD0-0xDF)
  SDUP1: 0xd0,
  SDUP2: 0xd1,
  SDUP3: 0xd2,
  SDUP4: 0xd3,
  SDUP5: 0xd4,
  SDUP6: 0xd5,
  SDUP7: 0xd6,
  SDUP8: 0xd7,
  SDUP9: 0xd8,
  SDUP10: 0xd9,
  SDUP11: 0xda,
  SDUP12: 0xdb,
  SDUP13: 0xdc,
  SDUP14: 0xdd,
  SDUP15: 0xde,
  SDUP16: 0xdf,

  // Stack management (0xE0-0xF0)
  SDROP: 0xe0,
  SSWAP1: 0xe1,
  SSWAP2: 0xe2,
  SSWAP3: 0xe3,
  SSWAP4: 0xe4,
  SSWAP5: 0xe5,
  SSWAP6: 0xe6,
  SSWAP7: 0xe7,
  SSWAP8: 0xe8,
  SSWAP9: 0xe9,
  SSWAP10: 0xea,
  SSWAP11: 0xeb,
  SSWAP12: 0xec,
  SSWAP13: 0xed,
  SSWAP14: 0xee,
  SSWAP15: 0xef,
  SSWAP16: 0xf0,

  // Utilities (0xF1-0xF3)
  SROT: 0xf1,
  MSTORE: 0xf2,
  FUNC_RETURN: 0xf3,
} as const;

export type OpcodeV12Name = keyof typeof OPS_V12;
export type OpcodeV12Byte = (typeof OPS_V12)[OpcodeV12Name];

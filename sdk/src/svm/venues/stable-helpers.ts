/**
 * The declared-helper shape an SvmRoute venue contributes to codegen (the
 * generator dedupes helpers by `name`).
 *
 * The shared stable-curve Newton helper SOURCES that used to live here
 * (`STABLE_D_HELPER`/`STABLE_YW_HELPER` and their TS mirrors
 * `stableComputeD`/`stableComputeYWarm`) were merge-decomposition ladder
 * internals — only ladder rung walks consumed them — and moved out with the
 * ladders themselves to the consuming recipes package. This interface stays
 * because it is the generic contract, not the math.
 */

export interface SvmHelperFn {
  name: string;
  source: string;
}

type BuilderNode = {
    _bytes: Uint8Array;
};
/**
 * `forcedWidth` (optional): only ever passed by `processReturnStatement`'s width-forcing branch
 * for a return-position array literal the ts-frontend's local-array return-escape fold
 * synthesized (see ts-frontend.ts's "Forcing uint256 element width" doc note) — NOT a general
 * width-selection knob for an ordinary, directly user-written array literal, which keeps its
 * existing auto-narrowed encoding (via `maxByteWidth`) completely unchanged either way.
 * `Math.max(forcedWidth, natural)` means a forced width can only WIDEN a value's encoding,
 * never truncate one — `packStaticElements`/`padToWidth` need no change at all, since they
 * already zero-left-pad to whatever `width` they're given. Only meaningful in the `allStatic`
 * branch (every element the fold synthesizes is a non-negative bigint literal, which always
 * encodes as a STATIC type) — passing it alongside a dynamic-element array throws defensively,
 * since there is no such caller today and honoring it silently would be misleading.
 */
export declare const encodeArray: (elements: BuilderNode[], forcedWidth?: number) => Uint8Array;
export declare const encodeIndex: (index: BuilderNode, array: BuilderNode) => Uint8Array;
export declare const encodeSetIndex: (value: BuilderNode, index: BuilderNode, array: BuilderNode) => Uint8Array;
export declare const encodeNewArray: (count: BuilderNode) => Uint8Array;
export declare const isImmutablePackedArray: (bytes: Uint8Array) => boolean;
export {};
//# sourceMappingURL=array.d.ts.map
/** A `sourceMappingURL` directive: a `line` or a `block` comment, the URL it names, and where it
 *  starts. */
export interface SourceMapDirective {
  readonly kind: "line" | "block";
  readonly url: string;
  readonly start: number;
}

/** Every `sourceMappingURL` directive in `text`, in order, found as Node finds one (anywhere, in a
 *  line or a block comment), `@` beside `#`. The last is the one Node takes. */
export declare function directivesOf(text: string): SourceMapDirective[];

/** Why the packed map `path` (its text) may not ship, or `undefined`: a `.d.ts.map` whose source
 *  root and sources are relative paths, every source a file in `packed`, may. */
export declare function mapRefusal(
  path: string,
  text: string,
  packed: ReadonlySet<string>,
): string | undefined;

/** What the packed files, under `root`, ship against the rule, one line each, maps first. */
export declare function auditSourceMaps(root: string, packed: ReadonlySet<string>): string[];

/** Deletes every map the rule refuses, and takes tsc's trailer off each build output file whose
 *  trailer names one; it changes nothing else. */
export declare function pruneSourceMaps(
  root: string,
  packed: ReadonlySet<string>,
): { kept: number; removed: string[]; stripped: number };

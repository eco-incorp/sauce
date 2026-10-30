export function readInstalledCompilerProvenance(directory?: string): {
  readonly compiler: string;
  readonly wasmSha256: string;
};

export function compileInstalledCompilerProbe(directory?: string): {
  readonly compiler: string;
  readonly wasmSha256: string;
  readonly program: `0x${string}`;
};

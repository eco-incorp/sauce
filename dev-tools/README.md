# Sauce dev-tools

To build an application with Sauce, install the SDK — you do not need this workspace:

```sh
pnpm add @eco-incorp/sauce
```

Follow the [quick start](../docs/guides/quick-start.md) and the
[examples](../docs/examples/README.md). After installing, the same manual is on disk at
`node_modules/@eco-incorp/sauce/docs/README.md`.

This workspace holds a local harness used while developing the SDK itself. Its compilation and
argument helpers, and its Solana local-execution runner, are current. Its deployment and end-to-end
scripts target an earlier EVM contract interface and do not work against Kitchen/Pot deployments;
use the SDK's own [execution guides](../docs/guides/compiling.md) instead.

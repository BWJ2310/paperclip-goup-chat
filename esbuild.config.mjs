import esbuild from "esbuild";
import { createPluginBundlerPresets } from "@paperclipai/plugin-sdk/bundlers";

const presets = createPluginBundlerPresets({ uiEntry: "src/ui/index.tsx" });
const watch = process.argv.includes("--watch");

// Mark native/platform deps and SDK as external.
// The host provides @paperclipai/* at runtime via the worker's node_modules
// resolution chain, so we keep them external to avoid SDK/shared version
// mismatch issues during bundling.
const workerExternals = [
  ...(presets.esbuild.worker.external || []),
  "@embedded-postgres/*",
  "embedded-postgres",
  "postgres",
  "@paperclipai/shared",
  "@paperclipai/plugin-sdk",
  "@paperclipai/plugin-sdk/*",
];

const workerConfig = {
  ...presets.esbuild.worker,
  external: workerExternals,
};

const workerCtx = await esbuild.context(workerConfig);
const manifestCtx = await esbuild.context(presets.esbuild.manifest);
const uiCtx = await esbuild.context(presets.esbuild.ui);

if (watch) {
  await Promise.all([workerCtx.watch(), manifestCtx.watch(), uiCtx.watch()]);
  console.log("esbuild watch mode enabled for worker, manifest, and ui");
} else {
  await Promise.all([
    workerCtx.rebuild(),
    manifestCtx.rebuild(),
    uiCtx.rebuild(),
  ]);
  await Promise.all([
    workerCtx.dispose(),
    manifestCtx.dispose(),
    uiCtx.dispose(),
  ]);
}

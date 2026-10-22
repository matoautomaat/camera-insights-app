// Lets a test import the app's own modules the way the app does: "@/lib/x",
// and relative paths without ".ts". Node strips the types; this finds the file.
// Used by npm test (node --import ./scripts/resolve-app-paths.mjs).
import { registerHooks } from "node:module";

const SRC = new URL("../src/", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const target = specifier.startsWith("@/") ? new URL(specifier.slice(2), SRC).href : specifier;
    try {
      return nextResolve(target, context);
    } catch (error) {
      const local = /^(\.{1,2}\/|\/|file:)/.test(target);
      if (!local || /\.[cm]?[jt]sx?$/.test(target)) throw error;
      for (const suffix of [".ts", "/index.ts"]) {
        try {
          return nextResolve(target + suffix, context);
        } catch {
          // Try the next way of writing it.
        }
      }
      throw error;
    }
  },
});

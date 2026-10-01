// Build: dist/content-editor.js (IIFE, window.ContentEditor) + dist/content-editor.css
// a dist-node/core.mjs pro nastroje (test tam a zpet v Node).
// Pouziti: node build.mjs [--watch]
import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");
mkdirSync("dist", { recursive: true });

const browser = {
    entryPoints: ["src/index.ts"],
    bundle: true,
    format: "iife",
    globalName: "ContentEditor",
    target: ["es2019"],
    minify: !watch,
    sourcemap: true,
    legalComments: "linked",
    outfile: "dist/content-editor.js",
    logLevel: "info",
};

// samostatny editor kodu pro administraci (bez ProseMirroru)
const code = {
    entryPoints: ["src/code.ts"],
    bundle: true,
    format: "iife",
    globalName: "CodeEditor",
    target: ["es2019"],
    minify: !watch,
    sourcemap: true,
    legalComments: "linked",
    outfile: "dist/code-editor.js",
    logLevel: "info",
};

const node = {
    entryPoints: ["src/core/index.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    target: ["node18"],
    outfile: "dist-node/core.mjs",
    logLevel: "warning",
};

const copyCss = () => copyFileSync("src/styles/editor.css", "dist/content-editor.css");

if (watch) {
    const ctx = await esbuild.context({ ...browser, plugins: [{ name: "css", setup: (b) => b.onEnd(copyCss) }] });
    await ctx.watch();
    const ctxCode = await esbuild.context(code);
    await ctxCode.watch();
} else {
    await esbuild.build(browser);
    await esbuild.build(code);
    await esbuild.build(node);
    copyCss();
}

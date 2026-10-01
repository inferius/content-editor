// Vlozeni skutecne schranky z Wordu (tools/fixtures/word-test.*, vyrobi make-word-fixture.ps1)
// pres cistic a parser editoru - vypise vysledne HTML (kontrola okem / rozdil proti Wordu).
//
//   node build.mjs && node tools/paste-fixture.mjs [nazev=word-test] [--raw]
import { readFileSync, existsSync } from "node:fs";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;

const { cleanOfficeHTML, extractRtfImages, pasteParser, serializeHTML } = await import("../dist-node/core.mjs");

const name = process.argv.slice(2).find((a) => !a.startsWith("--")) || "word-test";
const dir = new URL("./fixtures/", import.meta.url);
const html = readFileSync(new URL(name + ".html", dir), "utf8");
const rtfFile = new URL(name + ".rtf", dir);
const rtf = existsSync(rtfFile) ? readFileSync(rtfFile, "utf8") : "";

const images = extractRtfImages(rtf);
const res = cleanOfficeHTML(html, {
    palette: ["#d0312d", "#e67e22", "#27ae60", "#1d67e7", "#7b3fb8", "#6b7280"],
    headings: [2, 3, 4],
    doc: document,
    localImages: images,
    remoteImages: true,
});
console.log(`zdroj: ${res?.source}, obrazky z RTF: ${images.length}, k nahrani: ${res?.images.length}, vynechane: ${res?.droppedImages}, nesparovane: ${res?.unmatchedLocal}`);
const d = document.createElement("div");
d.innerHTML = res ? res.html : html;
let out = serializeHTML(pasteParser.parse(d));
// data: URL zkratit (citelnost)
out = out.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]{40,}/g, (m) => m.slice(0, 30) + "...");
console.log(process.argv.includes("--raw") ? res.html.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]{40,}/g, "data:...") : out);

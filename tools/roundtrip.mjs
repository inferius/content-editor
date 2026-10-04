// Test tam a zpet: kazdy text z DB projde editorem (HTML -> dokument -> HTML)
// a porovna se s originalem. Ukazuje, co by editor pri otevreni a ulozeni zmenil.
//
//   php tools/export_content.php && node build.mjs && node tools/roundtrip.mjs [--samples=N] [--data=export.json]
//
// Kontroly:
//   text      - viditelny text musi zustat stejny (jinak CHYBA)
//   prvky     - pocty odkazu, obrazku, tabulek, nadpisu, seznamu pred a po
//   zahozeno  - atributy / styly / znacky, ktere editor nezna (balast z Wordu)
//   stabilita - druhy pruchod musi dat stejny vysledek
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const { parseHTML, serializeHTML } = await import("../dist-node/core.mjs");

// --markup='{"video":{"wrapperClass":"...","iframeClass":"..."}}' = markup jineho webu (configureMarkup)
const markupArg = process.argv.find((x) => x.startsWith("--markup="))?.slice(9);
if (markupArg) (await import("../dist-node/core.mjs")).configureMarkup(JSON.parse(markupArg));

const samplesArg = process.argv.find((a) => a.startsWith("--samples="));
const SAMPLES = samplesArg ? parseInt(samplesArg.split("=")[1], 10) : 3;
// lokalizacni texty jsou fragmenty (bez <p>, s id pro skripty webu) - editor pro ne zatim neni urcen
const EXCLUDE = (process.argv.find((a) => a.startsWith("--exclude="))?.split("=")[1] ?? "_front_lang_texts_lang_data").split(",").filter(Boolean);
// --data=cesta.json = export z jineho projektu (vychozi tools/.data/content.json z export_content.php)
const dataArg = process.argv.find((a) => a.startsWith("--data="))?.slice(7);
const items = JSON.parse(readFileSync(dataArg ?? new URL("./.data/content.json", import.meta.url), "utf8")).filter((i) => !EXCLUDE.includes(i.table));
if (EXCLUDE.length) console.log("vynechano:", EXCLUDE.join(", "));

// prvky, ktere musi zustat (pocet pred == po)
const KEEP = ["a", "img", "div", "table", "tr", "td", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "iframe", "strong", "em", "hr", "sup", "sub", "u", "s"];
const NORMALIZE_TAG = { b: "strong", i: "em", del: "s", strike: "s", th: "td" };

function el(html) {
    const d = document.createElement("div");
    d.innerHTML = html;
    return d;
}

// viditelny text: bloky oddelene mezerou (jako v prohlizeci), mezery sjednocene
const BLOCKS = new Set(["P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "TD", "TH", "TR", "TABLE", "BLOCKQUOTE", "PRE", "HR", "BR"]);
function text(node) {
    const out = [];
    const walk = (n) => {
        if (n.nodeType === 3) { out.push(n.textContent); return; }
        if (n.nodeType !== 1) return;
        const block = BLOCKS.has(n.tagName);
        if (block) out.push(" ");
        n.childNodes.forEach(walk);
        if (block) out.push(" ");
    };
    node.childNodes.forEach(walk);
    return out.join("").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function tagCounts(root) {
    const c = {};
    root.querySelectorAll("*").forEach((e) => {
        let t = e.tagName.toLowerCase();
        t = NORMALIZE_TAG[t] || t;
        c[t] = (c[t] || 0) + 1;
    });
    return c;
}

function attrInventory(root) {
    const set = new Map();
    root.querySelectorAll("*").forEach((e) => {
        const t = e.tagName.toLowerCase();
        for (const a of e.attributes) {
            if (a.name === "style") {
                for (const part of a.value.split(";")) {
                    const p = part.split(":")[0].trim().toLowerCase();
                    if (p) set.set(`${t}[style:${p}]`, (set.get(`${t}[style:${p}]`) || 0) + 1);
                }
            } else set.set(`${t}@${a.name}`, (set.get(`${t}@${a.name}`) || 0) + 1);
        }
    });
    return set;
}

const report = {
    total: items.length, changedText: [], unstable: [], countDiffs: {}, droppedAttrs: {}, droppedTags: {},
    rawBlocks: 0, rawSamples: [], unchanged: 0, bytesBefore: 0, bytesAfter: 0,
};
const t0 = Date.now();

for (const it of items) {
    const where = `${it.table}.${it.column}#${it.id}`;
    const before = el(it.html);
    let out;
    try {
        out = serializeHTML(parseHTML(it.html));
    } catch (e) {
        report.changedText.push({ where, error: String(e) });
        continue;
    }
    const after = el(out);
    report.bytesBefore += it.html.length;
    report.bytesAfter += out.length;
    if (out === it.html) report.unchanged++;

    // 1) text
    // obsah <title>, <style> a <script> se v prohlizeci nezobrazuje - pro porovnani vynechat
    for (const root of [before, after]) root.querySelectorAll("title, style, meta, link").forEach((n) => n.remove());
    const tb = text(before);
    const ta = text(after);
    if (tb !== ta) {
        let i = 0;
        while (i < tb.length && tb[i] === ta[i]) i++;
        report.changedText.push({ where, at: i, before: tb.slice(Math.max(0, i - 40), i + 80), after: ta.slice(Math.max(0, i - 40), i + 80) });
    }

    // 2) pocty prvku
    const cb = tagCounts(before);
    const ca = tagCounts(after);
    for (const t of KEEP) {
        const d = (ca[t] || 0) - (cb[t] || 0);
        if (d !== 0) {
            const r = (report.countDiffs[t] ||= { diff: 0, items: 0, samples: [] });
            r.diff += d;
            r.items++;
            if (r.samples.length < SAMPLES) r.samples.push(where);
        }
    }
    for (const [t, n] of Object.entries(cb)) {
        if (!ca[t] && !KEEP.includes(t)) report.droppedTags[t] = (report.droppedTags[t] || 0) + n;
    }

    // 3) zahozene atributy/styly
    const ab = attrInventory(before);
    const aa = attrInventory(after);
    for (const [k, n] of ab) {
        const lost = n - (aa.get(k) || 0);
        if (lost > 0) report.droppedAttrs[k] = (report.droppedAttrs[k] || 0) + lost;
    }

    // 4) HTML bloky
    const raw = (out.match(/data-raw/g) || []).length; // (jen pro pripad, ze by je serializer znacil)
    report.rawBlocks += raw;

    // 5) stabilita
    const again = serializeHTML(parseHTML(out));
    if (again !== out) report.unstable.push(where);
}

const top = (obj, n = 25) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
console.log(`\nTest tam a zpet: ${report.total} textu za ${Date.now() - t0} ms`);
console.log(`beze zmeny: ${report.unchanged}, velikost ${report.bytesBefore} -> ${report.bytesAfter} B`);
console.log(`\nZMENENY TEXT: ${report.changedText.length}`);
report.changedText.slice(0, SAMPLES * 3).forEach((c) => console.log("  -", c.where, c.error || "", c.error ? "" : `\n      pred: ${c.before}\n      po:   ${c.after}`));
console.log(`\nNESTABILNI (2. pruchod jiny): ${report.unstable.length}`, report.unstable.slice(0, SAMPLES).join(", "));
console.log(`\nPOCTY PRVKU (po - pred):`);
Object.entries(report.countDiffs).forEach(([t, r]) => console.log(`  ${t}: ${r.diff > 0 ? "+" : ""}${r.diff} v ${r.items} textech (${r.samples.join(", ")})`));
console.log(`\nZAHOZENE ZNACKY:`, top(report.droppedTags).map(([k, v]) => `${k}(${v})`).join(" ") || "-");
console.log(`\nZAHOZENE ATRIBUTY/STYLY:`);
top(report.droppedAttrs, 40).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
mkdirSync(new URL("./.data/", import.meta.url), { recursive: true });
writeFileSync(new URL("./.data/report.json", import.meta.url), JSON.stringify(report, null, 2));

/**
 * Vzhled webu: styly webu primo v editoru (omezene na obsah editoru) a dokument
 * pro nahledy v iframe (tam styly webu bez omezeni - iframe je izolovany).
 */

export interface WebLook {
    /** Styly webu (URL). Pro vzhled primo v editoru musi jit stahnout (stejny puvod nebo CORS). */
    css: string[];
    /** Tridy obalu obsahu na webu, napr. "full-text cms". */
    contentClass?: string;
    /** Obaly nad obsahem na webu (od vnejsiho), napr. ["blog-detail", "container"] - kvuli pravidlum typu ".blog-detail .full-text". */
    wrappers?: string[];
    /** Tridy <body> webu. */
    bodyClass?: string;
    /** Sirka obsahu na webu v px - v rezimu vzhledu webu se obsah zuzi na tuto sirku. */
    width?: number;
    /** Zaklad relativnich adres v nahledu (obrazky /uploaded_data/...). Vychozi adresa administrace. */
    baseUrl?: string;
    /** CSS navic (text) - napr. oprava pozadi. Plati v editoru i v nahledu. */
    extraCss?: string;
    /** Vychozi stav prepinace "Vzhled webu" (dokud si ho uzivatel neprepne). */
    enabled?: boolean;
}

export const WEB_SCOPE = "ce-web";

function esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Samostatny HTML dokument pro iframe nahledu: styly webu + obsah v obalech webu.
 * Obsah projde sanitizePreview - iframe je ze stejneho puvodu jako administrace
 * (sandbox s neprusvitnym puvodem by lokalne nesmel nacitat styly a obrazky z localhost).
 */
export function frameDocument(bodyHtml: string, web: WebLook | null, opts: { padding?: string; scroll?: boolean; width?: number } = {}): string {
    const base = web?.baseUrl || (typeof location !== "undefined" ? location.origin + "/" : "/");
    const links = (web?.css || []).map((u) => `<link rel="stylesheet" href="${esc(u)}">`).join("");
    let inner = `<div class="${esc(web?.contentClass || "")}">${sanitizePreview(bodyHtml)}</div>`;
    for (const w of [...(web?.wrappers || [])].reverse()) inner = `<div class="${esc(w)}">${inner}</div>`;
    if (opts.width) inner = `<div style="max-width:${opts.width}px;margin:0 auto">${inner}</div>`;
    return "<!doctype html><html lang=\"cs\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
        `<base href="${esc(base)}" target="_blank">${links}` +
        `<style>html,body{margin:0;${opts.scroll ? "" : "background:transparent;overflow:hidden"}}body{padding:${opts.padding || "0"}}${web?.extraCss || ""}</style>` +
        `</head><body class="${esc(web?.bodyClass || "")}">${inner}</body></html>`;
}

const DROP_TAGS = "script, object, embed, applet, meta, base, frame, frameset, portal";
const URL_ATTRS = ["href", "src", "action", "formaction", "xlink:href", "data", "poster", "background", "srcset"];

/**
 * Obsah pro nahled: bez skriptu, obsluh udalosti (on*) a javascript: adres.
 * Vlozeny Instagram (blockquote + embed.js) -> oficialni vlozeny iframe Instagramu.
 */
export function sanitizePreview(html: string): string {
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    const root = tpl.content;
    root.querySelectorAll("blockquote.instagram-media[data-instgrm-permalink]").forEach((bq) => {
        const m = (bq.getAttribute("data-instgrm-permalink") || "").match(/^https:\/\/(www\.)?instagram\.com\/(?:[\w.]+\/)?(p|reel|tv)\/([\w-]+)/);
        if (!m) return;
        const f = document.createElement("iframe");
        f.src = `https://www.instagram.com/${m[2]}/${m[3]}/embed/captioned/`;
        f.setAttribute("style", "width:100%;max-width:540px;min-width:326px;height:720px;border:1px solid #dbdbdb;border-radius:3px;background:#fff");
        f.setAttribute("loading", "lazy");
        f.setAttribute("title", "Instagram");
        bq.replaceWith(f);
    });
    root.querySelectorAll(DROP_TAGS).forEach((el) => el.remove());
    root.querySelectorAll("*").forEach((el) => {
        for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            const value = attr.value.replace(/[\x00-\x20]+/g, "").toLowerCase();
            if (name.startsWith("on") || name === "srcdoc") el.removeAttribute(attr.name);
            else if (URL_ATTRS.includes(name) && /^(javascript|vbscript|data:text\/html)/.test(value)) el.removeAttribute(attr.name);
        }
        if (el.tagName === "IFRAME" && !/^https?:/i.test(el.getAttribute("src") || "")) el.remove();
    });
    const wrap = document.createElement("div");
    wrap.appendChild(root);
    return wrap.innerHTML;
}

// ------------------------------------------------------------------ styly webu v editoru

/** Prida list stylu do dokumentu (jednou). Plati jen uvnitr .ce-web, jinde nic nemeni. */
export function adoptSheet(sheet: CSSStyleSheet): void {
    if (!document.adoptedStyleSheets.includes(sheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

const sheets = new Map<string, Promise<CSSStyleSheet | null>>();

/**
 * Stahne styly webu a prepise selektory tak, aby platily jen uvnitr .ce-web
 * (body/html -> .ce-web, ostatni -> ".ce-web selektor"). Vysledek se sdili
 * mezi editory na strance. null = styly nejdou nacist (CORS, chyba site).
 */
export function loadScopedCss(web: WebLook): Promise<CSSStyleSheet | null> {
    const key = web.css.join("\n") + "\n" + (web.extraCss || "");
    let p = sheets.get(key);
    if (!p) {
        p = buildSheet(web).catch((e) => {
            console.warn("content-editor: styly webu se nepodařilo načíst", e);
            return null;
        });
        sheets.set(key, p);
    }
    return p;
}

async function buildSheet(web: WebLook): Promise<CSSStyleSheet | null> {
    if (typeof CSSStyleSheet === "undefined" || !("replaceSync" in CSSStyleSheet.prototype)) return null;
    const texts = await Promise.all(web.css.map(async (url) => {
        const abs = new URL(url, location.href).href;
        const res = await fetch(abs, { credentials: abs.startsWith(location.origin) ? "same-origin" : "omit" });
        if (!res.ok) throw new Error(url + ": HTTP " + res.status);
        return rebaseUrls(await res.text(), abs);
    }));
    const src = new CSSStyleSheet();
    src.replaceSync(texts.join("\n") + "\n" + (web.extraCss || ""));
    const out = new CSSStyleSheet();
    out.replaceSync(scopeRules(src.cssRules, "." + WEB_SCOPE));
    return out;
}

/** Relativni url(...) v CSS -> absolutni (CSS se vklada jinam, nez odkud je). */
function rebaseUrls(css: string, base: string): string {
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (all, q: string, u: string) => {
        if (/^(data:|https?:|\/\/|#)/i.test(u)) return all;
        try {
            return `url(${q}${new URL(u, base).href}${q})`;
        } catch {
            return all;
        }
    });
}

function scopeRules(rules: CSSRuleList, scope: string): string {
    let out = "";
    for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule) {
            const sel = splitSelectors(rule.selectorText).map((s) => scopeSelector(s, scope)).filter(Boolean).join(", ");
            if (sel) out += `${sel}{${rule.style.cssText}}\n`;
        } else if (rule instanceof CSSMediaRule) {
            const inner = scopeRules(rule.cssRules, scope);
            if (inner) out += `@media ${rule.conditionText || rule.media.mediaText}{${inner}}\n`;
        } else if (typeof CSSSupportsRule !== "undefined" && rule instanceof CSSSupportsRule) {
            const inner = scopeRules(rule.cssRules, scope);
            if (inner) out += `@supports ${rule.conditionText}{${inner}}\n`;
        } else if (rule instanceof CSSFontFaceRule || rule instanceof CSSKeyframesRule) {
            out += rule.cssText + "\n";
        }
    }
    return out;
}

/** "a, b:is(c, d)" -> ["a", "b:is(c, d)"] */
function splitSelectors(text: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of text) {
        if (ch === "(" || ch === "[") depth++;
        else if (ch === ")" || ch === "]") depth--;
        if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim()).filter(Boolean);
}

const ROOT_RE = /^(?::root|html)(?=$|[\s>+~.:#[])/i;
const BODY_RE = /^body(?=$|[\s>+~.:#[])/i;

function scopeSelector(sel: string, scope: string): string {
    let s = sel.trim();
    // html / :root -> obal editoru (html.trida .x zustane jako .trida .x uvnitr obalu)
    if (ROOT_RE.test(s)) {
        s = s.replace(ROOT_RE, "").trim();
        if (s.startsWith(">")) s = s.slice(1).trim();
        if (!s) return scope;
    }
    if (BODY_RE.test(s)) return scope + s.slice(4);
    return scope + " " + s;
}

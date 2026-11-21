/**
 * Schema dokumentu = co editor zna. Postavene podle skutecneho obsahu webu
 * (blog, pripadove studie, podsluzby): odstavce, nadpisy, seznamy, odkazy,
 * obrazky, tabulky, blok s tlacitkem, video, citace.
 *
 * Co schema nezna:
 *  - bloky s vlastnim layoutem (div s tridou/stylem, formulare, ...) se zachovaji
 *    beze zmeny jako "HTML blok" (rawhtml) - editor je jen zobrazi a da upravit zdroj
 *  - balast z Wordu / Google Docs (paraeid, fonty ve spanech, page-break) se zahodi
 *
 * Vystupni HTML ma stejny tvar, jaky dosud ukladal CKEditor.
 */
import { Schema, type NodeSpec, type MarkSpec, type DOMOutputSpec, type Node as PMNode } from "prosemirror-model";
import { addListNodes } from "prosemirror-schema-list";
import { tableNodes } from "prosemirror-tables";
import { safeHref, safeSrc, youtubeEmbed, CONTACT_FORM_ACTION, setJsActions } from "./urls";
import { varText, varRegExp } from "./vartext";
import { inertDocument } from "./inertdoc";

// ---------------------------------------------------------------- pomocne

export function parseStyle(style: string | null): Record<string, string> {
    const out: Record<string, string> = {};
    if (!style) return out;
    for (const part of style.split(";")) {
        const i = part.indexOf(":");
        if (i < 0) continue;
        const k = part.slice(0, i).trim().toLowerCase();
        const v = part.slice(i + 1).trim();
        if (k && v) out[k] = v;
    }
    return out;
}

function styleString(map: Record<string, string | null | undefined>): string | null {
    const s = Object.entries(map).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `${k}: ${v}`).join("; ");
    return s ? s + ";" : null;
}

const ALIGNS = ["left", "center", "right", "justify"];

/** Pevna rozvrzeni sloupcu (trida cms-cols-<layout>). */
export const COLUMN_LAYOUTS = ["2", "3", "4", "1-2", "2-1"];

/** Vlastni sirky sloupcu: "1fr 2fr", "30% 70%", "200px 1fr" - jinak null. 2 az 4 hodnoty. */
export function safeColumnWidths(value: string | null | undefined): string | null {
    const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2 || parts.length > 4) return null;
    return parts.every((p) => /^(\d+(\.\d+)?(fr|%|px|rem|em)|auto)$/.test(p)) ? parts.join(" ") : null;
}
/**
 * Trida prvku ze stareho obsahu bez balastu z Wordu / Office Online / rozsireni prohlizece
 * (TextRun, SCXW123, BCX0, eJOY__...). Jen bezne nazvy trid, jinak null.
 */
export function safeClass(value: string | null | undefined): string | null {
    const cls = String(value || "").split(/\s+/)
        .filter((c) => /^[A-Za-z_][\w-]*$/.test(c) && !/^(TextRun|NormalTextRun|EOP|SpellingError|SCXW\d+|BCX\d+|Mso\w*|eJOY__\w*)$/.test(c));
    return cls.length ? cls.join(" ") : null;
}

/** Vybrane CSS vlastnosti z atributu style (jen bezne hodnoty bez url(), expression() apod.). */
function keepStyles(st: Record<string, string>, allowed: string[]): string | null {
    const out: Record<string, string> = {};
    for (const k of allowed) {
        const v = st[k];
        if (v && /^[\w\s.,%#()-]+$/.test(v) && !/(url|expression)\s*\(/i.test(v)) out[k] = v;
    }
    return styleString(out);
}

/**
 * Markup podle webu, kam se obsah uklada (nastavuje se pred vytvorenim editoru):
 *   configureMarkup({ video: { wrapperClass: "embed-responsive embed-responsive-16by9", iframeClass: "embed-responsive-item" } })
 * Video se rozpozna podle vychoziho i nastaveneho obalu, ulozi se s nastavenym.
 */
export interface MarkupOptions {
    video?: { wrapperClass?: string; iframeClass?: string | null };
    /** funkce webu povolene v odkazech (javascript:scrollToSelector('#map')) */
    jsActions?: string[];
}

const markup = {
    video: { wrapperClass: "video-container", iframeClass: null as string | null },
};

export function configureMarkup(o: MarkupOptions = {}): void {
    if (o.jsActions) setJsActions(o.jsActions);
    if (o.video) {
        markup.video.wrapperClass = o.video.wrapperClass || "video-container";
        markup.video.iframeClass = o.video.iframeClass ?? null;
    }
}

/** Pevne rozmery iframe videa (cisla v px nebo %), "100%" = vychozi. */
function iframeSize(f: HTMLElement): { width: string | null; height: string | null } {
    const v = (a: string) => {
        const x = (f.getAttribute(a) || "").trim();
        return /^\d+%?$/.test(x) && x !== "100%" ? x : null;
    };
    return { width: v("width"), height: v("height") };
}

function isVideoWrapper(el: HTMLElement): boolean {
    if (el.classList.contains("video-container")) return true;
    const cls = markup.video.wrapperClass.split(/\s+/).filter(Boolean);
    return cls.length > 0 && cls.every((c) => el.classList.contains(c));
}

/** Odsazeni odstavce: margin-left po 40 px (tak ho delal CKEditor). */
export const INDENT_STEP = 40;

function blockAttrsFromDom(el: HTMLElement): { align: string | null; indent: number } {
    const st = parseStyle(el.getAttribute("style"));
    const align = (st["text-align"] || "").toLowerCase();
    const ml = parseFloat(st["margin-left"] || "");
    const unit = (st["margin-left"] || "").replace(/[\d.\s-]/g, "");
    return {
        align: ALIGNS.includes(align) && align !== "left" ? align : null,
        indent: unit === "px" && ml > 0 ? Math.min(8, Math.round(ml / INDENT_STEP)) : 0,
    };
}

function blockStyle(node: PMNode): string | null {
    return styleString({
        "text-align": node.attrs.align,
        "margin-left": node.attrs.indent ? `${node.attrs.indent * INDENT_STEP}px` : null,
    });
}

const IMAGE_STYLES = ["float", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "max-width"];

function joinStyles(...parts: (string | null)[]): string | null {
    const s = parts.filter(Boolean).join(" ").trim();
    return s || null;
}

/** Delka pro sirku/vysku bunky: 120px, 30%, 10em - jinak null. */
function cssLength(v: string | null | undefined): string | null {
    const s = String(v || "").trim().toLowerCase();
    return /^\d+(\.\d+)?(px|%|em|rem)$/.test(s) ? s : null;
}

function withStyle(attrs: Record<string, string | null>, style: string | null): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== "") out[k] = v;
    if (style) out.style = style;
    return out;
}

/** Prvky, ktere v divu znamenaji blokovy obsah (div pak neni "jen text"). */
const BLOCK_TAGS = new Set(["DIV", "P", "UL", "OL", "LI", "TABLE", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "HR",
    "IFRAME", "FIGURE", "SECTION", "ARTICLE", "ASIDE", "NAV", "HEADER", "FOOTER", "FORM", "SCRIPT", "NOSCRIPT", "VIDEO", "AUDIO",
    "OBJECT", "EMBED", "CANVAS", "SVG", "DETAILS", "DL", "ADDRESS", "FIELDSET", "MAIN"]);

function hasOnlyInlineContent(el: HTMLElement): boolean {
    for (const ch of Array.from(el.children)) {
        if (BLOCK_TAGS.has(ch.tagName.toUpperCase())) return false;
    }
    return true;
}

function isWhitespaceOnly(el: HTMLElement): boolean {
    return el.children.length === 0 && (el.textContent || "").replace(/[\s\u00a0]/g, "") === "";
}

function hasClasses(el: HTMLElement, ...cls: string[]): boolean {
    return cls.every((c) => el.classList.contains(c));
}

// ---------------------------------------------------------------- uzly

const nodes: Record<string, NodeSpec> = {
    doc: { content: "block+" },

    paragraph: {
        content: "inline*",
        group: "block",
        attrs: { align: { default: null }, indent: { default: 0 } },
        parseDOM: [{ tag: "p", getAttrs: (dom) => blockAttrsFromDom(dom as HTMLElement) }],
        toDOM(node): DOMOutputSpec {
            return ["p", withStyle({}, blockStyle(node)), 0];
        },
    },

    heading: {
        content: "inline*",
        group: "block",
        defining: true,
        attrs: { level: { default: 2 }, align: { default: null }, indent: { default: 0 }, cls: { default: null } },
        parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
            tag: "h" + level,
            getAttrs: (dom: HTMLElement) => ({ level, ...blockAttrsFromDom(dom), cls: safeClass(dom.getAttribute("class")) }),
        })),
        toDOM(node): DOMOutputSpec {
            return ["h" + node.attrs.level, withStyle({ class: node.attrs.cls }, blockStyle(node)), 0];
        },
    },

    blockquote: {
        content: "block+",
        group: "block",
        defining: true,
        parseDOM: [{ tag: "blockquote" }],
        toDOM: () => ["blockquote", 0],
    },

    horizontal_rule: {
        group: "block",
        parseDOM: [{ tag: "hr" }],
        toDOM: () => ["hr"],
    },

    code_block: {
        content: "text*",
        marks: "",
        group: "block",
        code: true,
        defining: true,
        parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
        toDOM: () => ["pre", ["code", 0]],
    },

    /** Blok s tlacitkem: <div class="flex f-jc-center"><a class="btn medium" ...>Text</a></div> */
    button: {
        group: "block",
        atom: true,
        selectable: true,
        draggable: true,
        attrs: {
            text: { default: "Chci nezávaznou nabídku" },
            href: { default: CONTACT_FORM_ACTION },
            variant: { default: "medium" },
            target: { default: null },
        },
        parseDOM: [{
            tag: "div",
            priority: 60,
            getAttrs(dom) {
                const el = dom as HTMLElement;
                if (!hasClasses(el, "flex", "f-jc-center")) return false;
                const a = el.firstElementChild;
                if (!a || el.children.length !== 1 || !a.matches("a.btn")) return false;
                const variant = Array.from(a.classList).filter((c) => c !== "btn").join(" ") || "medium";
                return {
                    text: (a.textContent || "").trim(),
                    href: safeHref(a.getAttribute("href")),
                    variant,
                    target: a.getAttribute("target"),
                };
            },
        }],
        toDOM(node): DOMOutputSpec {
            const a = withStyle({
                class: ("btn " + (node.attrs.variant || "medium")).trim(),
                href: safeHref(node.attrs.href) || "#",
                role: "button",
                target: node.attrs.target,
                rel: node.attrs.target === "_blank" ? "noopener" : null,
            }, null);
            return ["div", { class: "flex f-jc-center" }, ["a", a, node.attrs.text || ""]];
        },
    },

    /** Prazdna mezera, kterou CKEditor nechaval po tlacitkach: <div class="flex f-jc-center">&nbsp;</div> */
    spacer: {
        group: "block",
        atom: true,
        selectable: true,
        draggable: true,
        parseDOM: [{
            tag: "div",
            priority: 65,
            getAttrs: (dom) => (hasClasses(dom as HTMLElement, "flex", "f-jc-center") && isWhitespaceOnly(dom as HTMLElement) ? {} : false),
        }],
        toDOM: () => ["div", { class: "flex f-jc-center" }, "\u00a0"],
    },

    /** YouTube video: <div class="video-container"><iframe src=".../embed/ID"></iframe></div> */
    video: {
        group: "block",
        atom: true,
        selectable: true,
        draggable: true,
        // width/height = pevne rozmery ze stareho obsahu (iframe width="410"), jinak 100 % obalu
        attrs: { src: { default: "" }, title: { default: "YouTube video player" }, width: { default: null }, height: { default: null } },
        parseDOM: [
            {
                tag: "div",
                priority: 60,
                getAttrs(dom) {
                    const el = dom as HTMLElement;
                    if (!isVideoWrapper(el) || el.children.length !== 1) return false;
                    const f = el.querySelector("iframe");
                    const src = youtubeEmbed(f?.getAttribute("src"));
                    return f && src ? { src, title: f.getAttribute("title") || "YouTube video player", ...iframeSize(f) } : false;
                },
            },
            {
                tag: "iframe",
                getAttrs(dom) {
                    const src = youtubeEmbed((dom as HTMLElement).getAttribute("src"));
                    return src ? { src, title: (dom as HTMLElement).getAttribute("title") || "YouTube video player", ...iframeSize(dom as HTMLElement) } : false;
                },
            },
        ],
        toDOM(node): DOMOutputSpec {
            return ["div", { class: markup.video.wrapperClass }, ["iframe", {
                ...(markup.video.iframeClass ? { class: markup.video.iframeClass } : {}),
                allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
                allowfullscreen: "",
                frameborder: "0",
                height: node.attrs.height || "100%",
                src: youtubeEmbed(node.attrs.src),
                title: node.attrs.title || "YouTube video player",
                width: node.attrs.width || "100%",
            }]];
        },
    },

    /**
     * Kontejner = div s vlastni tridou/stylem (layout webu: "flex mobile-f-column",
     * "specialist-box"...). Obal zustane presne, obsah uvnitr se edituje normalne.
     */
    container: {
        group: "block",
        content: "block+",
        defining: true,
        draggable: true,
        attrs: { cls: { default: null }, style: { default: null }, id: { default: null } },
        parseDOM: [{
            tag: "div",
            priority: 40,
            getAttrs(dom) {
                const el = dom as HTMLElement;
                const st = parseStyle(el.getAttribute("style"));
                if (st["page-break-after"] || st["page-break-before"]) return false; // zlom stranky z Wordu
                // i obycejny <div> bez trid - obal v layoutu webu (div.payment-line > div), web s nim pocita
                return { cls: el.getAttribute("class"), style: el.getAttribute("style"), id: el.id || null };
            },
        }],
        toDOM(node): DOMOutputSpec {
            return ["div", withStyle({ class: node.attrs.cls, id: node.attrs.id }, node.attrs.style), 0];
        },
    },

    /**
     * Div jen s textem (bez bloku uvnitr): <div class="small-text">Text <strong>...</strong></div>.
     * Zustane div s textem - bez <p> uvnitr (jinak by se zmenilo rozlozeni webu, napr. polozky ceniku).
     */
    textbox: {
        group: "block",
        content: "inline*",
        defining: true,
        attrs: { cls: { default: null }, style: { default: null }, id: { default: null } },
        parseDOM: [{
            tag: "div",
            priority: 45,
            getAttrs(dom) {
                const el = dom as HTMLElement;
                const st = parseStyle(el.getAttribute("style"));
                if (st["page-break-after"] || st["page-break-before"]) return false;
                if (!hasOnlyInlineContent(el)) return false;
                return { cls: el.getAttribute("class"), style: el.getAttribute("style"), id: el.id || null };
            },
        }],
        toDOM(node): DOMOutputSpec {
            return ["div", withStyle({ class: node.attrs.cls, id: node.attrs.id }, node.attrs.style), 0];
        },
    },

    /**
     * Sloupce: <div class="cms-cols cms-cols-1-2 cms-gap-l cms-va-center cms-m-rev"><div class="cms-col">...</div>...</div>
     * Rozvrzeni a chovani urcuji tridy (styly webu: global/pages, .cms-cols), vlastni sirky
     * promenna --cms-cols ve stylu. Na mobilu pod sebe (cms-m-keep = vedle sebe, cms-m-rev = obracene).
     */
    columns: {
        group: "block",
        content: "column+",
        defining: true,
        draggable: true,
        attrs: { layout: { default: "2" }, widths: { default: null }, gap: { default: null }, valign: { default: null }, mobile: { default: null } },
        parseDOM: [{
            tag: "div",
            priority: 70,
            getAttrs(dom) {
                const el = dom as HTMLElement;
                if (!el.classList.contains("cms-cols")) return false;
                const cls = Array.from(el.classList);
                const pick = (prefix: string, allowed: string[]) => {
                    const c = cls.find((x) => x.startsWith(prefix) && allowed.includes(x.slice(prefix.length)));
                    return c ? c.slice(prefix.length) : null;
                };
                const widths = safeColumnWidths(parseStyle(el.getAttribute("style"))["--cms-cols"] || null);
                return {
                    layout: widths ? "custom" : (pick("cms-cols-", COLUMN_LAYOUTS) || "2"),
                    widths,
                    gap: pick("cms-gap-", ["0", "s", "l"]),
                    valign: pick("cms-va-", ["center", "end", "stretch"]),
                    mobile: pick("cms-m-", ["keep", "rev"]),
                };
            },
        }],
        toDOM(node): DOMOutputSpec {
            const a = node.attrs;
            const custom = a.layout === "custom" && safeColumnWidths(a.widths);
            const cls = ["cms-cols", custom ? "cms-cols-custom" : "cms-cols-" + (a.layout || "2"),
                a.gap && "cms-gap-" + a.gap, a.valign && "cms-va-" + a.valign, a.mobile && "cms-m-" + a.mobile].filter(Boolean).join(" ");
            return ["div", withStyle({ class: cls }, custom ? `--cms-cols: ${custom};` : null), 0];
        },
    },

    column: {
        content: "block+",
        isolating: true,
        parseDOM: [{ tag: "div.cms-col", context: "columns/" }],
        toDOM: (): DOMOutputSpec => ["div", { class: "cms-col" }, 0],
    },

    /**
     * HTML blok - cokoli, co schema nezna, zustane presne tak, jak bylo.
     * Z vlozeneho obsahu (schranka) se nevytvari - viz pasteParser v html.ts.
     */
    rawhtml: {
        group: "block",
        atom: true,
        selectable: true,
        draggable: true,
        attrs: { html: { default: "" } },
        parseDOM: [
            ...["script", "form", "object", "embed", "noscript", "svg", "canvas", "audio", "video", "button", "input", "select", "textarea", "details", "figure", "section", "article", "aside", "nav", "header", "footer"].map((tag) => ({
                tag,
                priority: 40,
                getAttrs: (dom: HTMLElement) => ({ html: dom.outerHTML }),
            })),
            {
                // iframe, ktery neni YouTube (mapa, formular...)
                tag: "iframe",
                priority: 40,
                getAttrs: (dom: HTMLElement) => ({ html: dom.outerHTML }),
            },
        ],
        toDOM(node): DOMOutputSpec {
            // inertni dokument - stejny jako pri parsovani a ukladani (jinak se rozbije <noscript>)
            const tpl = inertDocument().createElement("template");
            tpl.innerHTML = node.attrs.html;
            const els = Array.from(tpl.content.childNodes).filter((n) => n.nodeType !== 3 || (n.textContent || "").trim() !== "");
            if (els.length === 1 && els[0].nodeType === 1) return els[0] as unknown as DOMOutputSpec;
            // vic korenu - zabalit (vznika jen rucnim zapisem vice prvku do jednoho HTML bloku);
            // obal v inertnim dokumentu sablony - v dokumentu stranky by se obsah zacal nacitat
            const wrap = tpl.content.ownerDocument.createElement("div");
            wrap.append(...Array.from(tpl.content.childNodes));
            return wrap as unknown as DOMOutputSpec;
        },
    },

    text: { group: "inline" },

    hard_break: {
        inline: true,
        group: "inline",
        selectable: false,
        parseDOM: [{ tag: "br" }],
        toDOM: () => ["br"],
    },

    /**
     * Promenna webu ({$ig_post:"kod"}, {$specialist}...). V HTML je to obycejny text,
     * editor ho pri nacteni prevede na uzel (cip) - viz tokenizeVariables v html.ts.
     */
    variable: {
        inline: true,
        group: "inline",
        atom: true,
        selectable: true,
        draggable: true,
        attrs: { name: { default: "" }, args: { default: null } },
        // znacka jen pro schranku; serializeHTML ji rozbali na cisty text
        parseDOM: [{
            tag: "span[data-ce-var]",
            getAttrs(dom) {
                const m = ((dom as HTMLElement).textContent || "").match(varRegExp(""));
                return m && m[0] === (dom as HTMLElement).textContent ? { name: m[1], args: m[2] === undefined ? null : m[2] } : false;
            },
        }],
        toDOM: (node): DOMOutputSpec => ["span", { "data-ce-var": "" }, varText(node.attrs.name, node.attrs.args)],
        leafText: (node) => varText(node.attrs.name, node.attrs.args),
    },

    /** Obrazek - inline jako v CKEditoru (typicky sam v odstavci: <p><img ...></p>). */
    image: {
        inline: true,
        group: "inline",
        draggable: true,
        attrs: {
            src: { default: "" },
            alt: { default: "" },
            title: { default: null },
            cls: { default: "img-responsive" },
            width: { default: null },
            height: { default: null },
            /** obtekani a okraje ze stareho obsahu: float, margin*, max-width */
            style: { default: null },
        },
        parseDOM: [{
            tag: "img[src]",
            getAttrs(dom) {
                const el = dom as HTMLElement;
                const src = safeSrc(el.getAttribute("src"));
                if (!src) return false;
                const st = parseStyle(el.getAttribute("style"));
                return {
                    src,
                    alt: el.getAttribute("alt") || "",
                    title: el.getAttribute("title"),
                    cls: el.getAttribute("class"),
                    width: st.width || (el.getAttribute("width") ? el.getAttribute("width") + "px" : null),
                    height: st.height || (el.getAttribute("height") ? el.getAttribute("height") + "px" : null),
                    style: keepStyles(st, IMAGE_STYLES),
                };
            },
        }],
        toDOM(node): DOMOutputSpec {
            const a = node.attrs;
            const attrs = withStyle({
                class: a.cls,
                src: safeSrc(a.src),
                title: a.title,
            }, joinStyles(styleString({ width: a.width, height: a.height }), a.style));
            // alt vzdy (i prazdny) - dekorativni obrazek ma mit alt=""
            return ["img", { alt: a.alt ?? "", ...attrs }];
        },
    },
};

// ---------------------------------------------------------------- znacky (formatovani textu)

const marks: Record<string, MarkSpec> = {
    link: {
        // cls/style: odkazy stylovane jako tlacitko primo v textu ("btn-basic btn-main")
        attrs: {
            href: { default: "" }, target: { default: null }, rel: { default: null }, title: { default: null },
            cls: { default: null }, style: { default: null },
        },
        inclusive: false,
        parseDOM: [{
            tag: "a[href]",
            getAttrs(dom) {
                const el = dom as HTMLElement;
                const href = safeHref(el.getAttribute("href"));
                if (!href) return false;
                return {
                    href,
                    target: el.getAttribute("target"),
                    rel: el.getAttribute("rel"),
                    title: el.getAttribute("title"),
                    cls: el.getAttribute("class"),
                    style: el.getAttribute("style"),
                };
            },
        }],
        toDOM(mark): DOMOutputSpec {
            return ["a", withStyle({
                class: mark.attrs.cls,
                href: safeHref(mark.attrs.href) || "#",
                target: mark.attrs.target,
                rel: mark.attrs.rel,
                title: mark.attrs.title,
            }, mark.attrs.style), 0];
        },
    },
    strong: {
        parseDOM: [
            { tag: "strong" },
            // Google Docs obaluje cely obsah do <b style="font-weight:normal">
            { tag: "b", getAttrs: (dom) => ((dom as HTMLElement).style.fontWeight !== "normal" && null) },
            { style: "font-weight", getAttrs: (v) => (/^(bold(er)?|[6-9]\d\d)$/.test(v as string) && null) },
        ],
        toDOM: () => ["strong", 0],
    },
    em: {
        parseDOM: [{ tag: "em" }, { tag: "i" }, { style: "font-style=italic" }],
        toDOM: () => ["em", 0],
    },
    underline: {
        parseDOM: [{ tag: "u" }],
        toDOM: () => ["u", 0],
    },
    strike: {
        parseDOM: [{ tag: "s" }, { tag: "del" }, { tag: "strike" }],
        toDOM: () => ["s", 0],
    },
    sup: {
        excludes: "sub",
        parseDOM: [{ tag: "sup" }],
        toDOM: () => ["sup", 0],
    },
    sub: {
        excludes: "sup",
        parseDOM: [{ tag: "sub" }],
        toDOM: () => ["sub", 0],
    },
    code: {
        parseDOM: [{ tag: "code" }],
        toDOM: () => ["code", 0],
    },

    /**
     * Zamerna barva / zvyrazneni / velikost pisma ze stareho obsahu (<span style>).
     * Vychozi hodnoty z Wordu a Google Docs (cerny text, bile pozadi, 11pt, fonty)
     * se zahazuji - zustane jen to, co bylo na webu videt jako zvlastni formatovani.
     */
    textstyle: {
        attrs: { color: { default: null }, background: { default: null }, size: { default: null } },
        parseDOM: [{
            tag: "span[style]",
            consuming: false,
            getAttrs(dom) {
                const st = parseStyle((dom as HTMLElement).getAttribute("style"));
                const color = keepColor(st.color, DEFAULT_TEXT_COLORS);
                const background = keepColor(st["background-color"] || st.background, DEFAULT_BG_COLORS);
                const size = keepSize(st["font-size"]);
                return color || background || size ? { color, background, size } : false;
            },
        }],
        toDOM(mark): DOMOutputSpec {
            return ["span", { style: styleString({ color: mark.attrs.color, "background-color": mark.attrs.background, "font-size": mark.attrs.size }) || "" }, 0];
        },
    },
};

/** Vlastni styl webu na casti textu: <span class="big-text">. Muze byt spolu s textstyle. */
marks.spanclass = {
    attrs: { cls: { default: null } },
    parseDOM: [{
        tag: "span[class]",
        consuming: false,
        getAttrs(dom) {
            const el = dom as HTMLElement;
            if (el.hasAttribute("data-ce-var")) return false;
            const cls = safeClass(el.getAttribute("class"));
            return cls ? { cls } : false;
        },
    }],
    toDOM: (mark): DOMOutputSpec => ["span", { class: mark.attrs.cls }, 0],
};

const DEFAULT_TEXT_COLORS = ["black", "#000", "#000000", "rgb(0,0,0)", "windowtext", "inherit", "initial", "currentcolor", "#0e101a", "rgb(14,16,26)"];
const DEFAULT_BG_COLORS = ["white", "#fff", "#ffffff", "rgb(255,255,255)", "transparent", "inherit", "initial", "none"];
/** Velikost pisma, ktera neni vychozi (11-12pt z Wordu/Docs, 16px, 100 %). Normalizovany zapis ("12.0pt" -> "12pt"). */
function keepSize(value: string | undefined): string | null {
    const m = (value || "").trim().toLowerCase().match(/^([\d.]+)\s*(px|pt|em|rem|%)$/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    const unit = m[2];
    if ((unit === "pt" && (n === 11 || n === 12)) || (unit === "px" && n === 16) || ((unit === "em" || unit === "rem") && n === 1) || (unit === "%" && n === 100)) return null;
    return `${+n.toFixed(2)}${unit}`;
}

function keepColor(value: string | undefined, defaults: string[]): string | null {
    if (!value) return null;
    const v = value.trim();
    const norm = v.replace(/\s+/g, "").toLowerCase();
    if (defaults.includes(norm)) return null;
    // jen bezne zapisy barev (zadne url(), expression() apod.)
    return /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\)|hsla?\([\d.,\s%deg]+\)|[a-z]+)$/i.test(v) ? v : null;
}

// ---------------------------------------------------------------- tabulky

/** Barva z CSS (#hex, rgb(), rgba()) - jinak null (zadne url(), expression...). */
export function safeCssColor(v: string | null | undefined): string | null {
    const s = String(v || "").trim().toLowerCase();
    if (/^#[0-9a-f]{3,8}$/.test(s)) return s;
    // pojmenovane barvy ze stareho obsahu (bgcolor="yellow")
    if (/^[a-z]{3,20}$/.test(s) && !["inherit", "initial", "unset", "transparent", "currentcolor", "none"].includes(s)) return s;
    if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+))?\s*\)$/.test(s)) return s.replace(/\s+/g, "");
    return null;
}

/** Ohraniceni bunky: "none" nebo "<sirka>px solid|dashed|dotted <barva>" - jinak null. */
export function safeBorder(v: string | null | undefined): string | null {
    const s = String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (s === "none" || s === "0" || s === "0px") return "none";
    const m = /^(\d{1,2}(?:\.\d+)?px) (solid|dashed|dotted|double) (.+)$/.exec(s);
    if (!m) return null;
    const color = safeCssColor(m[3]);
    return color ? `${m[1]} ${m[2]} ${color}` : null;
}

function addStyle(attrs: Record<string, unknown>, css: string): void {
    attrs.style = String(attrs.style || "") + css;
}

// vlastnosti bunky (Vlastnosti bunky v nabidce tabulky) - ukladaji se jako styly, web je zobrazi sam
const tNodes = tableNodes({
    tableGroup: "block",
    cellContent: "block+",
    cellAttributes: {
        // hodnoty ze surovy stylu (dom.style.border vraci pro "none" prazdny retezec a barvy prevadi na rgb)
        background: {
            default: null,
            getFromDOM: (dom) => safeCssColor(parseStyle(dom.getAttribute("style"))["background-color"] || parseStyle(dom.getAttribute("style")).background || dom.getAttribute("bgcolor")),
            setDOMAttr: (v, attrs) => { if (v) addStyle(attrs, `background-color: ${v};`); },
        },
        align: {
            default: null,
            getFromDOM: (dom) => {
                const a = (parseStyle(dom.getAttribute("style"))["text-align"] || dom.getAttribute("align") || "").toLowerCase();
                // left jen kdyz je vyslovne (u th je vychozi na stred)
                return ["left", "center", "right", "justify"].includes(a) ? a : null;
            },
            setDOMAttr: (v, attrs) => { if (v) addStyle(attrs, `text-align: ${v};`); },
        },
        valign: {
            default: null,
            getFromDOM: (dom) => {
                const a = (parseStyle(dom.getAttribute("style"))["vertical-align"] || dom.getAttribute("valign") || "").toLowerCase();
                return ["top", "middle", "bottom"].includes(a) ? a : null;
            },
            setDOMAttr: (v, attrs) => { if (v) addStyle(attrs, `vertical-align: ${v};`); },
        },
        width: {
            default: null,
            getFromDOM: (dom) => cssLength(parseStyle(dom.getAttribute("style")).width || (dom.getAttribute("width") ? dom.getAttribute("width") + "px" : null)),
            setDOMAttr: (v, attrs) => { if (v) addStyle(attrs, `width: ${v};`); },
        },
        height: {
            default: null,
            getFromDOM: (dom) => cssLength(parseStyle(dom.getAttribute("style")).height || (dom.getAttribute("height") ? dom.getAttribute("height") + "px" : null)),
            setDOMAttr: (v, attrs) => { if (v) addStyle(attrs, `height: ${v};`); },
        },
        border: {
            default: null,
            // "bez ohraniceni" jako border-style: none - zkratku "border: none" prohlizec pri zapisu stylu
            // (ProseMirror pres cssText) rozepise na dlouhe vlastnosti a pri dalsim nacteni by se ztratila
            getFromDOM: (dom) => {
                const st = parseStyle(dom.getAttribute("style"));
                if (st.border) return safeBorder(st.border);
                if ((st["border-style"] || "").toLowerCase() === "none") return "none";
                const w = st["border-width"], s = st["border-style"], c = st["border-color"];
                return w && s && c ? safeBorder(`${w} ${s} ${c}`) : null;
            },
            setDOMAttr: (v, attrs) => { if (v) addStyle(attrs, v === "none" ? "border-style: none;" : `border: ${v};`); },
        },
    },
});

/** Zarovnani tabulky na strance: na stred / vpravo pres okraje (bez float - text tabulku neobteka). */
function tableAlignFromStyle(st: Record<string, string>): string | null {
    const l = (st["margin-left"] || "").toLowerCase();
    const r = (st["margin-right"] || "").toLowerCase();
    if (l === "auto" && r === "auto") return "center";
    if (l === "auto") return "right";
    return null;
}

// tabulka si drzi tridu (img-responsive), sirku a atributy z CKEditoru
tNodes.table = {
    ...tNodes.table,
    attrs: {
        cls: { default: null },
        width: { default: null },
        align: { default: null },
        border: { default: "1" },
        cellpadding: { default: "1" },
        cellspacing: { default: "1" },
    },
    parseDOM: [{
        tag: "table",
        getAttrs(dom) {
            const el = dom as HTMLElement;
            const st = parseStyle(el.getAttribute("style"));
            return {
                cls: el.getAttribute("class"),
                width: st.width || null,
                // atribut align="center" psal dialog tabulky v CKEditoru 4
                align: tableAlignFromStyle(st) ?? (["center", "right"].includes((el.getAttribute("align") || "").toLowerCase()) ? (el.getAttribute("align") || "").toLowerCase() : null),
                border: el.getAttribute("border"),
                cellpadding: el.getAttribute("cellpadding"),
                cellspacing: el.getAttribute("cellspacing"),
            };
        },
    }],
    toDOM(node): DOMOutputSpec {
        const a = node.attrs;
        return ["table", withStyle({
            border: a.border, cellpadding: a.cellpadding, cellspacing: a.cellspacing, class: a.cls,
        }, styleString({
            width: a.width,
            "margin-left": a.align === "center" || a.align === "right" ? "auto" : null,
            "margin-right": a.align === "center" ? "auto" : null,
        })), ["tbody", 0]];
    },
};

// ---------------------------------------------------------------- schema

const base = new Schema({ nodes, marks });

// seznamy: prazdne <ul></ul> / <ol></ol> (v obsahu se vyskytuji) zahodit - jinak by
// z nich ProseMirror udelal seznam s prazdnou odrazkou
let nodeSpecs = addListNodes(base.spec.nodes, "paragraph block*", "block");
for (const name of ["bullet_list", "ordered_list"]) {
    const spec = nodeSpecs.get(name)!;
    nodeSpecs = nodeSpecs.update(name, {
        ...spec,
        parseDOM: (spec.parseDOM || []).map((rule) => ({
            ...rule,
            getAttrs(dom: HTMLElement) {
                if (!dom.querySelector("li")) return false;
                const orig = rule.getAttrs ? rule.getAttrs(dom) : null;
                return orig === undefined ? null : orig;
            },
        })),
    });
}

// trida seznamu (vlastni odrazky webu: "blue-dots", "colored-dots") a typ odrazky, trida polozky
for (const name of ["bullet_list", "ordered_list"]) {
    const spec = nodeSpecs.get(name)!;
    const tag = name === "bullet_list" ? "ul" : "ol";
    nodeSpecs = nodeSpecs.update(name, {
        ...spec,
        attrs: { ...(spec.attrs || {}), cls: { default: null }, style: { default: null } },
        parseDOM: (spec.parseDOM || []).map((rule) => ({
            ...rule,
            getAttrs(dom: HTMLElement) {
                const orig = rule.getAttrs ? rule.getAttrs(dom) : null;
                if (orig === false) return false;
                return { ...(orig || {}), cls: safeClass(dom.getAttribute("class")), style: keepStyles(parseStyle(dom.getAttribute("style")), ["list-style-type"]) };
            },
        })),
        toDOM(node: PMNode): DOMOutputSpec {
            const attrs: Record<string, string | null> = { class: node.attrs.cls };
            if (name === "ordered_list" && node.attrs.order !== 1) attrs.start = String(node.attrs.order);
            return [tag, withStyle(attrs, node.attrs.style), 0];
        },
    });
}
{
    const spec = nodeSpecs.get("list_item")!;
    nodeSpecs = nodeSpecs.update("list_item", {
        ...spec,
        attrs: { ...(spec.attrs || {}), cls: { default: null } },
        parseDOM: [{ tag: "li", getAttrs: (dom: HTMLElement) => ({ cls: safeClass(dom.getAttribute("class")) }) }],
        toDOM: (node: PMNode): DOMOutputSpec => ["li", withStyle({ class: node.attrs.cls }, null), 0],
    });
}

export const schema = new Schema({
    nodes: nodeSpecs.append(tNodes as Record<string, NodeSpec>),
    marks: base.spec.marks,
});

export type NodeName = keyof typeof nodes | "bullet_list" | "ordered_list" | "list_item" | "table" | "table_row" | "table_cell" | "table_header";

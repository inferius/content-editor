/**
 * Cisteni HTML vlozeneho z Wordu (desktop i online), Excelu, Google Docs a Google Sheets.
 *
 * Zachova: nadpisy (o uroven niz - Nadpis 1 z Wordu = H2, H1 je na webu titulek), odstavce,
 * tucne / kurzivu / podtrzeni / preskrtnuti / horni a dolni index, odkazy, seznamy (Wordove
 * "odstavce s odrazkou" -> skutecne ul / ol vcetne vnoreni), citace, tabulky (bez stylu),
 * zarovnani na stred / vpravo a barvy textu blizke palete editoru (prevedou se na ni).
 * Zahodi: tridy, styly, fonty, velikosti, mso-*, komentare a revize, <o:p>, prazdne odstavce,
 * zvyrazneni pozadi, sede a cerne barvy.
 *
 * Obrazky: Word je v HTML odkazuje na docasne soubory na disku (file:///...clip_image001.png),
 * ktere prohlizec nenacte - skutecna data jsou v RTF verzi schranky (extractRtfImages). Kdyz
 * je editor preda (localImages, data: URL ve stejnem poradi), obrazky zustanou; obrazky z webu
 * (Google Docs, Word online - docasne URL jejich serveru) zustanou s puvodni adresou, kdyz
 * remoteImages. Editor je pak nahraje / stahne do knihovny (vysledek: images).
 *
 * Vystup obsahuje jen povolene znacky - barva je <span data-ce-color>, kterou cte pasteParser.
 */

export type OfficeSource = "word" | "word-online" | "excel" | "gdocs" | "gsheets";

export interface OfficeCleanOptions {
    /** Barvy palety (#rrggbb). Prazdne = barvy zahodit. */
    palette: string[];
    /** Povolene urovne nadpisu. Prazdne = nadpisy jako odstavce. */
    headings: number[];
    /** Obrazky z RTF schranky (data: URL, null = format, ktery prohlizec neumi - EMF/WMF) v poradi dokumentu. */
    localImages?: Array<string | null>;
    /** Ponechat obrazky s http(s) adresou (editor je pak stahne na server). */
    remoteImages?: boolean;
    /** Obrazky vubec ponechat (pole bez obrazku / bez nahravani = vsechny vynechat). Vychozi ano. */
    keepImages?: boolean;
    doc?: Document;
}

/** Obrazek ve vystupu, ktery je potreba nahrat / stahnout do knihovny. */
export interface PastedImage {
    /** Docasna adresa ve vlozenem obsahu (data: URL nebo cizi http(s) URL). */
    src: string;
    kind: "data" | "remote";
    alt: string;
}

export interface OfficeCleanResult {
    html: string;
    source: OfficeSource;
    droppedImages: number;
    /** Obrazky k nahrani (viz PastedImage). */
    images: PastedImage[];
    /** Obrazky z Wordu se nepodarilo sparovat s daty v RTF (pocet nesedi) - byly vynechany. */
    unmatchedLocal: boolean;
}

export function detectOffice(html: string): OfficeSource | null {
    // kopirovani uvnitr editoru (ProseMirror) - i kdyz stary obsah obsahuje styly z Wordu
    if (/\bdata-pm-slice=/.test(html)) return null;
    if (/id=["']?docs-internal-guid-/i.test(html)) return "gdocs";
    if (/<google-sheets-html-origin|data-sheets-value=/i.test(html)) return "gsheets";
    if (/urn:schemas-microsoft-com:office:excel|<meta[^>]+content=["']?Excel.Sheet/i.test(html)) return "excel";
    if (/class=["'][^"']*\b(TextRun|NormalTextRun|OutlineElement|ListContainerWrapper)\b/.test(html) || /\bdata-contrast=/.test(html)) return "word-online";
    if (/urn:schemas-microsoft-com:office:(word|office)|<meta[^>]+content=["']?Microsoft Word|class=["']?Mso[A-Z]|style=["'][^"']*\bmso-[a-z-]+\s*:/i.test(html)) return "word";
    return null;
}

/** Vycisti HTML z Office; null = obsah neni z Office (vlozi se beze zmeny). */
export function cleanOfficeHTML(html: string, o: OfficeCleanOptions): OfficeCleanResult | null {
    const source = detectOffice(html);
    if (!source) return null;
    const d = o.doc ?? document;
    const Parser = (d.defaultView as (Window & typeof globalThis) | null)?.DOMParser ?? DOMParser;
    const parsed = new Parser().parseFromString(html, "text/html");
    const cleaner = new Cleaner(d, o, classStyles(parsed));
    markBlockAncestors(parsed.body);
    cleaner.matchLocal(parsed);
    const out = cleaner.blocks(parsed.body);
    const wrap = d.createElement("div");
    wrap.append(...out);
    return { html: wrap.innerHTML, source, droppedImages: cleaner.droppedImages, images: cleaner.images, unmatchedLocal: cleaner.unmatchedLocal };
}

// ------------------------------------------------------------------ interni

/** Prvky, ktere se zahodi i s obsahem. */
const DROP = new Set([
    "script", "style", "meta", "link", "title", "head", "xml", "noscript", "template", "iframe", "object", "embed",
    "svg", "math", "form", "input", "button", "select", "textarea", "o:p", "w:sdt", "w:sdtpr",
]);
/** Obalove bloky - jen jejich obsah. */
const WRAPPERS = new Set(["div", "section", "article", "header", "footer", "main", "aside", "nav", "center", "body", "html", "figure", "dl"]);
const BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "table", "ul", "ol", "li", "pre", "hr", "dt", "dd", "figcaption", "address"]);
/** Prvky, ktere maji nekde uvnitr blok (viz markBlockAncestors). */
let blockAncestors = new WeakSet<Element>();

/**
 * Oznaci predky vsech bloku (odstavec, tabulka, seznam, obal) jednim pruchodem dokumentu.
 * Podle presneho nazvu prvku - selektor "p" v querySelector chyta i Wordovy <o:p>.
 */
function markBlockAncestors(root: Element): void {
    blockAncestors = new WeakSet<Element>();
    const all = root.getElementsByTagName("*");
    for (let i = 0; i < all.length; i++) {
        const t = all[i].nodeName.toLowerCase();
        if (t === "li" || !(BLOCKS.has(t) || (WRAPPERS.has(t) && t !== "center"))) continue;
        for (let p = all[i].parentElement; p && !blockAncestors.has(p); p = p.parentElement) blockAncestors.add(p);
    }
}

/** Je uvnitr blok? (po markBlockAncestors) */
function hasBlockInside(e: Element): boolean {
    return blockAncestors.has(e);
}

/** indent = levy okraj odstavce Wordu v pt (odsazena odrazka bez zmeny urovne seznamu). */
interface ListItem { ordered: boolean; level: number; content: Node[]; indent?: number | null; listId?: string }
interface InlineCtx { heading: boolean; link?: boolean }

function tag(n: Element): string {
    return n.nodeName.toLowerCase();
}

function styleOf(el: Element): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of (el.getAttribute("style") || "").split(";")) {
        const i = part.indexOf(":");
        if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim().toLowerCase();
    }
    return out;
}

function hasClass(el: Element, re: RegExp): boolean {
    return re.test(el.getAttribute("class") || "");
}

class Cleaner {
    droppedImages = 0;
    /** Hloubka vnoreni radkoveho obsahu (ochrana pred pretecenim zasobniku). */
    private depth = 0;
    images: PastedImage[] = [];
    unmatchedLocal = false;
    /** Data obrazku z RTF pro obrazky s file:// adresou (sparovane podle poradi v dokumentu). */
    private local = new Map<Element, string>();
    private palette: Array<{ hex: string; rgb: [number, number, number] }>;

    constructor(private d: Document, private o: OfficeCleanOptions, private classes: Map<string, Record<string, string>>) {
        // jen barevne polozky palety (seda se z Wordu nepreviadi - sedy text v sablonach neni zvyrazneni)
        this.palette = o.palette
            .map((hex) => ({ hex, rgb: parseColor(hex) }))
            .filter((c): c is { hex: string; rgb: [number, number, number] } => !!c.rgb && saturation(c.rgb) >= 0.15);
    }

    /**
     * Sparovani obrazku Wordu (file://) s daty z RTF. RTF obsahuje vsechny obrazky dokumentu
     * v poradi - i ty, ktere ma HTML rovnou jako data: (obrazky v textu), file:// mivaji jen
     * obtekane. Paruje se podle poradi vsech obrazku; kdyz pocet nesedi ani tak, zkusi se jen
     * file:// obrazky, jinak nic (obrazky by se mohly prehazet).
     */
    matchLocal(root: Document): void {
        const all = Array.from(root.querySelectorAll("img"));
        if (!all.some((i) => /^file:/i.test(i.getAttribute("src") || ""))) return;
        const data = this.o.localImages;
        // RTF ma kazdy obrazek dokumentu (i ty, ktere HTML dava jako data:) v poradi -
        // pocet musi sedet presne, jinak by mohl obrazek dostat cizi data
        if (data && data.length === all.length) {
            all.forEach((img, i) => {
                const d = data[i];
                if (d && /^file:/i.test(img.getAttribute("src") || "")) this.local.set(img, d);
            });
        }
        else if (data) this.unmatchedLocal = true;
    }

    /** Styl prvku: tridy z <style> ve schrance (Excel tak uklada tucne / barvy bunek) + inline. */
    private style(el: Element): Record<string, string> {
        const cls = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean);
        if (!cls.length || !this.classes.size) return styleOf(el);
        const out: Record<string, string> = {};
        for (const c of cls) Object.assign(out, this.classes.get(c.toLowerCase()));
        return Object.assign(out, styleOf(el));
    }

    private el(name: string, attrs: Record<string, string> = {}, children: Node[] = []): HTMLElement {
        const e = this.d.createElement(name);
        for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
        e.append(...children);
        return e;
    }

    /** Ma se prvek zahodit i s obsahem? */
    private dropped(n: Element): boolean {
        const t = tag(n);
        if (DROP.has(t) || /^(v|w|m|o):/.test(t)) return true;
        const st = this.style(n);
        if (st["mso-list"] === "ignore" || st["display"] === "none" || st["mso-hide"] === "all") return true;
        if (/mso-element:\s*(comment-list|comment)/.test(n.getAttribute("style") || "")) return true;
        if (hasClass(n, /\b(MsoCommentReference|msoDel|EOP)\b/)) return true;
        if (t === "del" && hasClass(n, /msoDel/)) return true;
        return false;
    }

    // ---------------------------------------------------------- bloky

    blocks(root: Node): Node[] {
        const st = { out: [] as Node[], inline: [] as Node[], items: [] as ListItem[], quote: null as HTMLElement | null };
        this.walk(root, st);
        this.flushInline(st);
        this.flushItems(st);
        return st.out;
    }

    private walk(parent: Node, st: { out: Node[]; inline: Node[]; items: ListItem[]; quote: HTMLElement | null }): void {
        for (const n of Array.from(parent.childNodes)) {
            if (n.nodeType === 3) {
                // mezery a konce radku mezi bloky
                if (!st.inline.length && !(n.textContent || "").trim()) continue;
                if (st.items.length && (n.textContent || "").trim()) this.flushItems(st);
                st.inline.push(...this.inline(n, { heading: false }));
                continue;
            }
            if (n.nodeType !== 1) continue;
            const e = n as Element;
            const t = tag(e);
            if (this.dropped(e)) continue;

            // Word desktop: odstavec seznamu (mso-list: l0 level2 lfo1)
            const msoList = t === "p" ? styleOf(e)["mso-list"] || "" : "";
            const listLevel = /level(\d+)/.exec(msoList);
            if (listLevel) {
                this.flushInline(st);
                st.items.push({
                    ordered: this.wordListOrdered(e), level: +listLevel[1],
                    indent: ptValue(this.style(e)["margin-left"] || ""),
                    listId: (/\b(l\d+)\b/.exec(msoList) || [])[1],
                    content: [this.el("p", {}, this.inlineChildren(e, { heading: false }))],
                });
                continue;
            }
            // pokracovani polozky Wordu (dalsi odstavec v odrazce, bez vlastni znacky)
            if (t === "p" && st.items.length && !st.inline.length && hasClass(e, /\bMsoListParagraphCxSp(Middle|Last)\b/)) {
                const p = this.el("p", {}, this.inlineChildren(e, { heading: false }));
                if (!isEmptyBlock(p)) st.items[st.items.length - 1].content.push(p);
                continue;
            }
            // seznam s urovnemi na polozkach (Google Docs aria-level, Word online data-aria-level)
            if ((t === "ul" || t === "ol") && e.querySelector(":scope > li[aria-level], :scope > li[data-aria-level]")) {
                this.flushInline(st);
                this.ariaItems(e, st);
                continue;
            }
            // obal s bloky uvnitr: Google Docs <b id="docs-internal-guid">, <google-sheets-html-origin>,
            // odstavec Wordu s textovym polem (tabulka / div s odstavci uvnitr)
            if (WRAPPERS.has(t) || (!BLOCKS.has(t) && hasBlockInside(e)) || (t === "p" && hasBlockInside(e))) {
                this.flushInline(st);
                this.walk(e, st);
                this.flushInline(st);
                continue;
            }
            if (!BLOCKS.has(t) && !this.isHeadingPara(e)) {
                const parts = this.inline(e, { heading: false });
                // radkovy obsah za seznamem patri za seznam (ne pred nej)
                if (st.items.length && parts.some((x) => (x.textContent || "").trim() || (x.nodeType === 1 && (x as Element).querySelector?.("img")) || x.nodeName === "IMG")) {
                    this.flushItems(st);
                }
                st.inline.push(...parts);
                continue;
            }

            this.flushInline(st);
            this.flushItems(st);
            const block = this.block(e);
            if (!block) continue;
            // citace z Wordu (styl Citace) - sousedni odstavce do jedne
            if (t === "p" && hasClass(e, /\bMso(Intense)?Quote\b/)) {
                if (!st.quote || st.out[st.out.length - 1] !== st.quote) {
                    st.quote = this.el("blockquote");
                    st.out.push(st.quote);
                }
                st.quote.append(block);
                continue;
            }
            st.out.push(block);
        }
    }

    private flushInline(st: { out: Node[]; inline: Node[] }): void {
        if (!st.inline.length) return;
        const p = this.el("p", {}, st.inline);
        st.inline = [];
        if (!isEmptyBlock(p)) st.out.push(p);
    }

    /** Polozky seznamu s urovni na li (aria-level), vcetne vnorenych ul / ol primo v seznamu. */
    private ariaItems(list: Element, st: { items: ListItem[] }): void {
        const ordered = tag(list) === "ol";
        for (const li of Array.from(list.children)) {
            const t = tag(li);
            if (t === "ul" || t === "ol") { this.ariaItems(li, st); continue; }
            if (t !== "li") continue;
            const level = parseInt(li.getAttribute("aria-level") || li.getAttribute("data-aria-level") || "1", 10) || 1;
            // vnoreny seznam uvnitr polozky zpracovat zvlast (jinak by se zdvojil)
            const nested = Array.from(li.children).filter((c) => tag(c) === "ul" || tag(c) === "ol");
            nested.forEach((c) => c.remove());
            st.items.push({ ordered, level: Math.min(level, 9), content: this.blocks(li) });
            nested.forEach((c) => this.ariaItems(c, st));
        }
    }

    private flushItems(st: { out: Node[]; items: ListItem[] }): void {
        if (!st.items.length) return;
        // Word: odrazka odsazena tlacitkem / Tab bez zmeny urovne ma jen vetsi levy okraj ->
        // uroven = poradi okraje mezi polozkami stejneho seznamu se stejnou urovni
        const byLevel = new Map<string, number[]>();
        const key = (it: ListItem) => (it.listId || "") + ":" + it.level;
        for (const it of st.items) {
            if (it.indent == null) continue;
            const list = byLevel.get(key(it)) ?? [];
            if (!list.some((x) => Math.abs(x - it.indent!) < 3)) list.push(it.indent);
            byLevel.set(key(it), list);
        }
        for (const it of st.items) {
            const margins = it.indent != null ? (byLevel.get(key(it)) ?? []).sort((a, b) => a - b) : [];
            if (margins.length > 1) it.level += margins.findIndex((m) => Math.abs(m - it.indent!) < 3);
        }
        st.out.push(...this.buildLists(st.items));
        st.items = [];
    }

    /** Ploche polozky s urovni -> vnorene seznamy. */
    private buildLists(items: ListItem[]): Node[] {
        const out: Node[] = [];
        const stack: Array<{ level: number; list: HTMLElement }> = [];
        for (const it of items) {
            const name = it.ordered ? "ol" : "ul";
            while (stack.length && stack[stack.length - 1].level > it.level) stack.pop();
            let top = stack[stack.length - 1];
            if (top && top.level === it.level && tag(top.list) !== name) {
                stack.pop();
                top = stack[stack.length - 1];
            }
            if (!top || top.level < it.level) {
                const list = this.el(name);
                const parentLi = top?.list.lastElementChild;
                if (parentLi) parentLi.append(list);
                else out.push(list);
                stack.push({ level: it.level, list });
                top = stack[stack.length - 1];
            }
            const content = it.content.filter((n) => !(n.nodeType === 1 && isEmptyBlock(n as Element)));
            top.list.append(this.el("li", {}, content.length ? content : [this.el("p")]));
        }
        return out;
    }

    /** Typ Wordoveho seznamu podle znacky pred textem (1. a) i. = cislovany). */
    private wordListOrdered(p: Element): boolean {
        const marker = Array.from(p.querySelectorAll("span")).find((s) => styleOf(s)["mso-list"] === "ignore");
        const text = (marker?.textContent || "").replace(/\s|\u00a0/g, "");
        return /^\(?([0-9]+|[a-z]{1,2}|[ivxlc]+)[.)]/i.test(text);
    }

    /** Word online: <p role="heading" aria-level="1">, Word: styl Nazev / Podtitul. */
    private isHeadingPara(e: Element): boolean {
        return tag(e) === "p" && (e.getAttribute("role") === "heading" || hasClass(e, /\bMso(Title|Subtitle)\b/));
    }

    private headingLevel(e: Element): number | null {
        const t = tag(e);
        if (/^h[1-6]$/.test(t)) return +t[1];
        if (e.getAttribute("role") === "heading") return parseInt(e.getAttribute("aria-level") || "2", 10) || 2;
        if (hasClass(e, /\bMsoTitle\b/)) return 1;
        if (hasClass(e, /\bMsoSubtitle\b/)) return 2;
        return null;
    }

    /** Nadpis o uroven niz, na nejblizsi povolenou uroven (null = odstavec). */
    private targetLevel(level: number): number | null {
        const allowed = [...this.o.headings].sort((a, b) => a - b);
        if (!allowed.length) return null;
        const want = Math.min(level + 1, 6);
        return allowed.find((l) => l >= want) ?? allowed[allowed.length - 1];
    }

    /** Zarovnani na stred / vpravo a odsazeni zleva (Word v pt / cm -> px, editor zaokrouhli na kroky). */
    private alignAttrs(e: Element): Record<string, string> {
        const st = this.style(e);
        const a = (st["text-align"] || e.getAttribute("align") || "").toLowerCase();
        const css: string[] = [];
        if (a === "center" || a === "right") css.push("text-align: " + a);
        // odsazeni jen u obycejnych odstavcu (ne seznamy, ne zaporne / predsazeni)
        const ml = toPx(st["margin-left"] || "");
        if (ml >= 20 && !/mso-list/.test(e.getAttribute("style") || "")) css.push("margin-left: " + Math.round(ml) + "px");
        return css.length ? { style: css.join("; ") } : {};
    }

    private block(e: Element): Node | null {
        const t = tag(e);
        const level = this.headingLevel(e);
        if (level !== null) {
            const target = this.targetLevel(level);
            const el = this.el(target ? "h" + target : "p", this.alignAttrs(e), this.inlineChildren(e, { heading: !!target }));
            return isEmptyBlock(el) ? null : el;
        }
        switch (t) {
            case "p":
            case "dt":
            case "dd":
            case "address":
            case "figcaption":
            case "pre": {
                const el = this.el("p", this.alignAttrs(e), this.inlineChildren(e, { heading: false }));
                return isEmptyBlock(el) ? null : el;
            }
            case "li": {
                // polozka mimo seznam
                const el = this.el("p", {}, this.inlineChildren(e, { heading: false }));
                return isEmptyBlock(el) ? null : el;
            }
            case "blockquote": {
                const inner = this.blocks(e);
                return inner.length ? this.el("blockquote", {}, inner) : null;
            }
            case "hr":
                return this.el("hr");
            case "ul":
            case "ol": {
                const list = this.el(t);
                for (const li of Array.from(e.children)) {
                    if (tag(li) === "ul" || tag(li) === "ol") {
                        // vnoreny seznam primo v seznamu (nevalidni, ale bezne) -> do predchozi polozky
                        const nested = this.block(li);
                        if (nested) (list.lastElementChild ?? list).append(nested);
                        continue;
                    }
                    if (tag(li) !== "li") continue;
                    const content = this.blocks(li);
                    list.append(this.el("li", {}, content.length ? content : [this.el("p")]));
                }
                return list.childElementCount ? list : null;
            }
            case "table":
                return this.table(e);
        }
        return null;
    }

    private table(e: Element): Node | null {
        const own = Array.from(e.querySelectorAll("td, th")).filter((c) => c.closest("table") === e);
        if (own.length === 1) {
            const inner = this.blocks(own[0]);
            if (!inner.length) return null;
            if (inner.length === 1) return inner[0];
            const frag = this.d.createDocumentFragment();
            frag.append(...inner);
            return frag;
        }
        const tbody = this.el("tbody");
        // skryte radky a sloupce (Excel display:none) vynechat
        const rows = Array.from(e.querySelectorAll("tr")).filter((tr) => tr.closest("table") === e && !this.dropped(tr));
        for (const tr of rows) {
            const row = this.el("tr");
            for (const cell of Array.from(tr.children)) {
                const t = tag(cell);
                if ((t !== "td" && t !== "th") || this.dropped(cell)) continue;
                const attrs: Record<string, string> = {};
                // Excel: text pretekajici do sousednich bunek (mso-ignore:colspan) neni slouceni
                const ignoreSpan = /mso-ignore:\s*colspan/i.test(cell.getAttribute("style") || "");
                for (const a of ["colspan", "rowspan"]) {
                    if (a === "colspan" && ignoreSpan) continue;
                    const v = Math.min(100, parseInt(cell.getAttribute(a) || "1", 10) || 1);
                    if (v > 1) attrs[a] = String(v);
                }
                const content = this.blocks(cell);
                this.applyCellStyle(cell, content);
                row.append(this.el(t, attrs, content.length ? content : [this.el("p")]));
            }
            if (row.childElementCount) tbody.append(row);
        }
        return tbody.childElementCount ? this.el("table", {}, [tbody]) : null;
    }

    /** Formatovani cele bunky (Excel ho ma na <td>, ne na textu) -> do odstavcu bunky. */
    private applyCellStyle(cell: Element, content: Node[]): void {
        const st = this.style(cell);
        const align = st["text-align"] || cell.getAttribute("align") || "";
        for (const n of content) {
            if (n.nodeType !== 1 || tag(n as Element) !== "p") continue;
            const p = n as HTMLElement;
            const inner = this.format(Array.from(p.childNodes), tag(cell), st, { heading: false }, null);
            p.replaceChildren(...inner);
            if ((align === "center" || align === "right") && !p.getAttribute("style")) p.setAttribute("style", "text-align: " + align);
        }
    }

    // ---------------------------------------------------------- radkovy obsah

    private inlineChildren(e: Node, ctx: InlineCtx): Node[] {
        // nesmyslne hluboke vnoreni (cizi HTML) - dal jen text, rekurze by pretekla zasobnik
        if (this.depth > 200) return [this.d.createTextNode(e.textContent || "")];
        this.depth++;
        try {
            const out: Node[] = [];
            for (const c of Array.from(e.childNodes)) out.push(...this.inline(c, ctx));
            return out;
        }
        finally {
            this.depth--;
        }
    }

    private inline(n: Node, ctx: InlineCtx): Node[] {
        if (n.nodeType === 3) {
            // "text&nbsp; text" (Word tak uklada dve mezery) -> jedna mezera
            const text = (n.textContent || "").replace(/\u00a0(?=[ \t\r\n])|(?<=[ \t\r\n])\u00a0/g, " ");
            return text ? [this.d.createTextNode(text)] : [];
        }
        if (n.nodeType !== 1) return [];
        const e = n as Element;
        const t = tag(e);
        if (this.dropped(e)) return [];

        if (t === "img") return this.image(e);
        if (t === "picture") {
            const img = e.querySelector("img");
            return img ? this.image(img) : [];
        }
        if (t === "video") {
            this.droppedImages++;
            return [];
        }
        if (t === "br") {
            // zalomeni stranky / sekce z Wordu
            if (/page-break|mso-special-character|mso-break-type/.test(e.getAttribute("style") || "") || e.getAttribute("clear")) return [];
            return [this.el("br")];
        }

        const kids = this.inlineChildren(e, t === "a" ? { ...ctx, link: true } : ctx);
        if (!kids.length) return [];

        if (t === "a") {
            const href = (e.getAttribute("href") || "").trim();
            // poznamka pod carou / vysvetlivka ([1]) - cislo jako horni index
            if (/^#_(ftn|edn)/i.test(href)) return [this.el("sup", {}, [this.d.createTextNode((e.textContent || "").trim())])];
            // kotvy a odkazy na obsah dokumentu (#_Toc...) / soubory na disku se rozbali
            if (/^(https?:|mailto:|tel:|\/(?![\/\\]))/i.test(href)) return [this.el("a", { href }, kids)];
            return kids;
        }

        // vlozeny text v revizi (span.msoIns / ins) - trida Wordu ho podtrhava, text je obycejny
        if (t === "ins" || hasClass(e, /\bmsoIns\b/)) return kids;
        return this.format(kids, t, this.style(e), ctx, e);
    }

    /** Formatovani prvku (znacka + styl, i z tridy) -> obaly tucne / kurziva / barva... kolem obsahu. */
    private format(kids: Node[], t: string, st: Record<string, string>, ctx: InlineCtx, e: Element | null): Node[] {
        let wrapped: Node[] = kids;
        const wrap = (name: string, attrs: Record<string, string> = {}) => { wrapped = [this.el(name, attrs, wrapped)]; };

        const bold = t === "b" || t === "strong"
            ? !/^(normal|[1-5]00)$/.test(st["font-weight"] || "")
            : /^(bold(er)?|[6-9]00)$/.test(st["font-weight"] || "");
        const italic = t === "i" || t === "em" || t === "cite" || t === "dfn" ? st["font-style"] !== "normal" : /^(italic|oblique)/.test(st["font-style"] || "");
        const deco = (st["text-decoration"] || "") + " " + (st["text-decoration-line"] || "");
        // <ins> z Wordu = vlozeny text v revizi, ne podtrzeni
        const underline = t === "u" || /underline/.test(deco);
        const strike = t === "s" || t === "strike" || t === "del" || /line-through/.test(deco);
        const va = st["vertical-align"] || "";
        const sup = t === "sup" || va === "super";
        const sub = t === "sub" || va === "sub";

        if (sup) wrap("sup");
        else if (sub) wrap("sub");
        if (strike) wrap("s");
        if (underline && !ctx.heading && !ctx.link) wrap("u");
        if (italic) wrap("em");
        if (bold && !ctx.heading) wrap("strong");
        if (!ctx.heading && !ctx.link) {
            const color = this.mapColor(st["color"] || (t === "font" && e ? e.getAttribute("color") || "" : ""));
            if (color) wrap("span", { "data-ce-color": color });
        }
        if (st["text-transform"] === "uppercase") upperText(wrapped);
        return wrapped;
    }

    /** Obrazek: data z RTF (Word), cizi URL (k importu), jinak vynechat. */
    private image(e: Element): Node[] {
        if (this.o.keepImages === false) {
            this.droppedImages++;
            return [];
        }
        const src = (e.getAttribute("src") || "").trim();
        let out: string | null = null;
        let kind: PastedImage["kind"] = "data";
        if (/^file:/i.test(src)) {
            out = this.local.get(e) ?? null;
        }
        else if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src)) {
            out = src;
        }
        else if (/^https?:\/\//i.test(src) && this.o.remoteImages) {
            out = src;
            kind = "remote";
        }
        if (!out) {
            this.droppedImages++;
            return [];
        }
        const alt = (e.getAttribute("alt") || "").trim();
        this.images.push({ src: out, kind, alt });
        const attrs: Record<string, string> = { src: out, alt, class: "img-responsive" };
        // sirka z dokumentu (zobrazena velikost); vyska ne - s max-width: 100% by obrazek deformovala
        const w = parseFloat(e.getAttribute("width") || "") || toPx(styleOf(e)["width"] || "");
        if (w > 0 && w < 4000) attrs.style = "width: " + Math.round(w) + "px";
        return [this.el("img", attrs)];
    }

    /** Barva textu -> nejblizsi barva palety, nebo null (cerna, seda, vzdalena). */
    private mapColor(value: string): string | null {
        if (!value || !this.palette.length) return null;
        const rgb = parseColor(value);
        if (!rgb || saturation(rgb) < 0.15 || lightness(rgb) < 0.12 || lightness(rgb) > 0.92) return null;
        let best: string | null = null;
        let bestD = Infinity;
        for (const c of this.palette) {
            const dist = colorDistance(rgb, c.rgb);
            if (dist < bestD) { bestD = dist; best = c.hex; }
        }
        return bestD <= 165 ? best : null;
    }
}

/**
 * Styly trid z <style> ve schrance: ".xl65 { font-weight: 700 }", "p.MsoQuote, li.MsoQuote {...}".
 * Jen selektory s tridou (ne obecne td / p), klic = nazev tridy malymi pismeny.
 */
function classStyles(doc: Document): Map<string, Record<string, string>> {
    const map = new Map<string, Record<string, string>>();
    for (const el of Array.from(doc.querySelectorAll("style"))) {
        const css = (el.textContent || "").replace(/<!--|-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
        for (const chunk of css.split("}")) {
            const brace = chunk.lastIndexOf("{");
            if (brace < 0) continue;
            const m = ["", chunk.slice(0, brace).replace(/[^]*[;{]/, ""), chunk.slice(brace + 1)];
            const decl: Record<string, string> = {};
            for (const part of m[2].split(";")) {
                const i = part.indexOf(":");
                if (i > 0) decl[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim().toLowerCase();
            }
            for (const sel of m[1].split(",")) {
                const c = /^\s*[a-z0-9]*\.([\w-]+)\s*$/i.exec(sel);
                if (c) map.set(c[1].toLowerCase(), { ...map.get(c[1].toLowerCase()), ...decl });
            }
        }
    }
    return map;
}

/** CSS delka v pt (Word) -> cislo v pt; jine jednotky prepocte. */
function ptValue(v: string): number | null {
    const m = /^(-?[\d.]+)\s*(pt|px|cm|mm|in)?$/.exec(v.trim());
    if (!m) return null;
    const n = parseFloat(m[1]);
    switch (m[2]) {
        case "px": return n * 0.75;
        case "cm": return n * 28.3465;
        case "mm": return n * 2.83465;
        case "in": return n * 72;
        default: return n;
    }
}

/** CSS delka -> px (0 = neplatna). */
function toPx(v: string): number {
    const pt = ptValue(v);
    return pt === null ? 0 : pt / 0.75;
}

/** Text v uzlech na velka pismena (styl "VELKA PISMENA" z Wordu je jen text-transform). */
function upperText(nodes: Node[]): void {
    for (const n of nodes) {
        if (n.nodeType === 3) n.textContent = (n.textContent || "").toLocaleUpperCase("cs");
        else upperText(Array.from(n.childNodes));
    }
}

/** Prazdny blok (jen mezery, &nbsp;, zalomeni). */
function isEmptyBlock(el: Element): boolean {
    return !(el.textContent || "").replace(/[\s\u00a0\u200b]/g, "") && !el.querySelector("img, hr, table");
}

// ------------------------------------------------------------------ barvy

const NAMED: Record<string, string> = {
    red: "#ff0000", darkred: "#8b0000", maroon: "#800000", orange: "#ffa500", green: "#008000", lime: "#00ff00",
    blue: "#0000ff", navy: "#000080", purple: "#800080", teal: "#008080", olive: "#808000", fuchsia: "#ff00ff",
    aqua: "#00ffff", yellow: "#ffff00", black: "#000000", white: "#ffffff", gray: "#808080", grey: "#808080",
};

export function parseColor(v: string): [number, number, number] | null {
    v = v.trim().toLowerCase();
    if (NAMED[v]) v = NAMED[v];
    let m = /^#([0-9a-f]{3})$/.exec(v);
    if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number];
    m = /^#([0-9a-f]{6})$/.exec(v);
    if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
    m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(v);
    if (m) {
        if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
        return [+m[1], +m[2], +m[3]];
    }
    return null;
}

function lightness([r, g, b]: [number, number, number]): number {
    return (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
}

function saturation([r, g, b]: [number, number, number]): number {
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
    const l = (max + min) / 2;
    if (max === min) return 0;
    return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

/** Vzdalenost barev vazena podle vnimani ("redmean"), 0..~765. */
function colorDistance(a: [number, number, number], b: [number, number, number]): number {
    const rm = (a[0] + b[0]) / 2;
    const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

// ------------------------------------------------------------------ obrazky z RTF (Word)

/**
 * Obrazky z RTF verze schranky Wordu: skupiny {\pict ... \pngblip|\jpegblip ... <hex>}
 * v poradi, v jakem jsou v dokumentu. Nahradni verze ({\nonshppict ...}, u obtekanych obrazku
 * {\shprslt ...} - WMF pro stare
 * programy) a vektorove formaty (EMF / WMF - prohlizec je neumi) se preskoci.
 * Vraci data: URL.
 */
export function extractRtfImages(rtf: string): Array<string | null> {
    const out: Array<string | null> = [];
    if (!rtf || !rtf.includes("\\pict")) return out;
    // zasobnik skupin: nazev prvniho ridiciho slova a zacatek
    const stack: Array<{ name: string; start: number }> = [];
    for (let i = 0; i < rtf.length; i++) {
        const ch = rtf.charCodeAt(i);
        if (ch === 92) { // "\" - escapovana zavorka se preskoci
            i++;
            continue;
        }
        if (ch === 123) { // "{"
            const m = /^\\(\*\\)?([a-z]+)/.exec(rtf.slice(i + 1, i + 40));
            stack.push({ name: m ? m[2] : "", start: i });
        }
        else if (ch === 125) { // "}"
            const g = stack.pop();
            if (!g || g.name !== "pict" || stack.some((p) => p.name === "nonshppict" || p.name === "shprslt")) continue;
            // i obrazek, ktery prohlizec neumi (EMF / WMF) - kvuli poradi (parovani s HTML)
            out.push(pictToDataUrl(rtf.slice(g.start, i + 1)));
        }
    }
    return out;
}

function pictToDataUrl(group: string): string | null {
    const mime = /\\pngblip/.test(group) ? "image/png" : /\\jpegblip/.test(group) ? "image/jpeg" : null;
    if (!mime) return null;
    // vnitrni skupiny (picprop, blipuid) a ridici slova pryc, zbyde hex; skupina -> mezera,
    // jinak by se parametr predchoziho slova (\bliptag123) slepil se zacatkem dat
    let body = group.slice(1, -1);
    let prev;
    do {
        prev = body;
        body = body.replace(/\{[^{}]*\}/g, " ");
    } while (body !== prev);
    const hex = body.replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[^0-9a-f]/gi, "");
    if (hex.length < 16 || hex.length % 2) return null;
    // po blocich (retezeni po znaku je u nekolika MB pomale)
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
    return "data:" + mime + ";base64," + btoa(bin);
}

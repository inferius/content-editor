/**
 * HTML <-> dokument ProseMirror.
 *
 * Vystup ma tvar, jaky ukladal CKEditor 4 (web s nim pocita):
 *  - polozka seznamu a bunka tabulky bez obalujiciho <p> (<li>text</li>)
 *  - bloky na samostatnych radcich
 */
import { DOMParser as PMDOMParser, DOMSerializer, Fragment, Slice, Node as PMNode, type NodeType, type ParseRule } from "prosemirror-model";
import { schema } from "./schema";
import { varRegExp } from "./vartext";
import { inertDocument } from "./inertdoc";

/** Parser pro nacteni ulozeneho obsahu - zachova i HTML bloky. */
export const contentParser = PMDOMParser.fromSchema(schema);

/**
 * Parser pro vkladani ze schranky: stejna pravidla bez HTML bloku a kontejneru -
 * z Wordu, webu apod. se nesmi do obsahu dostat skripty, formulare ani cizi layout.
 */
export const pasteParser = new PMDOMParser(schema, [
    // barva prevedena na paletu cisticem Office (office.ts) - jedina barva, ktera ze schranky projde
    {
        tag: "span[data-ce-color]", mark: "textstyle", priority: 60,
        getAttrs: (dom) => {
            const color = (dom as HTMLElement).getAttribute("data-ce-color") || "";
            return /^#[0-9a-f]{3,8}$/i.test(color) ? { color, background: null, size: null } : false;
        },
    } as ParseRule,
    // bez HTML bloku a kontejneru: cizi layout (div s tridami jineho webu) se rozbali na obsah;
    // bez barev / pozadi / velikosti pisma - prohlizec pri kopirovani pribali vykreslene styly zdroje
    // (napr. svetle modry <code> z tmave administrace), barva se nastavuje paletou
    ...(contentParser.rules as ParseRule[]).filter((r) => (!("node" in r) || (r.node !== "rawhtml" && r.node !== "container" && r.node !== "textbox"))
        && (!("mark" in r) || (r.mark !== "textstyle" && r.mark !== "spanclass")))
        .map(withoutForeignLook),
    // skripty a styly ze schranky zahodit uplne (vcetne obsahu)
    ...["script", "style", "meta", "link", "title", "noscript", "iframe", "object", "embed", "form", "button", "input", "select", "textarea"]
        .map((tag) => ({ tag, ignore: true, priority: 100 } as ParseRule)),
]);

/**
 * Vlozeny obsah bez trid a stylu zdroje (seznamy, polozky, nadpisy, obtekani obrazku) -
 * tridy jineho webu tu nic neznamenaji. Zachovaji se jen u ulozeneho obsahu (contentParser).
 */
function withoutForeignLook(rule: ParseRule): ParseRule {
    const strip: Record<string, string[]> = { heading: ["cls"], bullet_list: ["cls", "style"], ordered_list: ["cls", "style"], list_item: ["cls"], image: ["style"] };
    const keys = "node" in rule && rule.node ? strip[rule.node] : undefined;
    if (!keys || !rule.getAttrs) return rule;
    const orig = rule.getAttrs;
    return {
        ...rule,
        getAttrs(dom: HTMLElement | string) {
            const attrs = (orig as (d: HTMLElement | string) => ReturnType<typeof orig>)(dom);
            if (!attrs) return attrs;
            const out = { ...attrs } as Record<string, unknown>;
            for (const k of keys) delete out[k];
            return out;
        },
    } as ParseRule;
}

export const serializer = DOMSerializer.fromSchema(schema);

/** Dokument pro parsovani a skladani HTML obsahu - vychozi inertni (viz inertdoc.ts). */
function getDocument(doc?: Document): Document {
    return doc ?? inertDocument();
}

/** HTML retezec -> dokument. */
export function parseHTML(html: string, doc?: Document): PMNode {
    const d = getDocument(doc);
    const wrap = d.createElement("div");
    wrap.innerHTML = html || "";
    const node = contentParser.parse(wrap, { preserveWhitespace: false });
    // prazdny obsah = jeden prazdny odstavec
    return node.childCount ? tokenizeVariables(node) : schema.topNodeType.createAndFill()!;
}

// ------------------------------------------------------------------ promenne {$...}

function allowsVariable(type: NodeType | null): boolean {
    return !type || (type.inlineContent && !type.spec.code && !!type.contentMatch.matchType(schema.nodes.variable));
}

/** Text -> text + uzly promennych (formatovani textu zustane i na promenne). */
function splitText(text: PMNode): PMNode[] {
    const s = text.text || "";
    const re = varRegExp();
    const out: PMNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
        if (m.index > last) out.push(schema.text(s.slice(last, m.index), text.marks));
        // promenna bez formatovani - web ji nahrazuje celym blokem, uklada se jako cisty kod
        out.push(schema.nodes.variable.create({ name: m[1], args: m[2] === undefined ? null : m[2] }));
        last = m.index + m[0].length;
    }
    if (!out.length) return [text];
    if (last < s.length) out.push(schema.text(s.slice(last), text.marks));
    return out;
}

/** Prevede zapisy {$nazev...} v textu na uzly promennych. parent = null -> nezname (vlozeny kus). */
export function tokenizeFragment(frag: Fragment, parent: NodeType | null): Fragment {
    let changed = false;
    const out: PMNode[] = [];
    frag.forEach((child) => {
        if (child.isText) {
            const parts = allowsVariable(parent) && (child.text || "").includes("{$") ? splitText(child) : [child];
            if (parts.length !== 1 || parts[0] !== child) changed = true;
            out.push(...parts);
        } else if (child.content.size) {
            const inner = tokenizeFragment(child.content, child.type);
            if (inner !== child.content) { changed = true; out.push(child.copy(inner)); } else out.push(child);
        } else out.push(child);
    });
    return changed ? Fragment.from(out) : frag;
}

export function tokenizeVariables(doc: PMNode): PMNode {
    const content = tokenizeFragment(doc.content, doc.type);
    return content === doc.content ? doc : doc.copy(content);
}

/** Vlozeny obsah (schranka, pretazeni) - i tam z {$...} udelat promenne. */
export function tokenizeSlice(slice: Slice): Slice {
    const content = tokenizeFragment(slice.content, null);
    return content === slice.content ? slice : new Slice(content, slice.openStart, slice.openEnd);
}

/** Dokument -> HTML retezec ve tvaru CKEditoru. */
export function serializeHTML(node: PMNode, doc?: Document): string {
    return serializeParts(node, doc).join("\n\n");
}

/** Bloky nejvyssi urovne jako samostatne HTML retezce (v serializeHTML spojene prazdnym radkem). */
export function serializeParts(node: PMNode, doc?: Document): string[] {
    if (isEmptyDoc(node)) return [];
    node = stripVariableMarks(node);
    const d = getDocument(doc);
    const frag = serializer.serializeFragment(node.content, { document: d });
    const wrap = d.createElement("div");
    wrap.appendChild(frag);
    normalizeOutput(wrap);

    const parts: string[] = [];
    wrap.childNodes.forEach((ch) => {
        if (ch.nodeType === 1) parts.push((ch as HTMLElement).outerHTML);
        else if (ch.nodeType === 3 && (ch.textContent || "").trim() !== "") parts.push(ch.textContent || "");
    });
    return parts;
}

/**
 * Promenne se ukladaji jako cisty kod {$...} - bez formatovani (tucne, barva, odkaz). Web je
 * nahrazuje celym blokem a obal (napr. <span style>) by na webu zustal nebo rozbil HTML.
 */
function stripVariableMarks(node: PMNode): PMNode {
    const strip = (frag: Fragment): Fragment => {
        let changed = false;
        const out: PMNode[] = [];
        frag.forEach((child) => {
            if (child.type === schema.nodes.variable && child.marks.length) { out.push(child.mark([])); changed = true; }
            else if (child.content.size) {
                const inner = strip(child.content);
                if (inner !== child.content) { out.push(child.copy(inner)); changed = true; } else out.push(child);
            } else out.push(child);
        });
        return changed ? Fragment.from(out) : frag;
    };
    const content = strip(node.content);
    return content === node.content ? node : node.copy(content);
}

/** Jen prazdny odstavec = prazdny obsah (at se neuklada "<p>&nbsp;</p>"). */
export function isEmptyDoc(node: PMNode): boolean {
    if (node.childCount !== 1) return false;
    const only = node.firstChild!;
    return only.type === schema.nodes.paragraph && only.content.size === 0 && !only.attrs.align && !only.attrs.indent;
}

/**
 * <li><p>text</p><ul>..</ul></li> -> <li>text<ul>..</ul></li>
 * <td><p>text</p></td> -> <td>text</td>
 * (jen kdyz odstavec nema vlastni atributy)
 */
function normalizeOutput(root: HTMLElement): void {
    // promenne: <span data-ce-var>{$x}</span> -> {$x} (web ceka cisty text)
    root.querySelectorAll("span[data-ce-var]").forEach((span) => span.replaceWith(...Array.from(span.childNodes)));
    root.normalize();
    root.querySelectorAll("li, td, th").forEach((cell) => {
        const first = cell.firstElementChild as HTMLElement | null;
        if (!first || first.tagName !== "P" || first.attributes.length) return;
        const rest = Array.from(cell.children).slice(1);
        const ok = cell.tagName === "LI"
            ? rest.every((c) => c.tagName === "UL" || c.tagName === "OL")
            : rest.length === 0;
        if (!ok) return;
        while (first.firstChild) cell.insertBefore(first.firstChild, first);
        first.remove();
    });
    // mezery na zacatku/konci bloku a mezi <br> prohlizec nezobrazi - zahodit, aby
    // dalsi ulozeni dalo stejny vysledek
    root.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, td, th").forEach((b) => {
        const first = b.firstChild;
        if (first && first.nodeType === 3) first.textContent = (first.textContent || "").replace(/^[ \t\r\n]+/, "");
        const last = b.lastChild;
        if (last && last.nodeType === 3) last.textContent = (last.textContent || "").replace(/[ \t\r\n]+$/, "");
    });
    root.querySelectorAll("br").forEach((br) => {
        const next = br.nextSibling;
        if (next && next.nodeType === 3 && /^[ \t\r\n]+$/.test(next.textContent || "")) next.remove();
    });
    // prazdne odstavce: ProseMirror je uklada jako <p></p>, CKEditor jako <p>&nbsp;</p>
    root.querySelectorAll("p:empty, td:empty, th:empty").forEach((p) => { p.textContent = "\u00a0"; });
}

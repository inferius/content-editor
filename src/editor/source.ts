/**
 * Zdrojovy rezim a HTML blok: HTML v CodeMirror 6.
 * Obarveni (barvy z tokenu editoru - svetle i tmave tema), napoveda tagu a atributu,
 * automaticke uzavirani tagu a zavorek, hledani (Ctrl+F), sbalovani, formatovani.
 */
import { EditorState, EditorSelection } from "@codemirror/state";
import {
    EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
    drawSelection, dropCursor, rectangularSelection, crosshairCursor,
    Decoration, ViewPlugin, type DecorationSet, type ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
    syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, foldGutter, foldKeymap, syntaxTree,
} from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { html } from "@codemirror/lang-html";
import { tags as t } from "@lezer/highlight";
import { h, iconButton } from "../ui/dom";

// ------------------------------------------------------------------ parovy tag

const tagMatch = Decoration.mark({ class: "cm-tagMatch" });
const tagNoMatch = Decoration.mark({ class: "cm-tagNoMatch" });
const TAG_NODES = ["OpenTag", "CloseTag", "SelfClosingTag"];

/** Tag (OpenTag / CloseTag), ve kterem je kurzor - nebo null (kurzor v obsahu). */
function tagAt(state: EditorState, pos: number): SyntaxNode | null {
    const tree = syntaxTree(state);
    for (const side of [-1, 1] as const) {
        let node: SyntaxNode | null = tree.resolveInner(pos, side);
        while (node && !TAG_NODES.includes(node.name) && node.name !== "Element" && node.name !== "Document") node = node.parent;
        if (node && TAG_NODES.includes(node.name)) return node;
    }
    return null;
}

/**
 * Kurzor v oteviracim nebo uzaviracim tagu -> zvyraznit oba tagy prvku
 * (bracketMatching z CodeMirroru zvyrazni jen zavorky jednoho tagu).
 */
function pairDecorations(state: EditorState): DecorationSet {
    const tag = tagAt(state, state.selection.main.head);
    if (!tag || tag.name === "SelfClosingTag" || !tag.parent || tag.parent.name !== "Element") return Decoration.none;
    const el = tag.parent;
    const open = el.firstChild && el.firstChild.name === "OpenTag" ? el.firstChild : null;
    const close = el.lastChild && el.lastChild.name === "CloseTag" ? el.lastChild : null;
    const marks = [];
    if (open && close) {
        marks.push(tagMatch.range(open.from, open.to), tagMatch.range(close.from, close.to));
    } else {
        // bez paru (neuzavreny prvek, osamely uzaviraci tag)
        marks.push(tagNoMatch.range(tag.from, tag.to));
    }
    return Decoration.set(marks, true);
}

const tagPairs = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = pairDecorations(view.state); }
    update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = pairDecorations(u.state);
    }
}, { decorations: (v) => v.decorations });

/** Barvy pres CSS promenne (--ce-hl-*), at sedi ke svetlemu i tmavemu tematu. */
const highlight = HighlightStyle.define([
    { tag: [t.tagName, t.angleBracket], color: "var(--ce-hl-tag)" },
    { tag: t.attributeName, color: "var(--ce-hl-attr)" },
    { tag: [t.attributeValue, t.string], color: "var(--ce-hl-value)" },
    { tag: t.comment, color: "var(--ce-hl-comment)", fontStyle: "italic" },
    { tag: [t.keyword, t.processingInstruction, t.documentMeta], color: "var(--ce-hl-keyword)" },
    { tag: [t.number, t.bool, t.atom], color: "var(--ce-hl-number)" },
    { tag: [t.propertyName, t.definition(t.variableName)], color: "var(--ce-hl-attr)" },
    { tag: t.invalid, color: "var(--ce-danger)" },
]);

export interface SourceOptions {
    /** Kurzor na tuto pozici (a odscrolovat k ni). */
    cursor?: number;
    /** Cisla radku a sbalovani (vychozi true). */
    gutters?: boolean;
    /** Lista s formatovanim a napovedou kláves (vychozi true). */
    toolbar?: boolean;
    /** Nabidnout formatovani HTML (vychozi true). U kodu, ktery se vklada do stranky
     *  tak, jak je (merici skripty), se vypina - prohlizec by prepsal entity. */
    format?: boolean;
    /** Ctrl+S - nechat projit do stranky (ulozeni formulare). */
    onSave?: () => void;
    /** Zmena textu (po kazde uprave). */
    onChange?: (value: string) => void;
    /** Minimalni vyska v px. */
    minHeight?: number;
}

export class SourceEditor {
    readonly dom: HTMLElement;
    private cm: EditorView;

    constructor(parent: HTMLElement, text: string, opts: SourceOptions = {}) {
        const gutters = opts.gutters !== false;
        this.dom = h("div", { class: "ce-src" });
        const canFormat = opts.format !== false;
        const host = h("div", { class: "ce-src-cm" });
        if (opts.toolbar !== false) {
            const hint = canFormat
                ? "Ctrl+Mezera nápověda tagů  |  Ctrl+F hledat  |  Alt+Shift+F formátovat"
                : "Ctrl+Mezera nápověda tagů  |  Ctrl+F hledat";
            const bar = h("div", { class: "ce-src-bar" },
                canFormat ? iconButton("source", "Formátovat HTML (odsadit bloky na řádky)", () => this.format(), { class: "ce-btn ce-btn-text" }) : null,
                h("span", { class: "ce-src-hint", text: hint }));
            if (canFormat) (bar.firstElementChild as HTMLElement).append(h("span", { text: "Formátovat" }));
            this.dom.appendChild(bar);
        }
        this.dom.appendChild(host);
        parent.appendChild(this.dom);

        const pos = Math.max(0, Math.min(text.length, opts.cursor ?? 0));
        this.cm = new EditorView({
            parent: host,
            state: EditorState.create({
                doc: text,
                selection: EditorSelection.cursor(pos),
                extensions: [
                    gutters ? [lineNumbers(), foldGutter(), highlightActiveLineGutter()] : [],
                    highlightActiveLine(),
                    drawSelection(),
                    dropCursor(),
                    rectangularSelection(),
                    crosshairCursor(),
                    history(),
                    indentOnInput(),
                    bracketMatching(),
                    tagPairs,
                    closeBrackets(),
                    autocompletion({ icons: false }),
                    highlightSelectionMatches(),
                    syntaxHighlighting(highlight),
                    html({ autoCloseTags: true, matchClosingTags: true }),
                    EditorView.lineWrapping,
                    EditorView.updateListener.of((u) => { if (u.docChanged) opts.onChange?.(u.state.doc.toString()); }),
                    opts.minHeight ? EditorView.theme({ ".cm-content, .cm-gutter": { minHeight: opts.minHeight + "px" } }) : [],
                    keymap.of([
                        { key: "Mod-s", run: () => { opts.onSave?.(); return false; } },
                        { key: "Alt-Shift-f", run: () => { if (canFormat) this.format(); return canFormat; } },
                        ...closeBracketsKeymap,
                        ...completionKeymap,
                        ...searchKeymap,
                        ...foldKeymap,
                        indentWithTab,
                        ...defaultKeymap,
                        ...historyKeymap,
                    ]),
                ],
            }),
        });
    }

    /**
     * Odscrolovat ke kurzoru. Posuvnik nema CodeMirror, ale obal (telo editoru, dialog),
     * proto rucne: radek s kurzorem do horni tretiny viditelne plochy.
     */
    revealCursor(scroller?: HTMLElement): void {
        const run = () => {
            // jen posuvnik editoru (zadany nebo nejblizsi uvnitr stranky) - nikdy cela stranka
            let sc: HTMLElement | null = scroller || this.cm.scrollDOM;
            if (!scroller) {
                while (sc && sc !== document.body && sc !== document.documentElement
                    && !(sc.scrollHeight > sc.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
            }
            if (!sc || sc === document.body || sc === document.documentElement) return;
            if (sc.scrollHeight <= sc.clientHeight + 1) return;
            // vykresleny radek = presna poloha; jinak odhad z lineBlockAt (zna i nevykreslene radky)
            const top = this.cm.coordsAtPos(this.cursor)?.top ?? this.cm.documentTop + this.cm.lineBlockAt(this.cursor).top;
            const r = sc.getBoundingClientRect();
            sc.scrollTop += top - r.top - r.height / 3;
        };
        run();
        // CodeMirror po posunu vykresli a zmeri skutecne radky - poloha se zpresni
        setTimeout(run, 50);
        setTimeout(run, 200);
    }

    get value(): string {
        return this.cm.state.doc.toString();
    }

    /** Pozice kurzoru v textu. */
    get cursor(): number {
        return this.cm.state.selection.main.head;
    }

    /** Fokus bez posunu stranky (prohlizec by jinak posunul stranku k editoru). */
    focus(): void {
        try {
            this.cm.contentDOM.focus({ preventScroll: true });
        } catch {
            this.cm.focus();
        }
    }

    /** Prepsat obsah (napr. kdyz hostitel nacte jinou hodnotu). */
    setValue(text: string): void {
        if (text === this.value) return;
        this.cm.dispatch({ changes: { from: 0, to: this.cm.state.doc.length, insert: text } });
    }

    /** Bloky na samostatne radky s odsazenim (obsah odstavcu se nemeni). */
    format(): void {
        const text = this.value;
        const out = formatHTML(text);
        if (out === text) {
            this.flash("Není co formátovat. Na řádky se rozdělí seznamy, tabulky, bloky v blocích a zalomení <br>; odstavec s textem zůstává na jednom řádku (zalamuje ho editor).");
            return;
        }
        const lines = out.split("\n").length - text.split("\n").length;
        this.cm.dispatch({ changes: { from: 0, to: text.length, insert: out }, selection: EditorSelection.cursor(0), scrollIntoView: true });
        this.focus();
        this.flash(lines > 0 ? `Naformátováno (+${lines} řádků). Zpět Ctrl+Z.` : "Naformátováno. Zpět Ctrl+Z.");
    }

    /** Kratka zprava v liste editoru (misto napovedy klaves). */
    private flash(text: string): void {
        const hint = this.dom.querySelector(".ce-src-hint") as HTMLElement | null;
        if (!hint) return;
        const orig = hint.getAttribute("data-orig") || hint.textContent || "";
        hint.setAttribute("data-orig", orig);
        hint.textContent = text;
        hint.title = text;
        hint.classList.add("is-flash");
        clearTimeout(this.flashTimer);
        this.flashTimer = window.setTimeout(() => {
            hint.textContent = orig;
            hint.title = "";
            hint.classList.remove("is-flash");
        }, 6000);
    }

    private flashTimer = 0;

    destroy(): void {
        this.cm.destroy();
        this.dom.remove();
    }
}

// ------------------------------------------------------------------ formatovani

/** Prvky, ktere se smi rozlozit na radky (mezery mezi jejich bloky prohlizec nezobrazuje). */
const BLOCKS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH",
    "BLOCKQUOTE", "DIV", "SECTION", "ARTICLE", "ASIDE", "HEADER", "FOOTER", "NAV", "FIGURE", "FIGCAPTION", "HR", "FORM", "DL", "DT", "DD"]);

function isBlank(n: Node): boolean {
    return n.nodeType === 3 && !(n.textContent || "").trim();
}

/** Prvek, jehoz deti jsou jen bloky (a prazdne mezery) - ten se rozepise na radky. */
function isContainer(el: Element): boolean {
    if (!BLOCKS.has(el.tagName) || !el.childNodes.length) return false;
    return Array.from(el.childNodes).every((c) => isBlank(c) || (c.nodeType === 1 && BLOCKS.has((c as Element).tagName)));
}

function openTag(el: Element): string {
    const shallow = el.cloneNode(false) as Element;
    const html = shallow.outerHTML;
    return html.slice(0, html.length - (`</${el.tagName.toLowerCase()}>`).length);
}

function formatNode(el: Element, indent: string, out: string[]): void {
    if (!isContainer(el)) {
        // zalomeni <br> na novy radek (mezera na zacatku radku za <br> se nezobrazi); mimo <pre>
        const html = el.tagName === "PRE" ? el.outerHTML : el.outerHTML.replace(/<br\s*\/?>(?!\n)/gi, (br) => br + "\n" + indent + "    ");
        out.push(indent + html);
        return;
    }
    out.push(indent + openTag(el));
    el.childNodes.forEach((c) => { if (c.nodeType === 1) formatNode(c as Element, indent + "    ", out); });
    out.push(indent + `</${el.tagName.toLowerCase()}>`);
}

export function formatHTML(text: string): string {
    const tpl = document.createElement("template");
    tpl.innerHTML = text;
    const parts: string[] = [];
    tpl.content.childNodes.forEach((n) => {
        if (n.nodeType === 1) {
            const lines: string[] = [];
            formatNode(n as Element, "", lines);
            parts.push(lines.join("\n"));
        } else if (n.nodeType === 3 && (n.textContent || "").trim()) parts.push((n.textContent || "").trim());
        else if (n.nodeType === 8) parts.push(`<!--${n.textContent}-->`);
    });
    return parts.join("\n\n");
}

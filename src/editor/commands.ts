/**
 * Prikazy editoru (toolbar, klavesy, menu bloku). Kazdy prikaz ma tvar
 * ProseMirror Command: (state, dispatch?) => boolean - bez dispatch jen zjisti,
 * jestli jde provest (toolbar podle toho zasedne tlacitka).
 */
import { setBlockType, toggleMark, wrapIn, lift } from "prosemirror-commands";
import { wrapInList, liftListItem, sinkListItem } from "prosemirror-schema-list";
import { NodeSelection, TextSelection, type Command, type EditorState } from "prosemirror-state";
import type { Mark, MarkType, Node as PMNode, NodeType } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { schema, INDENT_STEP, safeColumnWidths } from "../core/schema";

const n = schema.nodes;
const m = schema.marks;

// ------------------------------------------------------------------ dotazy na stav

export function markActive(state: EditorState, type: MarkType): boolean {
    const { from, $from, to, empty } = state.selection;
    if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
    return state.doc.rangeHasMark(from, to, type);
}

/** Nejblizsi rodic daneho typu kolem vyberu. */
export function findParent(state: EditorState, type: NodeType): { node: PMNode; pos: number; depth: number } | null {
    const { $from } = state.selection;
    for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type === type) return { node, pos: $from.before(d), depth: d };
    }
    return null;
}

/** Typ bloku pro vyber v toolbaru: "paragraph" | "h2" | "h3" | ... */
export function currentBlockKey(state: EditorState): string {
    const sel = state.selection;
    if (sel instanceof NodeSelection) return "";
    const parent = sel.$from.parent;
    if (parent.type === n.heading) return "h" + parent.attrs.level;
    if (parent.type === n.paragraph) return "paragraph";
    if (parent.type === n.code_block) return "code";
    return "";
}

export function currentAlign(state: EditorState): string {
    const parent = state.selection.$from.parent;
    return (parent.attrs && parent.attrs.align) || "left";
}

// ------------------------------------------------------------------ bloky a znacky

export const setParagraph: Command = setBlockType(n.paragraph);
export const setHeading = (level: number): Command => setBlockType(n.heading, { level });
export const toggleBold = toggleMark(m.strong);
export const toggleItalic = toggleMark(m.em);
export const toggleUnderline = toggleMark(m.underline);
export const toggleStrike = toggleMark(m.strike);
export const toggleSup = toggleMark(m.sup);
export const toggleSub = toggleMark(m.sub);

/** Prepnuti seznamu: stejny typ -> zrusit, jiny typ -> zmenit, jinak zabalit. */
export function toggleList(type: NodeType): Command {
    return (state, dispatch) => {
        const list = findListAround(state);
        if (list && list.node.type === type) return liftListItem(n.list_item)(state, dispatch);
        if (list) {
            if (dispatch) dispatch(state.tr.setNodeMarkup(list.pos, type, list.node.attrs));
            return true;
        }
        return wrapInList(type)(state, dispatch);
    };
}

function findListAround(state: EditorState): { node: PMNode; pos: number } | null {
    const { $from } = state.selection;
    for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type === n.bullet_list || node.type === n.ordered_list) return { node, pos: $from.before(d) };
    }
    return null;
}

export const toggleBlockquote: Command = (state, dispatch) => (findParent(state, n.blockquote) ? lift(state, dispatch) : wrapIn(n.blockquote)(state, dispatch));

/** Zarovnani vsech odstavcu a nadpisu ve vyberu. */
export function setAlign(align: string | null): Command {
    return (state, dispatch) => {
        const { from, to } = state.selection;
        const tr = state.tr;
        let changed = false;
        state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type === n.paragraph || node.type === n.heading) {
                const value = align === "left" ? null : align;
                if (node.attrs.align !== value) {
                    tr.setNodeMarkup(pos, undefined, { ...node.attrs, align: value });
                    changed = true;
                }
            }
        });
        if (changed && dispatch) dispatch(tr);
        return changed;
    };
}

/** Odsazeni: v seznamu vnoreni polozky, jinak margin-left odstavce (po INDENT_STEP px). */
export function indent(dir: 1 | -1): Command {
    return (state, dispatch) => {
        if (findListAround(state)) {
            return dir > 0 ? sinkListItem(n.list_item)(state, dispatch) : liftListItem(n.list_item)(state, dispatch);
        }
        const { from, to } = state.selection;
        const tr = state.tr;
        let changed = false;
        state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type === n.paragraph || node.type === n.heading) {
                const value = Math.max(0, Math.min(8, (node.attrs.indent || 0) + dir));
                if (value !== node.attrs.indent) {
                    tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: value });
                    changed = true;
                }
            }
        });
        if (changed && dispatch) dispatch(tr);
        return changed;
    };
}
export { INDENT_STEP };

/** Odebere vsechno formatovani textu ve vyberu (tucne, odkazy zustanou). */
export const clearFormatting: Command = (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (empty) return false;
    if (dispatch) {
        const tr = state.tr;
        for (const type of [m.strong, m.em, m.underline, m.strike, m.sup, m.sub, m.code, m.textstyle]) tr.removeMark(from, to, type);
        dispatch(tr);
    }
    return true;
};

// ------------------------------------------------------------------ odkazy

/** Odkaz kolem kurzoru / vyberu: cely souvisly usek se stejnym odkazem. */
export function linkAt(state: EditorState): { from: number; to: number; mark: Mark } | null {
    const { $from, from, to } = state.selection;
    const parent = $from.parent;
    if (!parent.isTextblock) return null;
    const probe = state.doc.resolve(from === to ? from : Math.min(from + 1, to));
    const mark = m.link.isInSet(probe.marks()) || m.link.isInSet($from.marks());
    if (!mark) return null;
    const start = $from.start();
    const runs: Array<{ from: number; to: number }> = [];
    let cur: { from: number; to: number } | null = null;
    parent.forEach((child, offset) => {
        const s = start + offset;
        const e = s + child.nodeSize;
        if (mark.isInSet(child.marks)) {
            if (cur && cur.to === s) cur.to = e;
            else { cur = { from: s, to: e }; runs.push(cur); }
        } else cur = null;
    });
    const run = runs.find((r) => r.from <= from && r.to >= from) || runs.find((r) => r.from >= from && r.to <= to);
    return run ? { ...run, mark } : null;
}

export function setLink(attrs: { href: string; target: string | null }, text?: string): Command {
    return (state, dispatch) => {
        const existing = linkAt(state);
        let { from, to } = state.selection;
        if (existing) { from = existing.from; to = existing.to; }
        const keep = existing ? { cls: existing.mark.attrs.cls, style: existing.mark.attrs.style, title: existing.mark.attrs.title } : {};
        const mark = m.link.create({ ...keep, href: attrs.href, target: attrs.target, rel: attrs.target === "_blank" ? "noopener" : null });
        if (!dispatch) return true;
        const tr = state.tr;
        if (from === to) {
            const label = text || attrs.href;
            tr.insert(from, schema.text(label, [mark]));
            tr.setSelection(TextSelection.create(tr.doc, from + label.length));
        } else {
            tr.removeMark(from, to, m.link).addMark(from, to, mark);
        }
        dispatch(tr.scrollIntoView());
        return true;
    };
}

export const removeLink: Command = (state, dispatch) => {
    const link = linkAt(state);
    if (!link) return false;
    if (dispatch) dispatch(state.tr.removeMark(link.from, link.to, m.link));
    return true;
};

// ------------------------------------------------------------------ vkladani

export function insertInline(node: PMNode): Command {
    return (state, dispatch) => {
        if (dispatch) dispatch(state.tr.replaceSelectionWith(node, false).scrollIntoView());
        return true;
    };
}

/**
 * Vlozi blok za aktualni blok nejvyssi urovne (nerozdeli rozepsany odstavec).
 * V prazdnem odstavci ho nahradi.
 */
export function insertBlock(node: PMNode): Command {
    return (state, dispatch) => {
        const { $from } = state.selection;
        if (!dispatch) return true;
        const tr = state.tr;
        const parent = $from.parent;
        if (parent.type === n.paragraph && parent.content.size === 0 && $from.depth >= 1) {
            tr.replaceWith($from.before($from.depth), $from.after($from.depth), node);
            tr.setSelection(NodeSelection.create(tr.doc, $from.before($from.depth)));
        } else {
            const depth = Math.max(1, Math.min($from.depth, 1));
            const pos = $from.after(depth);
            tr.insert(pos, node);
            tr.setSelection(NodeSelection.create(tr.doc, pos));
        }
        dispatch(tr.scrollIntoView());
        return true;
    };
}

export interface TableOptions {
    rows: number;
    cols: number;
    /** Zahlavi: prvni radek / prvni sloupec (th). */
    headerRow?: boolean;
    headerCol?: boolean;
    /** Sirka ("100%", "600px"), null = automaticky. */
    width?: string | null;
    /** Trida tabulky (img-responsive = prizpusobi se sirce stranky). */
    cls?: string | null;
    /** Ohraniceni (atribut border). */
    border?: boolean;
}

export function createTable(o: TableOptions): PMNode {
    const trs: PMNode[] = [];
    for (let r = 0; r < o.rows; r++) {
        const cells: PMNode[] = [];
        for (let c = 0; c < o.cols; c++) {
            const head = (o.headerRow && r === 0) || (o.headerCol && c === 0);
            cells.push((head ? n.table_header : n.table_cell).createAndFill()!);
        }
        trs.push(n.table_row.create(null, cells));
    }
    return n.table.create({
        cls: o.cls === undefined ? "img-responsive" : o.cls,
        width: o.width || null,
        border: o.border === false ? "0" : "1",
        cellpadding: "1",
        cellspacing: "1",
    }, trs);
}

/** Vlozi text na misto vyberu (napr. nezlomitelnou mezeru). */
export function insertText(text: string): Command {
    return (state, dispatch) => {
        if (!state.selection.$from.parent.inlineContent) return false;
        if (dispatch) dispatch(state.tr.insertText(text).scrollIntoView());
        return true;
    };
}

/** Barva textu / zvyrazneni ve vyberu. value = null -> odebrat. */
export function setTextStyle(key: "color" | "background", value: string | null): Command {
    return (state, dispatch) => {
        const { from, to, empty } = state.selection;
        if (empty) return false;
        if (!dispatch) return true;
        const tr = state.tr;
        // kazdy usek si zachova ostatni vlastnosti (napr. velikost pisma)
        state.doc.nodesBetween(from, to, (node, pos) => {
            if (!node.isInline) return;
            const s = Math.max(from, pos);
            const e = Math.min(to, pos + node.nodeSize);
            const cur = m.textstyle.isInSet(node.marks);
            const attrs = { color: cur?.attrs.color ?? null, background: cur?.attrs.background ?? null, size: cur?.attrs.size ?? null, [key]: value };
            tr.removeMark(s, e, m.textstyle);
            if (attrs.color || attrs.background || attrs.size) tr.addMark(s, e, m.textstyle.create(attrs));
        });
        dispatch(tr);
        return true;
    };
}

/** Aktualni barva (color / background) na zacatku vyberu. */
export function currentTextStyle(state: EditorState, key: "color" | "background"): string | null {
    const { $from, from, to, empty } = state.selection;
    let mark = m.textstyle.isInSet(empty ? state.storedMarks || $from.marks() : []);
    if (!empty) state.doc.nodesBetween(from, to, (node) => { if (!mark && node.isInline) mark = m.textstyle.isInSet(node.marks); });
    return mark ? mark.attrs[key] : null;
}

// ------------------------------------------------------------------ bloky (uchyt a menu)

/** Blok nejvyssi urovne na pozici (zacatek bloku). */
export function topBlockAt(doc: PMNode, pos: number): { node: PMNode; pos: number; index: number } | null {
    const $pos = doc.resolve(Math.min(pos, doc.content.size));
    const index = $pos.index(0);
    if (index >= doc.childCount) return null;
    let start = 0;
    for (let i = 0; i < index; i++) start += doc.child(i).nodeSize;
    return { node: doc.child(index), pos: start, index };
}

export function moveBlock(view: EditorView, pos: number, dir: -1 | 1): boolean {
    const { state } = view;
    const block = topBlockAt(state.doc, pos);
    if (!block) return false;
    const target = block.index + dir;
    if (target < 0 || target >= state.doc.childCount) return false;
    const other = state.doc.child(target);
    const tr = state.tr.delete(block.pos, block.pos + block.node.nodeSize);
    const insertAt = dir < 0 ? block.pos - other.nodeSize : block.pos + other.nodeSize;
    tr.insert(insertAt, block.node);
    selectBlock(tr, insertAt, block.node);
    view.dispatch(tr.scrollIntoView());
    return true;
}

export function duplicateBlock(view: EditorView, pos: number): void {
    const block = topBlockAt(view.state.doc, pos);
    if (!block) return;
    const at = block.pos + block.node.nodeSize;
    const tr = view.state.tr.insert(at, block.node.copy(block.node.content));
    selectBlock(tr, at, block.node);
    view.dispatch(tr.scrollIntoView());
}

export function deleteBlock(view: EditorView, pos: number): void {
    const block = topBlockAt(view.state.doc, pos);
    if (!block) return;
    const tr = view.state.tr.delete(block.pos, block.pos + block.node.nodeSize);
    if (tr.doc.childCount === 0) tr.insert(0, n.paragraph.create());
    const sel = Math.min(block.pos, tr.doc.content.size);
    tr.setSelection(TextSelection.near(tr.doc.resolve(sel)));
    view.dispatch(tr.scrollIntoView());
}

export function insertParagraphAfter(view: EditorView, pos: number): void {
    const block = topBlockAt(view.state.doc, pos);
    if (!block) return;
    const at = block.pos + block.node.nodeSize;
    const tr = view.state.tr.insert(at, n.paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, at + 1));
    view.dispatch(tr.scrollIntoView());
    view.focus();
}

/** Prevod bloku (odstavec / nadpis / citace / seznam): kurzor do bloku a spustit prikaz. */
export function convertBlock(view: EditorView, pos: number, command: Command): void {
    const block = topBlockAt(view.state.doc, pos);
    if (!block) return;
    const inner = block.node.isTextblock ? block.pos + 1 : block.pos + 2;
    const end = block.pos + block.node.nodeSize - (block.node.isTextblock ? 1 : 2);
    const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, Math.min(inner, end), Math.max(inner, end)));
    view.dispatch(tr);
    command(view.state, view.dispatch);
    view.focus();
}

function selectBlock(tr: import("prosemirror-state").Transaction, pos: number, node: PMNode): void {
    if (NodeSelection.isSelectable(node)) tr.setSelection(NodeSelection.create(tr.doc, pos));
    else tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
}

// ------------------------------------------------------------------ sloupce

export interface ColumnsAttrs {
    layout: string;
    widths: string | null;
    gap: string | null;
    valign: string | null;
    mobile: string | null;
}

/** Pocet sloupcu podle rozvrzeni (vlastni = pocet sirek). */
export function columnsCount(a: { layout: string; widths: string | null }): number {
    if (a.layout === "custom") return Math.max(2, Math.min(4, (safeColumnWidths(a.widths) || "1fr 1fr").split(" ").length));
    return a.layout === "3" ? 3 : a.layout === "4" ? 4 : 2;
}

export function createColumns(attrs: Partial<ColumnsAttrs>): PMNode {
    const a = { layout: "2", widths: null, gap: null, valign: null, mobile: null, ...attrs };
    const cols: PMNode[] = [];
    for (let i = 0; i < columnsCount(a); i++) cols.push(n.column.create(null, n.paragraph.create()));
    return n.columns.create(a, cols);
}

/**
 * Nove nastaveni sloupcu na pozici. Pri vice sloupcich pribudou prazdne, pri mene se obsah
 * odebranych presune do posledniho ponechaneho (nic se neztrati).
 */
export function updateColumns(view: EditorView, pos: number, attrs: ColumnsAttrs): void {
    const node = view.state.doc.nodeAt(pos);
    if (!node || node.type !== n.columns) return;
    const count = columnsCount(attrs);
    const cols: PMNode[] = [];
    node.forEach((c) => cols.push(c));
    while (cols.length < count) cols.push(n.column.create(null, n.paragraph.create()));
    if (cols.length > count) {
        const extra = cols.splice(count);
        let content = cols[count - 1].content;
        // prazdny sloupec (jen prazdny odstavec) nic neprinasi
        const isEmpty = (c: PMNode) => c.childCount === 1 && c.firstChild!.type === n.paragraph && c.firstChild!.content.size === 0;
        for (const c of extra) if (!isEmpty(c)) content = content.append(c.content);
        cols[count - 1] = cols[count - 1].copy(content);
    }
    const next = n.columns.create(attrs, cols);
    const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, next);
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    view.dispatch(tr.scrollIntoView());
}

/** Zrusit sloupce: obsah vsech sloupcu pod sebou na miste bloku. */
export function unwrapColumns(view: EditorView, pos: number): void {
    const node = view.state.doc.nodeAt(pos);
    if (!node || node.type !== n.columns) return;
    const blocks: PMNode[] = [];
    node.forEach((c) => c.forEach((b) => blocks.push(b)));
    const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, blocks);
    tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
    view.dispatch(tr.scrollIntoView());
}

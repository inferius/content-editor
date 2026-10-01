/**
 * Kontextova lista tabulky (jako v CKEditoru): kdyz je kurzor v tabulce, nad ni se ukaze
 * Sloupec / Radek / Sloucit (nabidky), Vlastnosti tabulky, Vlastnosti bunky a Smazat.
 * K tomu uchyt v levem hornim rohu (oznaci celou tabulku). Odstavec pred / za tabulku
 * vlozi "+" u bloku (handle.ts).
 *
 * Lista je uvnitr posuvne casti editoru (placeInside) - jede s textem a neprekryva stranku.
 */
import { NodeSelection, type Command, type EditorState } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import {
    CellSelection, TableMap, findTable, isInTable, selectionCell, selectedRect,
    addColumnBefore, addColumnAfter, addRowBefore, addRowAfter, deleteColumn, deleteRow,
    mergeCells, splitCell, toggleHeaderRow, toggleHeaderColumn, moveTableRow, moveTableColumn,
} from "prosemirror-tables";
import { h, showMenu, placeInside, type MenuItem } from "./dom";
import { icon } from "./icons";
import { schema } from "../core/schema";

export interface TableToolsActions {
    tableProps(): void;
    cellProps(): void;
    /** Spodni hrana lepive listy editoru na obrazovce (lista tabulky pod ni nezajede). */
    stickyBottom(): number;
}

/** Smazat tabulku u kurzoru nebo oznacenou celou (deleteTable z prosemirror-tables hleda jen od kurzoru v bunce). */
const deleteTableAt: Command = (state, dispatch) => {
    const t = tableAt(state);
    if (!t) return false;
    if (dispatch) dispatch(state.tr.delete(t.pos, t.pos + t.node.nodeSize).scrollIntoView());
    return true;
};

/** Tabulka u kurzoru (nebo cela oznacena): pozice a uzel. */
export function tableAt(state: EditorState): { pos: number; node: PMNode } | null {
    const sel = state.selection;
    if (sel instanceof NodeSelection && sel.node.type === schema.nodes.table) return { pos: sel.from, node: sel.node };
    const t = findTable(sel.$from);
    return t ? { pos: t.pos, node: t.node } : null;
}

/** Bunky, se kterymi se pracuje: vybrane (tazenim / Shift) nebo ta s kurzorem. [{pos, node}] */
export function targetCells(state: EditorState): Array<{ pos: number; node: PMNode }> {
    const sel = state.selection;
    const out: Array<{ pos: number; node: PMNode }> = [];
    if (sel instanceof CellSelection) {
        sel.forEachCell((node, pos) => out.push({ pos, node }));
        return out;
    }
    if (!isInTable(state)) return out;
    const $cell = selectionCell(state);
    const node = state.doc.nodeAt($cell.pos);
    if (node) out.push({ pos: $cell.pos, node });
    return out;
}

/** Sloucit bunku s kurzorem se sousedni (nahoru / vpravo / dolu / vlevo). */
function mergeWith(dir: "up" | "right" | "down" | "left"): Command {
    return (state, dispatch) => {
        if (!isInTable(state) || state.selection instanceof CellSelection) return false;
        const $cell = selectionCell(state);
        const table = $cell.node(-1);
        const start = $cell.start(-1);
        const map = TableMap.get(table);
        const rel = $cell.pos - start;
        const next = map.nextCell(rel, dir === "left" || dir === "right" ? "horiz" : "vert", dir === "left" || dir === "up" ? -1 : 1);
        if (next === null || next === undefined) return false;
        // jen soused se stejnou hranou - jinak by obdelnik vyberu zabral i dalsi bunku
        const a = map.findCell(rel);
        const b = map.findCell(next);
        if (dir === "left" || dir === "right" ? a.top !== b.top || a.bottom !== b.bottom : a.left !== b.left || a.right !== b.right) return false;
        const st = state.apply(state.tr.setSelection(CellSelection.create(state.doc, $cell.pos, start + next)));
        // st.doc je stejny dokument (zmenil se jen vyber) - transakci jde poslat do puvodniho stavu
        return mergeCells(st, dispatch);
    };
}

/** Oznacit cely sloupec / radek s kurzorem. */
function selectLine(kind: "col" | "row"): Command {
    return (state, dispatch) => {
        if (!isInTable(state)) return false;
        const $cell = selectionCell(state);
        if (dispatch) dispatch(state.tr.setSelection(kind === "col" ? CellSelection.colSelection($cell) : CellSelection.rowSelection($cell)));
        return true;
    };
}

/** Presun radku / sloupce s kurzorem o jedno misto. */
function moveLine(kind: "row" | "col", delta: number): Command {
    return (state, dispatch) => {
        if (!isInTable(state)) return false;
        const rect = selectedRect(state);
        const from = kind === "row" ? rect.top : rect.left;
        const count = kind === "row" ? rect.map.height : rect.map.width;
        const to = from + delta;
        if (to < 0 || to >= count) return false;
        return kind === "row"
            ? moveTableRow({ from, to, select: true })(state, dispatch)
            : moveTableColumn({ from, to, select: true })(state, dispatch);
    };
}

function headerRowOn(table: PMNode): boolean {
    const first = table.firstChild;
    if (!first) return false;
    let all = true;
    first.forEach((c) => { if (c.type !== schema.nodes.table_header) all = false; });
    return all;
}

function headerColOn(table: PMNode): boolean {
    let all = true;
    table.forEach((row) => { if (row.firstChild && row.firstChild.type !== schema.nodes.table_header) all = false; });
    return all;
}

export class TableTools {
    readonly dom: HTMLElement;
    private handle: HTMLButtonElement;
    private buttons: Array<{ el: HTMLButtonElement; enabled: (s: EditorState) => boolean }> = [];

    constructor(private view: EditorView, private actions: TableToolsActions, private container: HTMLElement) {
        const run = (c: Command) => () => { c(this.view.state, this.view.dispatch); this.view.focus(); };
        const item = (label: string, iconName: string, c: Command, extra: Partial<MenuItem> = {}): MenuItem => ({
            label, icon: iconName, onClick: run(c), disabled: !c(this.view.state), ...extra,
        });
        const dropdown = (iconName: string, title: string, items: () => Array<MenuItem | "-" | { title: string }>) => {
            const b: HTMLButtonElement = h("button", {
                type: "button", class: "ce-btn ce-btn-caret", title, "aria-label": title, "aria-haspopup": "true",
                onMousedown: (e: MouseEvent) => e.preventDefault(),
                onClick: (e: MouseEvent) => {
                    const menu = showMenu(b, items());
                    // otevreno klavesnici (Enter / mezernik) -> fokus na prvni polozku
                    if (e.detail === 0) menu.querySelector<HTMLButtonElement>(".ce-menu-item:not(:disabled)")?.focus();
                },
            }, icon(iconName, 18), icon("chevronDown", 11));
            return b;
        };
        const action = (iconName: string, title: string, onClick: () => void, enabled: (s: EditorState) => boolean = () => true, cls = "") => {
            const b: HTMLButtonElement = h("button", {
                type: "button", class: "ce-btn " + cls, title, "aria-label": title,
                onMousedown: (e: MouseEvent) => e.preventDefault(),
                onClick,
            }, icon(iconName, 18));
            this.buttons.push({ el: b, enabled });
            return b;
        };
        const colMenu = () => {
            const t = tableAt(this.view.state);
            const on = !!t && headerColOn(t.node);
            return [
                item("Záhlaví - první sloupec", on ? "check" : "headerCol", toggleHeaderColumn, { active: on }),
                "-" as const,
                item("Vložit sloupec vlevo", "colLeft", addColumnBefore),
                item("Vložit sloupec vpravo", "colRight", addColumnAfter),
                item("Posunout doleva", "chevronLeft", moveLine("col", -1)),
                item("Posunout doprava", "chevronRight", moveLine("col", 1)),
                "-" as const,
                item("Vybrat sloupec", "selectAll", selectLine("col")),
                item("Smazat sloupec", "colDelete", deleteColumn, { danger: true }),
            ];
        };
        const rowMenu = () => {
            const t = tableAt(this.view.state);
            const on = !!t && headerRowOn(t.node);
            return [
                item("Záhlaví - první řádek", on ? "check" : "headerRow", toggleHeaderRow, { active: on }),
                "-" as const,
                item("Vložit řádek nad", "rowAbove", addRowBefore),
                item("Vložit řádek pod", "rowBelow", addRowAfter),
                item("Posunout nahoru", "up", moveLine("row", -1)),
                item("Posunout dolů", "down", moveLine("row", 1)),
                "-" as const,
                item("Vybrat řádek", "selectAll", selectLine("row")),
                item("Smazat řádek", "rowDelete", deleteRow, { danger: true }),
            ];
        };
        const mergeMenu = () => {
            const multi = this.view.state.selection instanceof CellSelection;
            return [
                ...(multi ? [item("Sloučit vybrané buňky", "merge", mergeCells), "-" as const] : []),
                item("Sloučit s buňkou nahoře", "mergeUp", mergeWith("up")),
                item("Sloučit s buňkou vpravo", "mergeRight", mergeWith("right")),
                item("Sloučit s buňkou dole", "mergeDown", mergeWith("down")),
                item("Sloučit s buňkou vlevo", "mergeLeft", mergeWith("left")),
                "-" as const,
                item("Rozdělit sloučenou buňku", "split", splitCell),
            ];
        };
        const colBtn = dropdown("tableCol", "Sloupec", colMenu);
        const rowBtn = dropdown("tableRow", "Řádek", rowMenu);
        const mergeBtn = dropdown("merge", "Sloučit buňky", mergeMenu);
        this.dom = h("div", { class: "ce-bubble ce-bubble-inside ce-tabletools", role: "toolbar", "aria-label": "Tabulka" },
            colBtn, rowBtn, mergeBtn,
            h("span", { class: "ce-linkpop-sep" }),
            action("tableProps", "Vlastnosti tabulky (šířka, zarovnání, ohraničení)", () => this.actions.tableProps()),
            action("cellProps", "Vlastnosti buňky (pozadí, zarovnání, ohraničení)", () => this.actions.cellProps(), (s) => targetCells(s).length > 0),
            h("span", { class: "ce-linkpop-sep" }),
            action("trash", "Smazat tabulku", () => { deleteTableAt(this.view.state, this.view.dispatch); this.view.focus(); }, () => true, "ce-btn-danger"),
        );
        this.dom.hidden = true;
        this.dom.addEventListener("mousedown", (e) => e.preventDefault());

        // uchyt: oznacit celou tabulku
        this.handle = h("button", {
            type: "button", class: "ce-table-handle", title: "Označit celou tabulku (pak jde smazat, kopírovat, přesunout)", "aria-label": "Označit celou tabulku",
            onMousedown: (e: MouseEvent) => e.preventDefault(),
            onClick: () => this.selectTable(),
        }, icon("selectAll", 12));
        this.handle.hidden = true;
        container.append(this.dom, this.handle);
    }

    update(view: EditorView, suppressed: boolean): void {
        const t = suppressed || !view.hasFocus() ? null : tableAt(view.state);
        const dom = t ? view.nodeDOM(t.pos) as HTMLElement | null : null;
        const table = dom && dom.nodeName !== "TABLE" ? dom.querySelector("table") : dom;
        if (!t || !table) {
            this.hide();
            return;
        }
        for (const b of this.buttons) b.el.disabled = !b.enabled(view.state);
        const r = table.getBoundingClientRect();
        this.dom.hidden = false;
        // vodorovne na stred tabulky (placeInside), svisle: nad tabulku, kdyz neni misto tak pod ni,
        // jinak prilepit k hornimu okraji viditelne casti (dlouha tabulka) - jako CKEditor
        placeInside(this.dom, this.container, { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, "above", "center");
        const cr = this.container.getBoundingClientRect();
        const ox = this.container.scrollLeft - cr.left - this.container.clientLeft;
        const oy = this.container.scrollTop - cr.top - this.container.clientTop;
        const hgt = this.dom.offsetHeight;
        // horni okraj viditelne casti: obrazovka, lepiva lista editoru (pod ni lepiva hlavicka stranky)
        const visTop = Math.max(cr.top, 0, this.actions.stickyBottom()) + 4;
        const visBottom = Math.min(cr.bottom, window.innerHeight) - 4;
        let y: number;
        if (r.top - hgt - 22 >= visTop) y = r.top - hgt - 22;
        else if (r.bottom + 8 + hgt <= visBottom) y = r.bottom + 8;
        else y = Math.max(visTop, Math.min(r.top + 4, visBottom - hgt));
        this.dom.style.top = Math.round(y + oy) + "px";

        // uchyt: polohu dopocitat v souradnicich obsahu kontejneru
        const place = (el: HTMLElement, x: number, y: number) => {
            el.hidden = false;
            el.style.left = Math.round(x + ox) + "px";
            el.style.top = Math.round(y + oy) + "px";
        };
        place(this.handle, r.left - 1, r.top - 16);
        this.handle.classList.toggle("is-active", view.state.selection instanceof NodeSelection);
    }

    private selectTable(): void {
        const t = tableAt(this.view.state);
        if (!t) return;
        this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, t.pos)));
        this.view.focus();
    }

    /** Fokus na prvni tlacitko listy (Alt+F10 v tabulce). */
    focusFirst(): boolean {
        if (this.dom.hidden) return false;
        this.dom.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
        return true;
    }

    hide(): void {
        this.dom.hidden = true;
        this.handle.hidden = true;
    }

    destroy(): void {
        this.dom.remove();
        this.handle.remove();
    }
}

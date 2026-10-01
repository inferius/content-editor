/**
 * Uchyt bloku: vlevo u bloku pod mysi "+" (vlozit pod) a uchyt (pretazeni = presun,
 * klik = menu bloku). Pracuje s bloky nejvyssi urovne dokumentu.
 */
import { NodeSelection, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { h, showMenu, closeMenu, type MenuItem } from "../ui/dom";
import { icon } from "../ui/icons";
import { schema } from "../core/schema";
import * as cmd from "./commands";
import type { Features } from "./features";

export interface HandleActions {
    features: Features;
    editBlock(pos: number): void;
    insertImage(): void;
    insertButton(): void;
    insertVideo(): void;
    insertTable(anchor?: HTMLElement): void;
    insertRaw(): void;
    insertColumns(layout: string | null, anchor?: HTMLElement): void;
    unwrapColumns(pos: number): void;
    /** Nabidka promennych (bez def = vyber z menu u prvku anchor). */
    insertVariable(def: null, anchor?: HTMLElement): void;
    hasVariables(): boolean;
    isSource(): boolean;
}

const n = schema.nodes;

const TYPE_LABEL: Record<string, string> = {
    paragraph: "Odstavec", heading: "Nadpis", bullet_list: "Odrážky", ordered_list: "Číslovaný seznam",
    blockquote: "Citace", horizontal_rule: "Čára", code_block: "Kód", button: "Tlačítko", spacer: "Mezera",
    video: "Video", rawhtml: "HTML blok", container: "Kontejner", table: "Tabulka", columns: "Sloupce",
};

const LIST_TYPES = ["bullet_list", "ordered_list"];

export class BlockHandle {
    readonly dom: HTMLElement;
    private grip: HTMLButtonElement;
    private current: { pos: number; node: PMNode; el: HTMLElement } | null = null;
    private hideTimer = 0;

    constructor(private view: EditorView, private wrapper: HTMLElement, private actions: HandleActions) {
        const plus = h("button", {
            type: "button", class: "ce-handle-btn", title: "Vložit blok pod", "aria-label": "Vložit blok pod",
            onMousedown: (e: MouseEvent) => e.preventDefault(),
            onClick: () => this.insertMenu(plus),
        }, icon("plus", 16));
        this.grip = h("button", {
            type: "button", class: "ce-handle-btn ce-handle-grip", title: "Přetažením přesunete blok, kliknutím otevřete menu",
            "aria-label": "Menu bloku",
            onMousedown: (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); },
            onClick: () => { if (!this.justDragged) this.blockMenu(); },
        }, icon("grip", 16));
        this.grip.addEventListener("pointerdown", (e) => this.pointerDown(e));
        this.dom = h("div", { class: "ce-handle", contenteditable: "false" }, plus, this.grip);
        this.dom.hidden = true;
        wrapper.appendChild(this.dom);

        wrapper.addEventListener("mousemove", this.onMove);
        wrapper.addEventListener("mouseleave", this.onLeave);
        this.dom.addEventListener("mouseenter", () => clearTimeout(this.hideTimer));
    }

    private onMove = (e: MouseEvent): void => {
        if (this.actions.isSource() || this.wrapper.classList.contains("is-dragging")) return;
        if (this.dom.contains(e.target as Node)) return;
        const el = this.blockElementAt(e);
        if (!el) return;
        let pos: number;
        try {
            pos = this.view.posAtDOM(el, 0);
        } catch {
            return;
        }
        const block = cmd.topBlockAt(this.view.state.doc, pos);
        if (!block) return;
        clearTimeout(this.hideTimer);
        this.current = { pos: block.pos, node: block.node, el };
        const wr = this.wrapper.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        // svisle zarovnat k prvnimu radku bloku
        const lh = parseFloat(getComputedStyle(el).lineHeight) || 24;
        this.dom.style.top = (r.top - wr.top + this.wrapper.scrollTop + Math.max(0, (Math.min(lh, r.height) - 28) / 2)) + "px";
        // vodorovne k levemu okraji obsahu (ve vzhledu webu je obsah odsazeny a zuzeny)
        const cr = this.view.dom.getBoundingClientRect();
        this.dom.style.left = Math.max(2, cr.left - wr.left + this.wrapper.scrollLeft + parseFloat(getComputedStyle(this.view.dom).paddingLeft) - 54) + "px";
        this.dom.hidden = false;
        this.grip.title = (TYPE_LABEL[block.node.type.name] || "Blok") + " - přetažením přesunete, kliknutím otevřete menu";
    };

    private onLeave = (): void => {
        clearTimeout(this.hideTimer);
        this.hideTimer = window.setTimeout(() => { if (!document.querySelector(".ce-menu")) this.dom.hidden = true; }, 300);
    };

    /** Prvek bloku nejvyssi urovne pod mysi (i kdyz je mys v levem okraji). */
    private blockElementAt(e: MouseEvent): HTMLElement | null {
        const root = this.view.dom;
        let target = e.target as HTMLElement | null;
        if (!target || !root.contains(target) || target === root) {
            const r = root.getBoundingClientRect();
            const cs = getComputedStyle(root);
            const x = r.left + parseFloat(cs.paddingLeft) + 8;
            target = document.elementFromPoint(x, e.clientY) as HTMLElement | null;
            if (!target || !root.contains(target) || target === root) return null;
        }
        while (target && target.parentElement !== root) target = target.parentElement;
        return target;
    }

    // ------------------------------------------------------------------ presun tazenim za uchyt
    //
    // Vlastni tazeni (ne HTML5 drag & drop): puvodni blok zeslabne, cara ukazuje, kam blok
    // dopadne. U okraje obsahu se posouva. Esc tazeni zrusi. Klik bez pohybu = menu bloku.

    private justDragged = false;
    private drag: {
        index: number; pos: number; node: PMNode; el: HTMLElement;
        startX: number; startY: number;
        line: HTMLElement | null; shade: HTMLElement | null; target: number; active: boolean;
        scrollTimer: number; lastY: number;
    } | null = null;

    private pointerDown(e: PointerEvent): void {
        if (e.button !== 0 || !this.current || this.actions.isSource()) return;
        const block = cmd.topBlockAt(this.view.state.doc, this.current.pos);
        if (!block) return;
        this.drag = {
            index: block.index, pos: block.pos, node: block.node, el: this.current.el,
            startX: e.clientX, startY: e.clientY,
            line: null, shade: null, target: block.index, active: false, scrollTimer: 0, lastY: e.clientY,
        };
        window.addEventListener("pointermove", this.pointerMove);
        window.addEventListener("pointerup", this.pointerUp);
        window.addEventListener("pointercancel", this.cancelDrag);
        window.addEventListener("keydown", this.dragKey, true);
    }

    private pointerMove = (e: PointerEvent): void => {
        const d = this.drag;
        if (!d) return;
        if (!d.active) {
            if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) < 5) return;
            this.beginDrag();
        }
        e.preventDefault();
        d.lastY = e.clientY;
        this.updateTarget(e.clientY);
        this.autoScroll();
    };

    private beginDrag(): void {
        const d = this.drag!;
        d.active = true;
        closeMenu();
        d.line = h("div", { class: "ce-drop-line", "aria-hidden": "true" });
        this.wrapper.appendChild(d.line);
        // zeslabeni presouvaneho bloku: prekryv v obalu (trida primo na bloku by ProseMirror vratil)
        const wr = this.wrapper.getBoundingClientRect();
        const r = d.el.getBoundingClientRect();
        d.shade = h("div", { class: "ce-drag-source", "aria-hidden": "true" });
        Object.assign(d.shade.style, {
            top: (r.top - wr.top + this.wrapper.scrollTop - 4) + "px",
            left: (r.left - wr.left + this.wrapper.scrollLeft - 6) + "px",
            width: (r.width + 12) + "px",
            height: (r.height + 8) + "px",
        });
        this.wrapper.appendChild(d.shade);
        this.wrapper.classList.add("is-dragging");
        document.body.classList.add("ce-body-dragging");
        this.dom.hidden = true;
    }

    /** Index, pred ktery blok dopadne (0..childCount), a poloha cary. */
    private updateTarget(y: number): void {
        const d = this.drag!;
        const doc = this.view.state.doc;
        const rects: DOMRect[] = [];
        let pos = 0;
        for (let i = 0; i < doc.childCount; i++) {
            const dom = this.view.nodeDOM(pos) as HTMLElement | null;
            rects.push(dom && dom.getBoundingClientRect ? dom.getBoundingClientRect() : new DOMRect());
            pos += doc.child(i).nodeSize;
        }
        let target = rects.length;
        for (let i = 0; i < rects.length; i++) {
            if (y < rects[i].top + rects[i].height / 2) { target = i; break; }
        }
        d.target = target;
        // stejne misto (pred sebou / za sebou) = bez zmeny
        const same = target === d.index || target === d.index + 1;
        const line = d.line!;
        line.classList.toggle("is-same", same);
        const wr = this.wrapper.getBoundingClientRect();
        const content = this.view.dom.getBoundingClientRect();
        const cs = getComputedStyle(this.view.dom);
        let top: number;
        if (!rects.length) top = content.top;
        else if (target === 0) top = rects[0].top - 4;
        else if (target >= rects.length) top = rects[rects.length - 1].bottom + 4;
        else top = (rects[target - 1].bottom + rects[target].top) / 2;
        line.style.top = (top - wr.top + this.wrapper.scrollTop - 1) + "px";
        line.style.left = (content.left - wr.left + this.wrapper.scrollLeft + parseFloat(cs.paddingLeft) - 6) + "px";
        line.style.width = Math.max(40, content.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) + 12) + "px";
    }

    /** U horniho / dolniho okraje obsahu (nebo okna) posouvat, dokud tam mys je. */
    private autoScroll(): void {
        const d = this.drag;
        if (!d || d.scrollTimer) return;
        const step = () => {
            const dd = this.drag;
            if (!dd || !dd.active) { if (dd) dd.scrollTimer = 0; return; }
            const wr = this.wrapper.getBoundingClientRect();
            const scrollable = this.wrapper.scrollHeight > this.wrapper.clientHeight + 1;
            const top = scrollable ? Math.max(wr.top, 0) : 0;
            const bottom = scrollable ? Math.min(wr.bottom, window.innerHeight) : window.innerHeight;
            const edge = 48;
            let dy = 0;
            if (dd.lastY < top + edge) dy = -Math.ceil((top + edge - dd.lastY) / 4);
            else if (dd.lastY > bottom - edge) dy = Math.ceil((dd.lastY - (bottom - edge)) / 4);
            if (!dy) { dd.scrollTimer = 0; return; }
            if (scrollable) this.wrapper.scrollTop += dy;
            else window.scrollBy(0, dy);
            this.updateTarget(dd.lastY);
            dd.scrollTimer = window.setTimeout(step, 16);
        };
        d.scrollTimer = window.setTimeout(step, 16);
    }

    private pointerUp = (): void => {
        const d = this.drag;
        if (!d) return;
        const moved = d.active && d.target !== d.index && d.target !== d.index + 1;
        const wasActive = d.active;
        this.endDrag();
        if (wasActive) {
            // click po tazeni neotevirat menu
            this.justDragged = true;
            setTimeout(() => { this.justDragged = false; }, 0);
        }
        if (moved) this.moveTo(d.pos, d.node, d.index, d.target);
    };

    private cancelDrag = (): void => {
        this.endDrag();
    };

    private dragKey = (e: KeyboardEvent): void => {
        if (e.key === "Escape" && this.drag) {
            e.preventDefault();
            e.stopPropagation();
            this.endDrag();
        }
    };

    private endDrag(): void {
        const d = this.drag;
        if (!d) return;
        clearTimeout(d.scrollTimer);
        d.line?.remove();
        d.shade?.remove();
        this.wrapper.classList.remove("is-dragging");
        document.body.classList.remove("ce-body-dragging");
        window.removeEventListener("pointermove", this.pointerMove);
        window.removeEventListener("pointerup", this.pointerUp);
        window.removeEventListener("pointercancel", this.cancelDrag);
        window.removeEventListener("keydown", this.dragKey, true);
        this.drag = null;
    }

    /** Presun bloku z indexu `from` pred blok `target` (indexy v puvodnim dokumentu). */
    private moveTo(pos: number, node: PMNode, from: number, target: number): void {
        const { view } = this;
        const doc = view.state.doc;
        const current = doc.nodeAt(pos);
        if (!current || current !== node) return;   // dokument se mezitim zmenil
        let insertAt = 0;
        for (let i = 0; i < target && i < doc.childCount; i++) insertAt += doc.child(i).nodeSize;
        if (target > from) insertAt -= node.nodeSize;
        const tr = view.state.tr.delete(pos, pos + node.nodeSize).insert(insertAt, node);
        if (NodeSelection.isSelectable(node)) tr.setSelection(NodeSelection.create(tr.doc, insertAt));
        else tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 1)));
        view.dispatch(tr.scrollIntoView());
        view.focus();
        // kratke zvyrazneni presunuteho bloku
        const dom = view.nodeDOM(insertAt) as HTMLElement | null;
        if (dom && dom.classList) {
            dom.classList.add("ce-just-moved");
            setTimeout(() => dom.classList.remove("ce-just-moved"), 900);
        }
    }

    private blockMenu(): void {
        if (!this.current) return;
        const { view } = this;
        const pos = this.current.pos;
        const node = view.state.doc.nodeAt(pos);
        if (!node) return;
        // vybrat blok, at je videt, s cim menu pracuje
        if (NodeSelection.isSelectable(node)) view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));

        const items: Array<MenuItem | "-" | { title: string }> = [];
        const convert = (label: string, ic: string, c: import("prosemirror-state").Command, active: boolean): MenuItem =>
            ({ label, icon: ic, active, onClick: () => cmd.convertBlock(view, pos, c) });
        const t = node.type;
        const f = this.actions.features;
        const textTypes = (): MenuItem[] => [
            convert("Odstavec", "paragraph", cmd.setParagraph, t === n.paragraph),
            ...f.headings.filter((l) => f.heading(l)).map((l) => convert("Nadpis " + l, "heading", cmd.setHeading(l), t === n.heading && node.attrs.level === l)),
        ];
        const listTypes = (): MenuItem[] => f.has("lists") ? [
            convert("Odrážky", "listUl", cmd.toggleList(n.bullet_list), t === n.bullet_list),
            convert("Číslovaný seznam", "listOl", cmd.toggleList(n.ordered_list), t === n.ordered_list),
        ] : [];
        if (t === n.paragraph || t === n.heading) {
            items.push({ title: "Převést na" }, ...textTypes(), ...listTypes());
            if (f.has("quote")) items.push(convert("Citace", "quote", cmd.toggleBlockquote, false));
            items.push("-");
        } else if (LIST_TYPES.includes(t.name)) {
            if (f.has("lists")) items.push({ title: "Převést na" }, ...listTypes(), "-");
        } else if (t === n.blockquote) {
            items.push(convert("Zrušit citaci", "quote", cmd.toggleBlockquote, false), "-");
        } else if (t === n.columns) {
            items.push(
                { label: "Nastavení sloupců...", icon: "settings", onClick: () => this.actions.editBlock(pos) },
                { label: "Zrušit sloupce", icon: "paragraph", hint: "obsah pod sebe", onClick: () => this.actions.unwrapColumns(pos) },
                "-");
        } else if (["button", "video", "rawhtml", "container", "table"].includes(t.name)) {
            items.push({ label: t === n.table ? "Vlastnosti tabulky..." : "Upravit...", icon: "settings", onClick: () => this.actions.editBlock(pos) }, "-");
        }
        const idx = cmd.topBlockAt(view.state.doc, pos)?.index ?? 0;
        items.push(
            { label: "Posunout nahoru", icon: "up", disabled: idx === 0, onClick: () => cmd.moveBlock(view, pos, -1) },
            { label: "Posunout dolů", icon: "down", disabled: idx >= view.state.doc.childCount - 1, onClick: () => cmd.moveBlock(view, pos, 1) },
            { label: "Duplikovat", icon: "copy", onClick: () => cmd.duplicateBlock(view, pos) },
            { label: "Vložit odstavec pod", icon: "plus", onClick: () => cmd.insertParagraphAfter(view, pos) },
            "-",
            { label: "Smazat blok", icon: "trash", danger: true, onClick: () => cmd.deleteBlock(view, pos) },
        );
        showMenu(this.grip, items);
    }

    private insertMenu(anchor: HTMLElement): void {
        if (!this.current) return;
        const { view } = this;
        const pos = this.current.pos;
        const after = (fn: () => void) => () => { cmd.insertParagraphAfter(view, pos); fn(); };
        const f = this.actions.features;
        const items: Array<MenuItem | "-" | { title: string }> = [
            { title: "Vložit pod" },
            { label: "Odstavec", icon: "paragraph", onClick: after(() => undefined) },
        ];
        for (const l of f.headings.filter((x) => f.heading(x)).slice(0, 2)) {
            items.push({ label: "Nadpis " + l, icon: "heading", onClick: after(() => cmd.setHeading(l)(view.state, view.dispatch)) });
        }
        if (f.has("lists")) items.push({ label: "Odrážky", icon: "listUl", onClick: after(() => cmd.toggleList(n.bullet_list)(view.state, view.dispatch)) });
        const blocks: MenuItem[] = [];
        if (f.has("image")) blocks.push({ label: "Obrázek", icon: "image", onClick: after(() => this.actions.insertImage()) });
        if (f.has("button")) blocks.push({ label: "Tlačítko", icon: "button", onClick: after(() => this.actions.insertButton()) });
        if (f.has("table")) blocks.push({ label: "Tabulka", icon: "table", onClick: after(() => this.actions.insertTable(anchor)) });
        if (f.has("columns")) blocks.push({ label: "Sloupce", icon: "columns", onClick: after(() => this.actions.insertColumns(null, anchor)) });
        if (f.has("video")) blocks.push({ label: "Video z YouTube", icon: "video", onClick: after(() => this.actions.insertVideo()) });
        if (f.has("variables") && this.actions.hasVariables()) blocks.push({ label: "Proměnná webu", icon: "variable", onClick: after(() => this.actions.insertVariable(null, anchor)) });
        if (f.has("hr")) blocks.push({ label: "Vodorovná čára", icon: "hr", onClick: after(() => cmd.insertBlock(n.horizontal_rule.create())(view.state, view.dispatch)) });
        if (f.has("html")) blocks.push({ label: "HTML blok", icon: "html", onClick: after(() => this.actions.insertRaw()) });
        if (blocks.length) items.push("-", ...blocks);
        showMenu(anchor, items);
    }

    hide(): void {
        this.dom.hidden = true;
    }

    destroy(): void {
        this.endDrag();
        closeMenu();
        this.wrapper.removeEventListener("mousemove", this.onMove);
        this.wrapper.removeEventListener("mouseleave", this.onLeave);
        this.dom.remove();
    }
}

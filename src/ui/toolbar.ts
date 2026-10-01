/**
 * Pevny toolbar nahore + bublina nad oznacenym textem.
 * Stav tlacitek (aktivni / nedostupne) se obnovuje po kazde zmene editoru.
 * Co v toolbaru je, urcuje nastaveni pole (Features).
 */
import type { EditorState, Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { undo, redo } from "prosemirror-history";
import { isInTable } from "prosemirror-tables";
import { h, iconButton, showMenu, showPopover, closeMenu, placeInside, type MenuItem } from "./dom";
import { icon } from "./icons";
import { schema } from "../core/schema";
import * as cmd from "../editor/commands";
import type { Features } from "../editor/features";
import { variableMenu, type VariableDef } from "../editor/variables";

export interface ColorDef { label: string; value: string }

export interface ToolbarActions {
    features: Features;
    openLink(): void;
    insertImage(): void;
    insertButton(): void;
    insertVideo(): void;
    /** anchor = tlacitko: rychla nabidka s mrizkou; bez nej dialog. */
    insertTable(anchor?: HTMLElement): void;
    tableProps(): void;
    insertRaw(): void;
    /** Sloupce: layout = vlozit hned, null + anchor = nabidka rozvrzeni, null = dialog. */
    insertColumns(layout: string | null, anchor?: HTMLElement): void;
    insertVariable(def: VariableDef | null): void;
    variables(): VariableDef[];
    manageVariablesUrl(): string | null;
    colors(): ColorDef[];
    toggleSource(): void;
    isSource(): boolean;
    toggleFullscreen(): void;
    /** Polozky menu Zobrazeni (vzhled webu, promenne, tema). */
    viewMenu(): Array<MenuItem | "-" | { title: string }>;
    /** Je zapnuty nektery z rezimu zobrazeni (zvyrazni tlacitko). */
    viewActive(): boolean;
    hasPreview(): boolean;
    openPreview(): void;
}

interface Item {
    el: HTMLElement;
    active?: (s: EditorState) => boolean;
    enabled?: (s: EditorState) => boolean;
}

const ALIGNS: Array<[string, string, string]> = [
    ["left", "Zarovnat vlevo", "alignLeft"],
    ["center", "Na střed", "alignCenter"],
    ["right", "Zarovnat vpravo", "alignRight"],
    ["justify", "Do bloku", "alignJustify"],
];

export const DEFAULT_COLORS: ColorDef[] = [
    { label: "Červená", value: "#d0312d" },
    { label: "Oranžová", value: "#e67e22" },
    { label: "Zelená", value: "#27ae60" },
    { label: "Modrá", value: "#1d67e7" },
    { label: "Fialová", value: "#7b3fb8" },
    { label: "Šedá", value: "#6b7280" },
];

export function blockTypes(f: Features): Array<{ key: string; label: string; command: Command; icon: string }> {
    const out = [{ key: "paragraph", label: "Odstavec", command: cmd.setParagraph, icon: "paragraph" }];
    for (const level of f.headings) {
        if (f.heading(level)) out.push({ key: "h" + level, label: "Nadpis " + level, command: cmd.setHeading(level), icon: "heading" });
    }
    return out;
}

export class Toolbar {
    readonly dom: HTMLElement;
    private items: Item[] = [];
    private blockBtn: HTMLButtonElement | null = null;
    private alignBtn: HTMLButtonElement | null = null;
    private sourceBtn: HTMLButtonElement | null = null;
    private viewBtn!: HTMLButtonElement;
    private types: ReturnType<typeof blockTypes>;

    constructor(private view: EditorView, private actions: ToolbarActions) {
        this.dom = h("div", { class: "ce-toolbar", role: "toolbar", "aria-label": "Formátování" });
        this.types = blockTypes(actions.features);
        this.build();
    }

    private run(command: Command): void {
        command(this.view.state, this.view.dispatch, this.view);
        this.view.focus();
    }

    private btn(name: string, title: string, command: Command, active?: (s: EditorState) => boolean): HTMLButtonElement {
        const el = iconButton(name, title, () => this.run(command));
        this.items.push({ el, active, enabled: (s) => command(s) });
        return el;
    }

    private action(name: string, title: string, fn: () => void, enabled?: (s: EditorState) => boolean): HTMLButtonElement {
        const el = iconButton(name, title, fn);
        this.items.push({ el, enabled });
        return el;
    }

    /** Tlacitko s rozbalovacim menu. */
    private dropdown(content: HTMLElement[], title: string, open: (btn: HTMLButtonElement) => void, cls = "ce-btn ce-btn-caret"): HTMLButtonElement {
        const b: HTMLButtonElement = h("button", {
            type: "button", class: cls, title, "aria-label": title, "aria-haspopup": "true",
            onMousedown: (e: MouseEvent) => e.preventDefault(),
            onClick: () => open(b),
        }, ...content);
        return b;
    }

    /** Skupina tlacitek; prazdna (vse vypnute) se nezobrazi. */
    private group(...children: Array<HTMLElement | null | false>): HTMLElement | null {
        const list = children.filter(Boolean) as HTMLElement[];
        return list.length ? h("div", { class: "ce-group" }, ...list) : null;
    }

    private build(): void {
        const m = schema.marks;
        const n = schema.nodes;
        const f = this.actions.features;

        // typ bloku (odstavec / nadpisy)
        if (this.types.length > 1) {
            this.blockBtn = this.dropdown([h("span", { class: "ce-block-label", text: "Odstavec" }), icon("chevronDown", 14)], "Typ bloku",
                (b) => showMenu(b, this.types.map((t) => ({
                    label: t.label, icon: t.icon, active: cmd.currentBlockKey(this.view.state) === t.key,
                    onClick: () => this.run(t.command),
                }))), "ce-btn ce-btn-text ce-block-type");
            this.items.push({ el: this.blockBtn, enabled: (s) => cmd.setParagraph(s) || cmd.currentBlockKey(s) !== "" });
        }

        // zarovnani
        if (f.has("align")) {
            this.alignBtn = this.dropdown([icon("alignLeft", 18), icon("chevronDown", 12)], "Zarovnání",
                (b) => showMenu(b, ALIGNS.map(([v, label, ic]) => ({
                    label, icon: ic, active: cmd.currentAlign(this.view.state) === v, onClick: () => this.run(cmd.setAlign(v)),
                }))));
            this.items.push({ el: this.alignBtn, enabled: (s) => cmd.setAlign("center")(s) || cmd.setAlign("left")(s) });
        }

        // barva textu
        let colorBtn: HTMLButtonElement | null = null;
        if (f.has("color")) {
            colorBtn = this.dropdown([icon("textColor", 18), icon("chevronDown", 12)], "Barva textu a zvýraznění", (b) => this.colorPopover(b));
            this.items.push({ el: colorBtn, enabled: (s) => !s.selection.empty && s.selection.$from.parent.inlineContent });
        }

        // dalsi formatovani a vkladani
        const moreItems = (): Array<MenuItem | "-" | { title: string }> => {
            const st = this.view.state;
            const out: Array<MenuItem | "-" | { title: string }> = [];
            if (f.has("strike")) out.push({ label: "Přeškrtnuté", icon: "strike", active: cmd.markActive(st, m.strike), onClick: () => this.run(cmd.toggleStrike) });
            if (f.has("sup")) out.push({ label: "Horní index", icon: "sup", active: cmd.markActive(st, m.sup), onClick: () => this.run(cmd.toggleSup) });
            if (f.has("sub")) out.push({ label: "Dolní index", icon: "sub", active: cmd.markActive(st, m.sub), onClick: () => this.run(cmd.toggleSub) });
            if (f.has("nbsp")) out.push({ label: "Nezlomitelná mezera", icon: "nbsp", hint: "Ctrl+Shift+Mezera", onClick: () => this.run(cmd.insertText("\u00a0")) });
            if (f.has("clear")) out.push({ label: "Vymazat formátování", icon: "clear", onClick: () => this.run(cmd.clearFormatting) });
            const ins: MenuItem[] = [];
            if (f.has("hr")) ins.push({ label: "Vodorovná čára", icon: "hr", onClick: () => this.run(cmd.insertBlock(n.horizontal_rule.create())) });
            if (f.has("html")) ins.push({ label: "HTML blok", icon: "html", onClick: () => this.actions.insertRaw() });
            if (f.has("variables") && this.actions.variables().some((d) => d.offer !== false)) {
                ins.push({
                    label: "Proměnná webu...", icon: "variable", hint: "v textu {$",
                    onClick: () => setTimeout(() => more && showMenu(more, variableMenu(this.actions.variables(), (d) => this.actions.insertVariable(d), this.actions.manageVariablesUrl()))),
                });
            }
            if (ins.length && out.length) out.push("-");
            out.push(...ins);
            return out;
        };
        let more: HTMLButtonElement | null = null;
        more = moreItems().length
            ? this.dropdown([icon("plus", 18), icon("chevronDown", 12)], "Další", (b) => showMenu(b, moreItems()))
            : null;

        // tabulka: rychla nabidka s mrizkou (klik = vlozit) + Upresnit...
        let tableBtn: HTMLButtonElement | null = null;
        if (f.has("table")) {
            tableBtn = this.dropdown([icon("table", 18), icon("chevronDown", 12)], "Tabulka", (b) => this.actions.insertTable(b));
            this.items.push({ el: tableBtn, enabled: (s) => !isInTable(s) });
        }

        // sloupce: nabidka rozvrzeni + Upresnit...
        let columnsBtn: HTMLButtonElement | null = null;
        if (f.has("columns")) {
            columnsBtn = this.dropdown([icon("columns", 18), icon("chevronDown", 12)], "Sloupce", (b) => this.actions.insertColumns(null, b));
            this.items.push({ el: columnsBtn, enabled: (s) => !isInTable(s) });
        }

        // promenne webu
        let varBtn: HTMLButtonElement | null = null;
        if (f.has("variables") && this.actions.variables().length) {
            varBtn = this.dropdown([icon("variable", 18), h("span", { class: "ce-btn-label", text: "Proměnné" }), icon("chevronDown", 12)],
                "Vložit proměnnou webu (v textu stačí napsat {$)",
                (b) => showMenu(b, variableMenu(this.actions.variables(), (d) => this.actions.insertVariable(d), this.actions.manageVariablesUrl())));
            this.items.push({ el: varBtn, enabled: (s) => !!s.selection.$from.parent.type.contentMatch.matchType(n.variable) });
        }

        // operace s tabulkou (radky, sloupce, slouceni, vlastnosti) jsou v kontextove liste
        // nad tabulkou - ui/tabletools.ts

        if (f.has("source")) this.sourceBtn = iconButton("source", "Zdrojový kód HTML", () => this.actions.toggleSource());
        this.viewBtn = this.dropdown([icon("eye", 18), icon("chevronDown", 12)], "Zobrazení (vzhled webu, proměnné, téma)", (b) => showMenu(b, this.actions.viewMenu()));
        const previewBtn = this.actions.hasPreview() ? iconButton("monitor", "Náhled jak na webu", () => this.actions.openPreview()) : null;

        const parts = [
            this.blockBtn ? this.group(this.blockBtn) : null,
            this.group(
                f.has("bold") && this.btn("bold", "Tučně (Ctrl+B)", cmd.toggleBold, (s) => cmd.markActive(s, m.strong)),
                f.has("italic") && this.btn("italic", "Kurzíva (Ctrl+I)", cmd.toggleItalic, (s) => cmd.markActive(s, m.em)),
                f.has("underline") && this.btn("underline", "Podtržení (Ctrl+U)", cmd.toggleUnderline, (s) => cmd.markActive(s, m.underline)),
                colorBtn,
                f.has("link") && this.action("link", "Odkaz (Ctrl+K)", () => this.actions.openLink(), (s) => !s.selection.empty || !!cmd.linkAt(s) || s.selection.$from.parent.inlineContent),
            ),
            this.group(
                f.has("lists") && this.btn("listUl", "Odrážky", cmd.toggleList(n.bullet_list), (s) => !!cmd.findParent(s, n.bullet_list)),
                f.has("lists") && this.btn("listOl", "Číslovaný seznam", cmd.toggleList(n.ordered_list), (s) => !!cmd.findParent(s, n.ordered_list)),
                f.has("indent") && this.btn("outdent", "Zmenšit odsazení (Shift+Tab)", cmd.indent(-1)),
                f.has("indent") && this.btn("indent", "Zvětšit odsazení (Tab)", cmd.indent(1)),
                f.has("quote") && this.btn("quote", "Citace", cmd.toggleBlockquote, (s) => !!cmd.findParent(s, n.blockquote)),
                this.alignBtn,
            ),
            this.group(
                f.has("image") && this.action("image", "Obrázek", () => this.actions.insertImage()),
                f.has("button") && this.action("button", "Tlačítko", () => this.actions.insertButton()),
                tableBtn,
                columnsBtn,
                f.has("video") && this.action("video", "Video z YouTube", () => this.actions.insertVideo()),
                varBtn,
                more,
            ),
            this.group(this.btn("undo", "Zpět (Ctrl+Z)", undo), this.btn("redo", "Znovu (Ctrl+Y)", redo)),
            h("div", { class: "ce-spacer" }),
            this.group(previewBtn, this.viewBtn, this.sourceBtn, iconButton("fullscreen", "Celá obrazovka", () => this.actions.toggleFullscreen())),
        ];
        this.dom.append(...parts.filter(Boolean) as HTMLElement[]);
    }

    /** Paleta barev: barva textu a zvyrazneni (pozadi). */
    private colorPopover(anchor: HTMLElement): void {
        const colors = this.actions.colors();
        const st = this.view.state;
        const pick = (key: "color" | "background", value: string | null) => {
            closeMenu();
            this.run(cmd.setTextStyle(key, value));
        };
        const row = (key: "color" | "background", title: string) => {
            const cur = (cmd.currentTextStyle(st, key) || "").toLowerCase();
            const custom = h("input", { type: "color", class: "ce-swatch-custom", title: "Vlastní barva" });
            custom.value = /^#[0-9a-f]{6}$/i.test(cur) ? cur : "#000000";
            custom.addEventListener("change", () => pick(key, custom.value));
            return h("div", { class: "ce-palette-row" },
                h("div", { class: "ce-menu-title", text: title }),
                h("div", { class: "ce-swatches" },
                    h("button", {
                        type: "button", class: ["ce-swatch", "ce-swatch-none", !cur && "is-active"], title: "Bez barvy",
                        onMousedown: (e: MouseEvent) => e.preventDefault(), onClick: () => pick(key, null),
                    }),
                    ...colors.map((c) => h("button", {
                        type: "button", class: ["ce-swatch", cur === c.value.toLowerCase() && "is-active"], title: c.label,
                        style: { background: key === "background" ? hexAlpha(c.value, .28) : c.value },
                        onMousedown: (e: MouseEvent) => e.preventDefault(), onClick: () => pick(key, key === "background" ? hexAlpha(c.value, .28) : c.value),
                    })),
                    custom));
        };
        showPopover(anchor, h("div", { class: "ce-menu ce-palette" }, row("color", "Barva textu"), row("background", "Zvýraznění")));
    }

    update(state: EditorState): void {
        const source = this.actions.isSource();
        for (const it of this.items) {
            const enabled = !source && (it.enabled ? it.enabled(state) : true);
            (it.el as HTMLButtonElement).disabled = !enabled;
            if (it.active) it.el.classList.toggle("is-active", enabled && it.active(state));
        }
        if (this.blockBtn) {
            const key = cmd.currentBlockKey(state);
            (this.blockBtn.querySelector(".ce-block-label") as HTMLElement).textContent = this.types.find((t) => t.key === key)?.label || (key.startsWith("h") ? "Nadpis " + key.slice(1) : "Blok");
        }
        if (this.alignBtn) {
            const align = cmd.currentAlign(state);
            const alignIcon = ALIGNS.find(([v]) => v === align)?.[2] || "alignLeft";
            this.alignBtn.firstElementChild!.replaceWith(icon(alignIcon, 18));
            this.alignBtn.classList.toggle("is-active", align !== "left");
        }
        this.sourceBtn?.classList.toggle("is-active", source);
        this.viewBtn.classList.toggle("is-active", this.actions.viewActive());
    }
}

/** "#1d67e7" + 0.28 -> "rgba(29, 103, 231, 0.28)" (zvyrazneni = svetla varianta barvy). */
function hexAlpha(hex: string, alpha: number): string {
    const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return hex;
    return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

// ------------------------------------------------------------------ bublina nad vyberem

export class Bubble {
    readonly dom: HTMLElement;
    private items: Item[] = [];

    /** container = posuvna cast editoru (bublina se posouva s textem, viz placeInside). */
    constructor(private view: EditorView, private actions: ToolbarActions, private container: HTMLElement) {
        const m = schema.marks;
        const f = actions.features;
        const b = (ic: string, title: string, c: Command, active: (s: EditorState) => boolean) => {
            const el = iconButton(ic, title, () => { c(this.view.state, this.view.dispatch); this.view.focus(); });
            this.items.push({ el, active });
            return el;
        };
        this.dom = h("div", { class: "ce-bubble ce-bubble-inside", role: "toolbar", "aria-label": "Formátování výběru" },
            f.has("bold") && b("bold", "Tučně", cmd.toggleBold, (s) => cmd.markActive(s, m.strong)),
            f.has("italic") && b("italic", "Kurzíva", cmd.toggleItalic, (s) => cmd.markActive(s, m.em)),
            f.has("underline") && b("underline", "Podtržení", cmd.toggleUnderline, (s) => cmd.markActive(s, m.underline)),
            f.has("link") && iconButton("link", "Odkaz", () => this.actions.openLink()),
            f.has("clear") && iconButton("clear", "Vymazat formátování", () => { cmd.clearFormatting(this.view.state, this.view.dispatch); this.view.focus(); }),
        );
        this.dom.hidden = true;
        container.appendChild(this.dom);
    }

    update(view: EditorView): void {
        const { state } = view;
        const sel = state.selection;
        const show = this.items.length > 0 && !this.actions.isSource() && view.hasFocus() && !sel.empty && sel.$from.parent.inlineContent && !(sel as { node?: unknown }).node;
        if (!show) { this.dom.hidden = true; return; }
        this.items.forEach((it) => it.el.classList.toggle("is-active", !!it.active?.(state)));
        this.dom.hidden = false;
        const start = view.coordsAtPos(sel.from);
        const end = view.coordsAtPos(sel.to);
        placeInside(this.dom, this.container, { left: start.left, right: end.right, top: Math.min(start.top, end.top), bottom: Math.max(start.bottom, end.bottom) }, "above", "center");
    }

    hide(): void { this.dom.hidden = true; }

    destroy(): void { this.dom.remove(); }
}

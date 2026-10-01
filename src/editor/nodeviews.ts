/**
 * Zobrazeni specialnich bloku v editoru. Vystupni HTML se ridi schematem,
 * tady jde jen o to, jak blok vypada pri psani:
 *  - tlacitko jako tlacitko webu, video jako nahled z YouTube
 *  - HTML blok jako kod (nic z nej se v administraci nespusti)
 *  - kontejner s popiskem tridy, obsah uvnitr se edituje normalne
 */
import type { Node as PMNode } from "prosemirror-model";
import type { EditorView, NodeView } from "prosemirror-view";
import { h } from "../ui/dom";
import { icon } from "../ui/icons";
import { CONTACT_FORM_ACTION } from "../core/urls";

export type EditBlock = (pos: number) => void;

function label(iconName: string, text: string, onEdit?: () => void): HTMLElement {
    return h("div", { class: "ce-nv-label", contenteditable: "false" },
        icon(iconName, 14), h("span", { text }),
        onEdit ? h("button", {
            type: "button", class: "ce-nv-edit", title: "Upravit",
            onMousedown: (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); onEdit(); },
        }, icon("settings", 14)) : null);
}

abstract class AtomView implements NodeView {
    dom: HTMLElement;
    constructor(protected node: PMNode, protected view: EditorView, protected getPos: () => number | undefined, protected edit: EditBlock) {
        this.dom = h("div", { class: "ce-nv", contenteditable: "false" });
        this.dom.addEventListener("dblclick", (e) => {
            e.preventDefault();
            this.openEdit();
        });
        this.render();
    }
    protected openEdit(): void {
        const pos = this.getPos();
        if (pos !== undefined) this.edit(pos);
    }
    abstract render(): void;
    update(node: PMNode): boolean {
        if (node.type !== this.node.type) return false;
        this.node = node;
        this.dom.textContent = "";
        this.render();
        return true;
    }
    stopEvent(e: Event): boolean {
        return e.type === "mousedown" && !!(e.target as HTMLElement).closest?.(".ce-nv-edit");
    }
    ignoreMutation(): boolean {
        return true;
    }
    selectNode(): void { this.dom.classList.add("is-selected"); }
    deselectNode(): void { this.dom.classList.remove("is-selected"); }
}

class ButtonView extends AtomView {
    render(): void {
        const a = this.node.attrs;
        this.dom.className = "ce-nv ce-nv-button";
        const where = a.href === CONTACT_FORM_ACTION ? "posune na kontaktní formulář" : a.href;
        this.dom.append(
            label("button", "Tlačítko", () => this.openEdit()),
            h("div", { class: "ce-nv-button-row" },
                h("span", { class: ["ce-fake-btn", "ce-fake-btn-" + String(a.variant || "medium").split(" ")[0]], text: a.text || "(bez textu)" })),
            h("div", { class: "ce-nv-meta", text: "Po kliknutí " + (a.href === CONTACT_FORM_ACTION ? where : "otevře " + where) + (a.target === "_blank" ? " (nové okno)" : "") }),
        );
    }
}

class SpacerView extends AtomView {
    render(): void {
        this.dom.className = "ce-nv ce-nv-spacer";
        this.dom.title = "Prázdný blok, který na webu vytváří mezeru. Pokud ji nechcete, smažte ho.";
        this.dom.append(h("span", { text: "mezera" }));
    }
}

class VideoView extends AtomView {
    render(): void {
        const id = String(this.node.attrs.src || "").split("/embed/")[1] || "";
        this.dom.className = "ce-nv ce-nv-video";
        this.dom.append(
            label("video", "Video z YouTube", () => this.openEdit()),
            h("div", { class: "ce-nv-video-thumb" },
                id ? h("img", { src: `https://img.youtube.com/vi/${id}/hqdefault.jpg`, alt: "", draggable: "false" }) : null,
                h("span", { class: "ce-nv-play" }, icon("video", 34))),
            h("div", { class: "ce-nv-meta", text: this.node.attrs.title || "" }),
        );
    }
}

class RawView extends AtomView {
    render(): void {
        const html: string = this.node.attrs.html || "";
        const first = html.match(/^<([a-z0-9-]+)([^>]*)>/i);
        const cls = first ? (first[2].match(/class="([^"]*)"/i)?.[1] || "") : "";
        this.dom.className = "ce-nv ce-nv-raw";
        this.dom.append(
            label("html", "HTML blok" + (first ? ` <${first[1].toLowerCase()}${cls ? "." + cls.split(/\s+/).join(".") : ""}>` : ""), () => this.openEdit()),
            // jen text - obsah se v administraci nevykresluje ani nespousti
            h("pre", { class: "ce-nv-code", text: html.length > 600 ? html.slice(0, 600) + "\n..." : html }),
        );
    }
}

/** Kontejner: obal s popiskem, obsah (contentDOM) se edituje normalne. */
class ContainerView implements NodeView {
    dom: HTMLElement;
    contentDOM: HTMLElement;
    private labelEl: HTMLElement;
    constructor(private node: PMNode, private getPos: () => number | undefined, private edit: EditBlock) {
        this.labelEl = h("div", { class: "ce-nv-label", contenteditable: "false" });
        this.contentDOM = h("div", { class: "ce-nv-container-body" });
        this.dom = h("div", { class: "ce-nv-container" }, this.labelEl, this.contentDOM);
        this.renderLabel();
    }
    private renderLabel(): void {
        this.labelEl.textContent = "";
        const cls = this.node.attrs.cls ? "." + String(this.node.attrs.cls).trim().split(/\s+/).join(".") : "";
        this.labelEl.append(icon("container", 14), h("span", { text: "Kontejner " + (cls || (this.node.attrs.style ? "(styl)" : "")) }),
            h("button", {
                type: "button", class: "ce-nv-edit", title: "Třída a styl kontejneru",
                onMousedown: (e: MouseEvent) => { e.preventDefault(); const p = this.getPos(); if (p !== undefined) this.edit(p); },
            }, icon("settings", 14)));
    }
    update(node: PMNode): boolean {
        if (node.type !== this.node.type) return false;
        this.node = node;
        this.renderLabel();
        return true;
    }
    ignoreMutation(m: MutationRecord | { type: "selection"; target: Node }): boolean {
        return !this.contentDOM.contains(m.target as Node) || m.target === this.contentDOM && m.type === "attributes";
    }
    stopEvent(e: Event): boolean {
        return e.type === "mousedown" && !!(e.target as HTMLElement).closest?.(".ce-nv-edit");
    }
}

const LAYOUT_LABEL: Record<string, string> = { "2": "2 stejné", "3": "3 stejné", "4": "4 stejné", "1-2": "1/3 + 2/3", "2-1": "2/3 + 1/3" };

/**
 * Sloupce: popisek s rozvrzenim a ozubenym kolem, pod nim mrizka (contentDOM) se stejnymi
 * tridami jako na webu - ve vzhledu webu je tedy rozlozi styly webu.
 */
class ColumnsView implements NodeView {
    dom: HTMLElement;
    contentDOM: HTMLElement;
    private labelEl: HTMLElement;
    constructor(private node: PMNode, private getPos: () => number | undefined, private edit: EditBlock) {
        this.labelEl = h("div", { class: "ce-nv-label", contenteditable: "false" });
        this.contentDOM = h("div");
        this.dom = h("div", { class: "ce-nv-columns" }, this.labelEl, this.contentDOM);
        this.render();
    }
    private render(): void {
        const a = this.node.attrs;
        const tmp = this.node.type.spec.toDOM!(this.node) as unknown as [string, Record<string, string>];
        this.contentDOM.className = tmp[1].class || "cms-cols";
        this.contentDOM.setAttribute("style", tmp[1].style || "");
        const extra = [a.gap === "0" ? "bez mezery" : a.gap === "s" ? "malá mezera" : a.gap === "l" ? "velká mezera" : "",
            a.valign === "center" ? "na střed" : a.valign === "end" ? "dolů" : a.valign === "stretch" ? "stejná výška" : "",
            a.mobile === "keep" ? "na mobilu vedle sebe" : a.mobile === "rev" ? "na mobilu obráceně" : ""].filter(Boolean).join(", ");
        this.labelEl.textContent = "";
        this.labelEl.append(icon("columns", 14),
            h("span", { text: "Sloupce " + (a.layout === "custom" ? (a.widths || "") : LAYOUT_LABEL[a.layout] || a.layout) + (extra ? " - " + extra : "") }),
            h("button", {
                type: "button", class: "ce-nv-edit", title: "Nastavení sloupců",
                onMousedown: (e: MouseEvent) => { e.preventDefault(); const p = this.getPos(); if (p !== undefined) this.edit(p); },
            }, icon("settings", 14)));
    }
    update(node: PMNode): boolean {
        if (node.type !== this.node.type) return false;
        this.node = node;
        this.render();
        return true;
    }
    ignoreMutation(m: MutationRecord | { type: "selection"; target: Node }): boolean {
        return !this.contentDOM.contains(m.target as Node) || m.target === this.contentDOM && m.type === "attributes";
    }
    stopEvent(e: Event): boolean {
        return e.type === "mousedown" && !!(e.target as HTMLElement).closest?.(".ce-nv-edit");
    }
}

export function nodeViews(edit: EditBlock) {
    return {
        columns: (node: PMNode, _view: EditorView, getPos: () => number | undefined) => new ColumnsView(node, getPos, edit),
        button: (node: PMNode, view: EditorView, getPos: () => number | undefined) => new ButtonView(node, view, getPos, edit),
        spacer: (node: PMNode, view: EditorView, getPos: () => number | undefined) => new SpacerView(node, view, getPos, edit),
        video: (node: PMNode, view: EditorView, getPos: () => number | undefined) => new VideoView(node, view, getPos, edit),
        rawhtml: (node: PMNode, view: EditorView, getPos: () => number | undefined) => new RawView(node, view, getPos, edit),
        container: (node: PMNode, _view: EditorView, getPos: () => number | undefined) => new ContainerView(node, getPos, edit),
    };
}

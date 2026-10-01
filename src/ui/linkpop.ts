/**
 * Ovladani odkazu: kurzor v odkazu -> cely odkaz se oramuje a pod nim se ukaze panel
 * s adresou (otevrit v nove zalozce) a tlacitky Upravit / Kopirovat / Odebrat.
 * Dvojklik dal vybira slovo (je to text), Ctrl+K upravuje jako tlacitko Upravit.
 */
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { h, iconButton, placeInside } from "./dom";
import { icon } from "./icons";
import * as cmd from "../editor/commands";

/** Odkaz pod kurzorem (jen prazdny vyber - pri oznacenem textu je bublina formatovani). */
function activeLink(state: EditorState): ReturnType<typeof cmd.linkAt> {
    if (!state.selection.empty) return null;
    return cmd.linkAt(state);
}

const key = new PluginKey("ce-link-active");

/** Oramovani celeho odkazu pod kurzorem. */
export function linkHighlight(): Plugin {
    return new Plugin({
        key,
        props: {
            decorations(state) {
                const link = activeLink(state);
                if (!link) return null;
                return DecorationSet.create(state.doc, [Decoration.inline(link.from, link.to, { class: "ce-link-active" })]);
            },
        },
    });
}

export interface LinkPopoverActions {
    edit(): void;
    remove(): void;
}

export class LinkPopover {
    readonly dom: HTMLElement;
    private url: HTMLAnchorElement;
    private badge: HTMLElement;
    private copyBtn: HTMLButtonElement;

    /** container = posuvna cast editoru (panel se posouva s textem, viz placeInside). */
    constructor(private view: EditorView, private actions: LinkPopoverActions, private container: HTMLElement) {
        this.url = h("a", { class: "ce-linkpop-url", target: "_blank", rel: "noopener noreferrer", title: "Otevřít v nové záložce" });
        this.badge = h("span", { class: "ce-linkpop-badge", text: "nové okno" });
        this.copyBtn = iconButton("copy", "Kopírovat adresu", () => this.copy());
        this.dom = h("div", { class: "ce-bubble ce-bubble-inside ce-linkpop", role: "toolbar", "aria-label": "Odkaz" },
            icon("link", 15),
            this.url,
            this.badge,
            h("span", { class: "ce-linkpop-sep" }),
            iconButton("pencil", "Upravit odkaz (Ctrl+K)", () => this.actions.edit()),
            this.copyBtn,
            iconButton("unlink", "Odebrat odkaz", () => this.actions.remove()),
        );
        this.dom.hidden = true;
        // klik do panelu nesmi vzit fokus editoru (panel by zmizel)
        this.dom.addEventListener("mousedown", (e) => e.preventDefault());
        container.appendChild(this.dom);
    }

    update(view: EditorView, suppressed: boolean): void {
        const link = activeLink(view.state);
        if (!link || suppressed || !view.hasFocus()) { this.dom.hidden = true; return; }
        const href = String(link.mark.attrs.href || "");
        this.url.href = href;
        this.url.textContent = href.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") || href;
        this.url.title = href + " - otevřít v nové záložce";
        this.badge.hidden = link.mark.attrs.target !== "_blank";
        this.dom.hidden = false;
        // pod zacatek odkazu (nad nim, kdyz se nevejde)
        const start = view.coordsAtPos(link.from);
        const end = view.coordsAtPos(link.to);
        const left = start.top === end.top ? start.left : Math.min(start.left, end.left);
        placeInside(this.dom, this.container, { left, right: left, top: Math.min(start.top, end.top), bottom: Math.max(start.bottom, end.bottom) }, "below", "start");
    }

    private copy(): void {
        const href = this.url.href;
        const done = () => {
            this.copyBtn.classList.add("is-active");
            this.copyBtn.title = "Zkopírováno";
            setTimeout(() => { this.copyBtn.classList.remove("is-active"); this.copyBtn.title = "Kopírovat adresu"; }, 1200);
        };
        if (navigator.clipboard) navigator.clipboard.writeText(this.url.getAttribute("href") || href).then(done, () => undefined);
    }

    hide(): void { this.dom.hidden = true; }

    destroy(): void { this.dom.remove(); }
}

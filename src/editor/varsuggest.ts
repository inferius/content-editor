/**
 * Napoveda promennych v textu: po napsani "{$" se ukaze nabidka promennych pro stranku,
 * psanim se filtruje (nazev i popisek, bez diakritiky). Sipky vyber, Enter / Tab vlozi,
 * Esc zavre. Promenna s parametry otevre dialog (pres pick).
 */
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { h } from "../ui/dom";
import { icon } from "../ui/icons";
import { schema } from "../core/schema";
import type { VariableDef } from "./variables";
import { paramsOf } from "./variables";

interface SuggestState {
    active: boolean;
    dismissed: boolean; // Esc - nabidka zavrena do dalsiho psani
    from: number;      // pozice "{"
    to: number;        // pozice kurzoru
    query: string;     // text za "{$"
}

const key = new PluginKey<SuggestState>("ce-var-suggest");
const TRIGGER = /\{\$([A-Za-z_]\w*)?$/;
const INACTIVE: SuggestState = { active: false, dismissed: false, from: 0, to: 0, query: "" };

function norm(s: string): string {
    return (s.normalize ? s.normalize("NFD") : s).replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function detect(state: EditorState): SuggestState {
    const sel = state.selection;
    if (!sel.empty) return INACTIVE;
    const $c = sel.$from;
    if (!$c.parent.isTextblock || $c.parent.type.spec.code || !$c.parent.type.contentMatch.matchType(schema.nodes.variable)) return INACTIVE;
    const before = $c.parent.textBetween(Math.max(0, $c.parentOffset - 60), $c.parentOffset, undefined, "\ufffc");
    const m = before.match(TRIGGER);
    if (!m) return INACTIVE;
    return { active: true, dismissed: false, from: $c.pos - m[0].length, to: $c.pos, query: m[1] || "" };
}

export interface SuggestOptions {
    /** Promenne nabizene na strance (offer !== false). */
    defs(): VariableDef[];
    /** Vlozit promennou misto textu from..to (s parametry pres dialog). */
    pick(def: VariableDef, from: number, to: number): void;
    /** Odkaz na spravu kodu (volitelne) - posledni polozka nabidky. */
    manageUrl?: string | null;
}

export function variableSuggest(opts: SuggestOptions): Plugin<SuggestState> {
    let popup: HTMLElement | null = null;
    let items: VariableDef[] = [];
    let index = 0;

    const close = () => { popup?.remove(); popup = null; items = []; };

    const filter = (query: string): VariableDef[] => {
        const q = norm(query);
        const list = opts.defs().filter((d) => d.offer !== false);
        if (!q) return list;
        const starts = list.filter((d) => norm(d.name).startsWith(q) || norm(d.label).startsWith(q));
        const rest = list.filter((d) => !starts.includes(d) && (norm(d.name).includes(q) || norm(d.label).includes(q)));
        return [...starts, ...rest];
    };

    const render = (view: EditorView, st: SuggestState) => {
        items = filter(st.query);
        if (!items.length) { close(); return; }
        index = Math.min(index, items.length - 1);
        if (!popup) {
            popup = h("div", { class: "ce-menu ce-suggest", role: "listbox", "aria-label": "Proměnné" });
            popup.addEventListener("mousedown", (e) => e.preventDefault());
            const root = view.dom.closest(".ce-root");
            if (root?.classList.contains("ce-theme-dark")) popup.classList.add("ce-theme-dark");
            if (root?.classList.contains("ce-theme-light")) popup.classList.add("ce-theme-light");
            document.body.appendChild(popup);
        }
        popup.textContent = "";
        let group = "";
        items.forEach((d, i) => {
            if ((d.group || "") !== group) {
                group = d.group || "";
                if (group) popup!.appendChild(h("div", { class: "ce-menu-title", text: group }));
            }
            const n = paramsOf(d).length;
            const el = h("button", {
                type: "button", role: "option", class: ["ce-menu-item", i === index && "is-active"],
                "aria-selected": i === index ? "true" : "false",
                onClick: () => choose(view, i),
                onMouseenter: () => { index = i; mark(); },
            }, icon("variable", 16), h("span", { class: "ce-menu-label", text: d.label }),
                h("span", { class: "ce-menu-hint", text: "{$" + d.name + (n ? ":" + paramsOf(d).map(() => "...").join(":") : "") + "}" }));
            popup!.appendChild(el);
        });
        if (opts.manageUrl) {
            popup.appendChild(h("div", { class: "ce-menu-sep" }));
            popup.appendChild(h("a", { class: "ce-menu-item ce-suggest-manage", href: opts.manageUrl, target: "_blank", rel: "noopener" },
                icon("settings", 16), h("span", { class: "ce-menu-label", text: "Spravovat kódy..." })));
        }
        popup.appendChild(h("div", { class: "ce-suggest-hint", text: "Šipky vybrat, Enter vložit, Esc zavřít" }));
        // pod kurzorem (nad, kdyz se nevejde)
        const c = view.coordsAtPos(st.from);
        const r = popup.getBoundingClientRect();
        popup.style.left = Math.max(8, Math.min(c.left, window.innerWidth - r.width - 8)) + "px";
        popup.style.top = (c.bottom + 4 + r.height > window.innerHeight - 8 ? Math.max(8, c.top - r.height - 4) : c.bottom + 4) + "px";
    };

    const mark = () => {
        popup?.querySelectorAll(".ce-menu-item[role=option]").forEach((el, i) => {
            el.classList.toggle("is-active", i === index);
            el.setAttribute("aria-selected", i === index ? "true" : "false");
            if (i === index) (el as HTMLElement).scrollIntoView({ block: "nearest" });
        });
    };

    const choose = (view: EditorView, i: number) => {
        const st = key.getState(view.state);
        const def = items[i];
        close();
        if (!st?.active || !def) return;
        opts.pick(def, st.from, st.to);
    };

    return new Plugin<SuggestState>({
        key,
        state: {
            init: () => INACTIVE,
            apply: (tr, old, _oldState, newState) => {
                const meta = tr.getMeta(key) as string | undefined;
                if (meta === "dismiss") return { ...old, dismissed: true };
                if (!tr.docChanged && !tr.selectionSet && meta !== "refresh") return old;
                const st = detect(newState);
                if (!st.active || st.from !== old.from) index = 0;
                // Esc plati jen do dalsiho psani (pohyb kurzoru v ramci zapisu ho nezrusi)
                if (st.active && old.dismissed && !tr.docChanged && st.from === old.from) st.dismissed = true;
                return st;
            },
        },
        props: {
            handleDOMEvents: {
                // navrat do editoru s kurzorem za rozepsanym "{$" - nabidku hned ukazat
                focus(view) {
                    setTimeout(() => { if (!view.isDestroyed && view.hasFocus()) view.dispatch(view.state.tr.setMeta(key, "refresh")); });
                    return false;
                },
                blur() {
                    close();
                    return false;
                },
            },
            handleKeyDown(view, e) {
                const st = key.getState(view.state);
                if (!st?.active || st.dismissed || !popup || !items.length) return false;
                if (e.key === "ArrowDown") { index = (index + 1) % items.length; mark(); return true; }
                if (e.key === "ArrowUp") { index = (index - 1 + items.length) % items.length; mark(); return true; }
                if (e.key === "Enter" || e.key === "Tab") { choose(view, index); return true; }
                if (e.key === "Escape") { close(); view.dispatch(view.state.tr.setMeta(key, "dismiss")); return true; }
                return false;
            },
        },
        view: () => ({
            update(view) {
                const st = key.getState(view.state);
                if (!st?.active || st.dismissed || !view.hasFocus()) { close(); return; }
                render(view, st);
            },
            destroy: close,
        }),
    });
}

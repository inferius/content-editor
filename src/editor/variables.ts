/**
 * Promenne webu v editoru: cip v textu, vlozeni z nabidky, uprava parametru
 * a prepinatelny nahled "jak na webu" (HTML od hostitele v izolovanem iframe).
 */
import type { Node as PMNode } from "prosemirror-model";
import type { EditorView, NodeView } from "prosemirror-view";
import { h, modal, textButton, field, type MenuItem } from "../ui/dom";
import { icon } from "../ui/icons";
import { varText, splitArgs, joinArgs } from "../core/vartext";
import { loadScopedCss, adoptSheet, sanitizePreview, WEB_SCOPE, type WebLook } from "./web";

export interface VariableDef {
    /** Nazev v textu: {$nazev} */
    name: string;
    /** Popisek v nabidce a na cipu. */
    label: string;
    /** Napoveda v nabidce / dialogu. */
    description?: string;
    /** Parametry ({$nazev:"a":"b"}), v poradi. Bez nich se vklada {$nazev}. */
    params?: VariableParam[];
    /** Jeden parametr (starsi zapis, totez jako params: [param]). */
    param?: VariableParam;
    /** Skupina v nabidce (napr. "Pro tuto stránku", "Kódy do textu"). */
    group?: string;
    /** false = editor promennou zna (cip s nazvem), ale nenabizi ji k vlozeni. */
    offer?: boolean;
    /** Lze zobrazit nahled jak na webu (vychozi true, pokud hostitel umi renderVariables). */
    preview?: boolean;
}

export interface VariableParam {
    label: string;
    placeholder?: string;
    hint?: string;
    /** Hodnota v uvozovkach (vychozi true). */
    quoted?: boolean;
    /** Regularni vyraz: kdyz na zadany text sedi, pouzije se jeho 1. skupina (napr. kod z celeho odkazu). */
    pattern?: string;
    /** Vyber ze seznamu (napr. stranky, polozky nastaveni) misto psani; na cipu se zobrazi popisek. */
    options?: VariableOption[];
}

export interface VariableOption {
    value: string;
    label: string;
}

/** Hodnota parametru pro cip: popisek z options, jinak hodnota. */
function paramLabel(def: VariableDef | undefined, index: number, value: string): string {
    const opt = paramsOf(def)[index]?.options?.find((o) => o.value === value);
    return opt ? opt.label : value;
}

export function paramsOf(def: VariableDef | null | undefined): VariableParam[] {
    return def?.params || (def?.param ? [def.param] : []);
}

/**
 * Polozky nabidky "Vlozit promennou" po skupinach. Promenne s offer: false se nenabizi.
 */
export function variableMenu(defs: VariableDef[], pick: (def: VariableDef | null) => void, manageUrl?: string | null): Array<MenuItem | "-" | { title: string }> {
    const items: Array<MenuItem | "-" | { title: string }> = [];
    const groups = new Map<string, VariableDef[]>();
    for (const d of defs) {
        if (d.offer === false) continue;
        const g = d.group || "Vložit proměnnou";
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g)!.push(d);
    }
    groups.forEach((list, title) => {
        if (items.length) items.push("-");
        items.push({ title });
        for (const d of list) {
            const n = paramsOf(d).length;
            items.push({ label: d.label, icon: "variable", hint: "{$" + d.name + (n ? ":" + paramsOf(d).map(() => "...").join(":") : "") + "}", onClick: () => pick(d) });
        }
    });
    if (items.length) items.push("-");
    items.push({ label: "Jiná proměnná...", icon: "variable", onClick: () => pick(null) });
    if (manageUrl) items.push({ label: "Spravovat kódy...", icon: "external", hint: "nová záložka", onClick: () => { window.open(manageUrl, "_blank", "noopener"); } });
    items.push({ label: "Tip: v textu stačí napsat {$", icon: "variable", disabled: true, onClick: () => undefined });
    return items;
}

/** Hostitel vrati HTML, na ktere web promenne nahradi (klic = zapis promenne v textu). */
export type RenderVariables = (codes: string[]) => Promise<Record<string, string>>;

export type VariableMode = "chip" | "preview";

export interface VariableContext {
    defs: Map<string, VariableDef>;
    mode(): VariableMode;
    renderer: VariableRenderer | null;
    web: WebLook | null;
    edit(pos: number): void;
}

// ------------------------------------------------------------------ nahledy (davkovani + cache)

export class VariableRenderer {
    private cache = new Map<string, Promise<string>>();
    private queue = new Map<string, { resolve: (v: string) => void; reject: (e: unknown) => void }>();
    private timer = 0;

    constructor(private render: RenderVariables) {}

    get(code: string): Promise<string> {
        let p = this.cache.get(code);
        if (!p) {
            p = new Promise<string>((resolve, reject) => this.queue.set(code, { resolve, reject }));
            this.cache.set(code, p);
            clearTimeout(this.timer);
            this.timer = window.setTimeout(() => this.flush(), 30);
        }
        return p;
    }

    /** Zahodit ulozene nahledy (napr. po zmene nastaveni stranky). */
    clear(): void {
        this.cache.clear();
    }

    private async flush(): Promise<void> {
        const batch = new Map(this.queue);
        this.queue.clear();
        if (!batch.size) return;
        try {
            const res = await this.render([...batch.keys()]);
            batch.forEach((p, code) => p.resolve(typeof res?.[code] === "string" ? res[code] : ""));
        } catch (e) {
            batch.forEach((p, code) => { this.cache.delete(code); p.reject(e); });
        }
    }
}

// ------------------------------------------------------------------ cip v textu

export class VariableView implements NodeView {
    dom: HTMLElement;

    constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined, private ctx: VariableContext) {
        this.dom = h("span", { class: "ce-var", contenteditable: "false" });
        this.dom.addEventListener("dblclick", (e) => { e.preventDefault(); this.openEdit(); });
        this.render();
    }

    private openEdit(): void {
        const pos = this.getPos();
        if (pos !== undefined) this.ctx.edit(pos);
    }

    private render(): void {
        this.cleanup();
        this.dom.textContent = "";
        const { name, args } = this.node.attrs as { name: string; args: string | null };
        const def = this.ctx.defs.get(name);
        const code = varText(name, args);
        const value = splitArgs(args).map((v, i) => (v === "" ? "" : paramLabel(def, i, v))).filter((v) => v !== "").join(", ");
        const canPreview = !!def && def.preview !== false && !!this.ctx.renderer;
        const preview = this.ctx.mode() === "preview" && canPreview;
        this.dom.className = ["ce-var", !def && "is-unknown", preview && "is-preview"].filter(Boolean).join(" ");
        // pole bez promennych (web v nem {$...} nenahrazuje) x neznamy nazev
        const unknown = !this.ctx.defs.size
            ? "V tomto poli web proměnné nenahrazuje - zobrazí se jako text. Přesuňte ji do pole, které proměnné nabízí (tlačítko Proměnné)."
            : "Neznámá proměnná - web ji nenahradí (smaže)";
        this.dom.title = (def ? def.label : unknown) + "\n" + code + "\nDvojklikem upravíte";

        const chip = h("span", { class: "ce-var-chip" },
            icon(def ? "variable" : "warning", 13),
            h("span", { class: "ce-var-label", text: def ? def.label : code }),
            def && value ? h("span", { class: "ce-var-value", text: value }) : null);
        this.dom.appendChild(chip);
        if (preview) this.renderPreview(code);
    }

    /**
     * Nahled v Shadow DOM se styly webu: izolovany od stylu administrace, ale media
     * dotazy webu se ridi sirkou okna (jako skutecny clanek, ne sirkou nahledu).
     */
    private renderPreview(code: string): void {
        const box = h("span", { class: "ce-var-frame is-loading" }, h("span", { class: "ce-var-note", text: "Načítám náhled..." }));
        this.dom.appendChild(box);
        const web = this.ctx.web;
        Promise.all([this.ctx.renderer!.get(code), web ? loadScopedCss(web) : Promise.resolve(null)]).then(([html, sheet]) => {
            box.textContent = "";
            box.classList.remove("is-loading");
            if (!html.trim()) {
                box.appendChild(h("span", { class: "ce-var-note", text: "Web zde nic nezobrazí (prázdný výsledek)." }));
                return;
            }
            const host = h("span", { class: "ce-var-shadow" });
            box.appendChild(host);
            const root = host.attachShadow({ mode: "open" });
            if (sheet) {
                adoptSheet(sheet); // @font-face plati jen z dokumentu
                root.adoptedStyleSheets = [sheet];
            }
            let inner = `<div class="${esc(web?.contentClass || "")}">${sanitizePreview(html)}</div>`;
            for (const w of [...(web?.wrappers || [])].reverse()) inner = `<div class="${esc(w)}">${inner}</div>`;
            root.innerHTML = "<style>:host{display:block;overflow:hidden}:where(." + WEB_SCOPE + "){background:#fff;color:#000;font-size:16px;line-height:normal;text-align:left;white-space:normal}</style>" +
                `<div class="${WEB_SCOPE} ${esc(web?.bodyClass || "")}">${inner}</div>`;
            // odkazy v nahledu neotevirat v editoru
            root.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest?.("a")) e.preventDefault(); });
        }, (e) => {
            box.textContent = "";
            box.classList.remove("is-loading");
            box.appendChild(h("span", { class: "ce-var-note is-error", text: "Náhled se nepodařilo načíst: " + ((e as Error)?.message || e) }));
        });
    }

    private cleanup(): void { /* nic k uklizeni - nahled je soucast DOM uzlu */ }

    update(node: PMNode): boolean {
        if (node.type !== this.node.type) return false;
        if (node.attrs.name === this.node.attrs.name && node.attrs.args === this.node.attrs.args) {
            this.node = node;
            return true;
        }
        this.node = node;
        this.render();
        return true;
    }

    selectNode(): void { this.dom.classList.add("is-selected"); }
    deselectNode(): void { this.dom.classList.remove("is-selected"); }
    ignoreMutation(): boolean { return true; }
    stopEvent(e: Event): boolean {
        // v iframe nahledu se nesmi rozbit vyber editoru
        return !!(e.target as HTMLElement)?.closest?.(".ce-var-frame") && e.type !== "dragstart";
    }
    destroy(): void { this.cleanup(); }
}

// ------------------------------------------------------------------ dialog

export interface VariableValue { name: string; args: string | null }

/**
 * Vlozeni / uprava promenne. current = upravovana promenna, def = vybrana z nabidky.
 * Promenna bez parametru se vklada rovnou (bez dialogu).
 */
export async function variableDialog(def: VariableDef | null, current: VariableValue | null, host?: HTMLElement): Promise<VariableValue | "remove" | null> {
    const m = modal(current ? "Proměnná" : "Vložit proměnnou", host, "ce-modal-sm");
    const name = h("input", { type: "text", class: "ce-input", spellcheck: "false", placeholder: "nazev" });
    name.value = def?.name || current?.name || "";
    const params = paramsOf(def);
    const currentValues = splitArgs(current?.args ?? null);
    const inputs: Array<HTMLInputElement | HTMLSelectElement> = params.map((p, i) => {
        const value = currentValues[i] ?? "";
        if (p.options?.length) {
            // vyber ze seznamu; neznama hodnota z textu zustane jako moznost, aby se neztratila
            const sel = h("select", { class: "ce-input" }) as HTMLSelectElement;
            sel.appendChild(h("option", { value: "", text: p.placeholder || "- vyberte -" }));
            for (const o of p.options) sel.appendChild(h("option", { value: o.value, text: o.label }));
            if (value && !p.options.some((o) => o.value === value)) sel.appendChild(h("option", { value, text: value + " (neznámá hodnota)" }));
            sel.value = value;
            return sel;
        }
        const el = h("input", { type: "text", class: "ce-input", spellcheck: "false", placeholder: p.placeholder || "" }) as HTMLInputElement;
        el.value = value;
        return el;
    });
    const raw = h("input", { type: "text", class: "ce-input", spellcheck: "false" });
    raw.value = current?.args ?? "";
    const err = h("div", { class: "ce-error", hidden: true });
    const extract = (p: VariableParam, v: string): string => {
        if (!p.pattern) return v;
        try {
            const mm = v.match(new RegExp(p.pattern, "i"));
            return mm && mm[1] ? mm[1] : v;
        } catch {
            return v;
        }
    };

    const code = h("code", { class: "ce-var-code" });
    const result = (): VariableValue => ({
        name: name.value.trim(),
        args: def
            ? (params.length ? joinArgs(inputs.map((el, i) => extract(params[i], el.value)), params.map((p) => p.quoted !== false)) : null)
            : (raw.value.trim() === "" ? null : raw.value.replace(/[{}]/g, "")),
    });
    const refresh = () => { const r = result(); code.textContent = r.name ? varText(r.name, r.args) : ""; };
    [name, raw, ...inputs].forEach((el) => { el.addEventListener("input", refresh); el.addEventListener("change", refresh); });
    refresh();

    const submit = () => {
        const r = result();
        if (!/^[A-Za-z_]\w*$/.test(r.name)) { err.textContent = "Název smí obsahovat jen písmena bez diakritiky, číslice a podtržítko."; err.hidden = false; return; }
        const empty = inputs.findIndex((el) => el.value.trim() === "");
        if (def && params.length === 1 && empty === 0) { err.textContent = "Vyplňte " + params[0].label.toLowerCase() + "."; err.hidden = false; inputs[0].focus(); return; }
        m.close(r);
    };

    const form = h("form", { class: "ce-form", onSubmit: (e: Event) => { e.preventDefault(); submit(); } },
        def ? h("div", { class: "ce-var-head" }, icon("variable", 16), h("strong", { text: def.label })) : field("Název proměnné", name),
        def?.description ? h("p", { class: "ce-muted", text: def.description }) : null,
        ...params.map((p, i) => field(p.label, inputs[i], p.hint)),
        !def ? field("Parametry (nepovinné)", raw, "Zapisují se za dvojtečku, např. \"1234\" nebo \"a\":\"b\"") : null,
        h("div", { class: "ce-field" }, h("span", { class: "ce-field-label", text: "V textu" }), code),
        err);
    m.body.appendChild(form);
    if (current) m.footer.appendChild(textButton("Odebrat", "danger", () => m.close("remove")));
    m.footer.append(h("div", { class: "ce-spacer" }), textButton("Zrušit", "secondary", () => m.close(null)), textButton(current ? "Uložit" : "Vložit", "primary", submit));
    (inputs[0] || (def ? null : name))?.focus();
    return m.result as Promise<VariableValue | "remove" | null>;
}

function esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

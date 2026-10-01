/**
 * Dialogy Vlastnosti tabulky / Vlastnosti bunky (kontextova lista tabulky, viz tabletools.ts).
 * Vse se uklada jako styly v HTML (sirka, zarovnani, pozadi, ohraniceni) - web je zobrazi sam.
 */
import { h, modal, textButton, field } from "./dom";

/**
 * Popsana skupina ovladacich prvku (prepinac, vzorky). Ne <label> jako field(): klik na popisek
 * by v labelu "kliknul" na prvni tlacitko skupiny a potichu zmenil hodnotu.
 */
function group(label: string, control: HTMLElement, hint?: string): HTMLElement {
    const id = "ce-g-" + Math.random().toString(36).slice(2, 8);
    control.setAttribute("aria-labelledby", id);
    return h("div", { class: "ce-field", role: "group", "aria-labelledby": id },
        h("span", { class: "ce-field-label", id, text: label }), control, hint ? h("span", { class: "ce-field-hint", text: hint }) : null);
}
import { icon } from "./icons";
import type { ColorDef } from "./toolbar";

export type BorderKind = "none" | "thin" | "thick";

export interface TablePropsValue {
    width: string | null;
    align: string | null;
    border: BorderKind;
    borderColor: string;
    cls: string | null;
}

export interface CellPropsValue {
    background: string | null;
    align: string | null;
    valign: string | null;
    /** inherit = jako tabulka (bunka bez vlastniho ohraniceni) */
    border: "inherit" | BorderKind;
    borderColor: string;
}

export const DEFAULT_BORDER_COLOR = "#c8ccd2";

/** Ohraniceni -> CSS hodnota atributu bunky (null = bez vlastniho ohraniceni). */
export function borderCss(kind: "inherit" | BorderKind, color: string): string | null {
    if (kind === "inherit") return null;
    if (kind === "none") return "none";
    return `${kind === "thick" ? 2 : 1}px solid ${color}`;
}

/** CSS ohraniceni bunky -> druh a barva. */
export function parseBorder(css: string | null): { kind: "inherit" | BorderKind; color: string } {
    if (!css) return { kind: "inherit", color: DEFAULT_BORDER_COLOR };
    if (css === "none") return { kind: "none", color: DEFAULT_BORDER_COLOR };
    const m = /^([\d.]+)px \w+ (.+)$/.exec(css);
    return { kind: m && parseFloat(m[1]) >= 2 ? "thick" : "thin", color: m ? m[2] : DEFAULT_BORDER_COLOR };
}

/** Svetly odstin barvy palety (pozadi bunky): smichat s bilou. */
export function tint(hex: string, amount = 0.82): string {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return hex;
    const c = [1, 2, 3].map((i) => Math.round(parseInt(m[i], 16) + (255 - parseInt(m[i], 16)) * amount));
    return "#" + c.map((x) => x.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------------ ovladaci prvky

/** Prepinac z nekolika moznosti (ikony nebo text). */
function segmented(options: Array<{ value: string; label: string; icon?: string }>, value: string, onChange?: (v: string) => void) {
    let current = value;
    const buttons = options.map((o) => h("button", {
        type: "button", class: ["ce-seg-btn", o.value === value && "is-active"], title: o.label, "aria-label": o.label,
        "aria-pressed": String(o.value === value),
        onClick: () => {
            current = o.value;
            buttons.forEach((b, i) => {
                b.classList.toggle("is-active", options[i].value === current);
                b.setAttribute("aria-pressed", String(options[i].value === current));
            });
            onChange?.(current);
        },
    }, o.icon ? icon(o.icon, 16) : null, o.icon ? null : h("span", { text: o.label })));
    return { el: h("div", { class: "ce-seg", role: "group" }, ...buttons), get value() { return current; } };
}

/** Vyber barvy ze vzorku (allowNone = prvni vzorek "bez barvy"). */
function swatches(colors: Array<{ label: string; value: string }>, value: string | null, allowNone: boolean) {
    let current = value ? value.toLowerCase() : null;
    const all: HTMLButtonElement[] = [];
    const mk = (label: string, v: string | null) => {
        const b = h("button", {
            type: "button", class: ["ce-swatch", v === null && "ce-swatch-none", v === current && "is-active"], title: label, "aria-label": label, "aria-pressed": String(v === current),
            style: v ? { background: v } : {},
            onClick: () => {
                current = v;
                all.forEach((x) => { x.classList.toggle("is-active", x === b); x.setAttribute("aria-pressed", String(x === b)); });
            },
        });
        all.push(b);
        return b;
    };
    const el = h("div", { class: "ce-swatches" }, allowNone ? mk("Bez barvy", null) : null, ...colors.map((c) => mk(c.label, c.value.toLowerCase())));
    // barva, ktera neni mezi vzorky (napr. z Wordu) - zustane zvolena, jen bez zvyrazneni
    return { el, get value() { return current; } };
}

function borderColors(colors: ColorDef[]): Array<{ label: string; value: string }> {
    return [
        { label: "Světle šedá", value: DEFAULT_BORDER_COLOR },
        { label: "Tmavě šedá", value: "#6b7280" },
        { label: "Černá", value: "#111827" },
        ...colors.filter((c) => /^#[0-9a-f]{6}$/i.test(c.value) && c.value.toLowerCase() !== "#6b7280"),
    ];
}

const BORDER_OPTIONS = [
    { value: "none", label: "Bez ohraničení" },
    { value: "thin", label: "Tenké" },
    { value: "thick", label: "Silné" },
];

// ------------------------------------------------------------------ vlastnosti tabulky

export async function tablePropsDialog(cur: TablePropsValue, colors: ColorDef[], host?: HTMLElement): Promise<TablePropsValue | null> {
    const m = modal("Vlastnosti tabulky", host, "ce-modal-sm ce-modal-tprops");

    const w = cur.width || "";
    const widthMode = h("select", { class: "ce-input" },
        h("option", { value: "auto", text: "Automaticky (podle obsahu)" }),
        h("option", { value: "full", text: "Celá šířka (100 %)" }),
        h("option", { value: "custom", text: "Vlastní" }));
    widthMode.value = !w ? "auto" : w === "100%" ? "full" : "custom";
    const widthVal = h("input", { class: "ce-input", value: w && w !== "100%" ? w : "", placeholder: "např. 600px nebo 80%" });
    const syncWidth = () => { widthVal.hidden = widthMode.value !== "custom"; };
    widthMode.addEventListener("change", syncWidth);
    syncWidth();

    const align = segmented([
        { value: "", label: "Vlevo", icon: "alignLeft" },
        { value: "center", label: "Na střed", icon: "alignCenter" },
        { value: "right", label: "Vpravo", icon: "alignRight" },
    ], cur.align || "");
    const border = segmented(BORDER_OPTIONS, cur.border);
    const color = swatches(borderColors(colors), cur.borderColor, false);

    const classes = (cur.cls || "").split(/\s+/).filter(Boolean);
    const responsive = h("input", { type: "checkbox" }) as HTMLInputElement;
    responsive.checked = classes.includes("img-responsive");
    const otherCls = h("input", { class: "ce-input", value: classes.filter((c) => c !== "img-responsive").join(" "), placeholder: "-" });
    const err = h("div", { class: "ce-error", hidden: true });

    const submit = () => {
        let width: string | null = null;
        if (widthMode.value === "full") width = "100%";
        else if (widthMode.value === "custom") {
            const v = widthVal.value.trim().replace(/\s+/g, "");
            const norm = /^\d+(\.\d+)?$/.test(v) ? v + "px" : v;
            if (!/^\d+(\.\d+)?(px|%|em|rem)$/.test(norm)) {
                err.textContent = "Šířku zadejte jako číslo s jednotkou, např. 600px nebo 80%.";
                err.hidden = false;
                widthVal.focus();
                return;
            }
            width = norm;
        }
        m.close({
            width,
            align: align.value || null,
            border: border.value as BorderKind,
            borderColor: color.value || DEFAULT_BORDER_COLOR,
            cls: [responsive.checked ? "img-responsive" : "", ...otherCls.value.split(/\s+/)].filter(Boolean).join(" ") || null,
        });
    };

    m.body.append(h("form", { class: "ce-form", onSubmit: (e: Event) => { e.preventDefault(); submit(); } },
        field("Šířka", h("div", { class: "ce-row" }, widthMode, widthVal)),
        group("Zarovnání tabulky", align.el),
        group("Ohraničení buněk", border.el, "Při změně nastaví všechny buňky - jednotlivé buňky pak jdou změnit ve Vlastnostech buňky"),
        group("Barva ohraničení", color.el),
        h("label", { class: "ce-check" }, responsive, h("span", { text: "Přizpůsobit šířce stránky na mobilu (img-responsive)" })),
        field("Další třídy (class)", otherCls, "Třídy CSS webu, obvykle prázdné"),
        err));
    m.footer.append(h("div", { class: "ce-spacer" }), textButton("Zrušit", "secondary", () => m.close(null)), textButton("Uložit", "primary", submit));
    return m.result as Promise<TablePropsValue | null>;
}

// ------------------------------------------------------------------ vlastnosti bunky

export async function cellPropsDialog(cur: CellPropsValue, count: number, colors: ColorDef[], host?: HTMLElement): Promise<CellPropsValue | null> {
    const m = modal(count > 1 ? `Vlastnosti buněk (${count})` : "Vlastnosti buňky", host, "ce-modal-sm ce-modal-tprops");

    // pozadi: svetle odstiny barev palety + neutralni seda (tmave pozadi by zhorsilo citelnost)
    const bgColors = [
        { label: "Světle šedá", value: "#f3f4f6" },
        { label: "Šedá", value: "#e5e7eb" },
        ...colors.filter((c) => /^#[0-9a-f]{6}$/i.test(c.value)).map((c) => ({ label: c.label + " (světlá)", value: tint(c.value) })),
    ];
    const background = swatches(bgColors, cur.background, true);
    const align = segmented([
        { value: "", label: "Výchozí", icon: "alignLeft" },
        { value: "center", label: "Na střed", icon: "alignCenter" },
        { value: "right", label: "Vpravo", icon: "alignRight" },
        { value: "justify", label: "Do bloku", icon: "alignJustify" },
    ], cur.align || "");
    const valign = segmented([
        { value: "", label: "Výchozí" },
        { value: "top", label: "Nahoru" },
        { value: "middle", label: "Na střed" },
        { value: "bottom", label: "Dolů" },
    ], cur.valign || "");
    const border = segmented([{ value: "inherit", label: "Jako tabulka" }, ...BORDER_OPTIONS], cur.border);
    const color = swatches(borderColors(colors), cur.borderColor, false);

    const submit = () => m.close({
        background: background.value,
        align: align.value || null,
        valign: valign.value || null,
        border: border.value as CellPropsValue["border"],
        borderColor: color.value || DEFAULT_BORDER_COLOR,
    });

    m.body.append(h("form", { class: "ce-form", onSubmit: (e: Event) => { e.preventDefault(); submit(); } },
        group("Pozadí", background.el),
        group("Zarovnání textu", align.el),
        group("Svislé zarovnání", valign.el),
        group("Ohraničení", border.el),
        group("Barva ohraničení", color.el)));
    m.footer.append(h("div", { class: "ce-spacer" }), textButton("Zrušit", "secondary", () => m.close(null)), textButton("Uložit", "primary", submit));
    return m.result as Promise<CellPropsValue | null>;
}

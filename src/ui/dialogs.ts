/**
 * Dialogy nastaveni bloku a odkazu. Kazdy vraci Promise s novymi atributy,
 * null = zruseno.
 */
import { h, modal, textButton, field, showPopover, closeMenu } from "./dom";
import { icon } from "./icons";
import { CONTACT_FORM_ACTION, safeHref, safeSrc, youtubeEmbed } from "../core/urls";
import { SourceEditor } from "../editor/source";

export interface PickedImage {
    src: string;
    alt?: string;
}
export type PickImage = () => Promise<PickedImage | null>;

function input(value: string | null | undefined, attrs: Record<string, string> = {}): HTMLInputElement {
    const el = h("input", { type: "text", class: "ce-input", spellcheck: "false", ...attrs });
    el.value = value ?? "";
    return el;
}

function checkbox(label: string, checked: boolean): { wrap: HTMLElement; input: HTMLInputElement } {
    const inp = h("input", { type: "checkbox" });
    inp.checked = checked;
    return { wrap: h("label", { class: "ce-check" }, inp, h("span", { text: label })), input: inp };
}

function select(options: Array<[string, string]>, value: string): HTMLSelectElement {
    const el = h("select", { class: "ce-input ce-select" }, ...options.map(([v, l]) => h("option", { value: v, text: l })));
    el.value = value;
    return el;
}

function error(msg: string): HTMLElement {
    return h("div", { class: "ce-error", text: msg });
}

// ------------------------------------------------------------------ odkaz

export interface LinkResult { href: string; target: string | null; text?: string }

export async function linkDialog(current: { href?: string; target?: string | null } | null, needText: boolean, host?: HTMLElement): Promise<LinkResult | "remove" | null> {
    const m = modal(current ? "Upravit odkaz" : "Vložit odkaz", host, "ce-modal-sm");
    const href = input(current?.href || "", { placeholder: "https://... nebo /stranka/" });
    const text = input("", { placeholder: "Text odkazu" });
    const blank = checkbox("Otevřít v novém okně", current ? current.target === "_blank" : true);
    const err = error("");
    err.hidden = true;
    const submit = () => {
        const v = safeHref(href.value.trim());
        if (!v) {
            err.textContent = "Zadejte platnou adresu (http, https, mailto:, tel: nebo cestu na webu).";
            err.hidden = false;
            href.focus();
            return;
        }
        m.close({ href: v, target: blank.input.checked ? "_blank" : null, text: needText ? text.value.trim() || undefined : undefined });
    };
    const form = h("form", { class: "ce-form", onSubmit: (e: Event) => { e.preventDefault(); submit(); } },
        field("Adresa", href),
        needText ? field("Text", text) : null,
        blank.wrap, err);
    m.body.appendChild(form);
    if (current) m.footer.appendChild(textButton("Odebrat odkaz", "danger", () => m.close("remove")));
    m.footer.append(h("div", { class: "ce-spacer" }), textButton("Zrušit", "secondary", () => m.close(null)), textButton(current ? "Uložit" : "Vložit", "primary", submit));
    href.focus();
    return m.result as Promise<LinkResult | "remove" | null>;
}

// ------------------------------------------------------------------ obrazek

export interface ImageAttrs { src: string; alt: string; title: string | null; cls: string | null; width: string | null; height: string | null }

export async function imageDialog(current: ImageAttrs | null, pickImage: PickImage | null, host?: HTMLElement): Promise<ImageAttrs | null> {
    const m = modal(current ? "Obrázek" : "Vložit obrázek", host, "ce-modal-image");
    const state: ImageAttrs = current ? { ...current } : { src: "", alt: "", title: null, cls: "img-responsive", width: null, height: null };

    const preview = h("div", { class: "ce-img-preview" });
    const src = input(state.src, { placeholder: "/uploaded_data/... nebo https://..." });
    const alt = input(state.alt, { placeholder: "Co je na obrázku (pro nevidomé a vyhledávače)" });
    const responsive = checkbox("Přizpůsobit šířce stránky (img-responsive)", (state.cls || "").split(/\s+/).includes("img-responsive"));
    const width = input((state.width || "").replace(/px$/, ""), { placeholder: "automaticky", inputmode: "numeric" });
    const err = error("");
    err.hidden = true;

    const renderPreview = () => {
        preview.textContent = "";
        const s = safeSrc(src.value);
        if (s) preview.appendChild(h("img", { src: s, alt: "" }));
        else preview.appendChild(h("span", { class: "ce-muted", text: "Zatím není vybraný žádný obrázek." }));
    };
    src.addEventListener("input", renderPreview);
    renderPreview();

    const pick = pickImage ? textButton("Vybrat ze souborů", "secondary", async () => {
        const picked = await pickImage();
        if (!picked) return;
        src.value = picked.src;
        if (picked.alt && !alt.value) alt.value = picked.alt;
        renderPreview();
    }) : null;

    const submit = () => {
        const s = safeSrc(src.value);
        if (!s) {
            err.textContent = "Vyberte obrázek nebo zadejte platnou adresu.";
            err.hidden = false;
            return;
        }
        const classes = (state.cls || "").split(/\s+/).filter((c) => c && c !== "img-responsive");
        if (responsive.input.checked) classes.unshift("img-responsive");
        const w = parseInt(width.value, 10);
        const keepRatio = state.width && state.height && w > 0;
        m.close({
            ...state,
            src: s,
            alt: alt.value.trim(),
            cls: classes.join(" ") || null,
            width: w > 0 ? `${w}px` : null,
            // vyska se pri zmene sirky dopocita v prohlizeci (auto) - pevnou vysku zachovat jen beze zmeny
            height: keepRatio && state.width === `${w}px` ? state.height : null,
        });
    };

    m.body.append(
        preview,
        h("div", { class: "ce-row" }, pick, h("div", { class: "ce-grow" }, field("Adresa obrázku", src))),
        field("Alternativní text", alt),
        h("div", { class: "ce-row ce-row-bottom" }, h("div", { class: "ce-w-160" }, field("Šířka (px)", width)), responsive.wrap),
        err,
    );
    m.footer.append(h("div", { class: "ce-spacer" }), textButton("Zrušit", "secondary", () => m.close(null)), textButton(current ? "Uložit" : "Vložit", "primary", submit));
    if (!current && pickImage) {
        // nove vkladani: rovnou otevrit vyber souboru
        setTimeout(() => (pick as HTMLButtonElement).click(), 50);
    }
    return m.result as Promise<ImageAttrs | null>;
}

// ------------------------------------------------------------------ tlacitko

export interface ButtonAttrs { text: string; href: string; variant: string; target: string | null }

export const BUTTON_VARIANTS: Array<[string, string]> = [
    ["medium", "Hlavní (btn medium)"],
    ["btn-main", "Výrazné (btn-main)"],
    ["btn-basic", "Základní (btn-basic)"],
];

export async function buttonDialog(current: ButtonAttrs | null, host?: HTMLElement): Promise<ButtonAttrs | null> {
    const m = modal(current ? "Tlačítko" : "Vložit tlačítko", host, "ce-modal-sm");
    const isContact = !current || current.href === CONTACT_FORM_ACTION;
    const text = input(current?.text || "Chci nezávaznou nabídku", { placeholder: "Text tlačítka" });
    const action = select([["contact", "Posunout na kontaktní formulář"], ["link", "Otevřít odkaz"]], isContact ? "contact" : "link");
    const url = input(isContact ? "" : current?.href || "", { placeholder: "https://... nebo /stranka/" });
    const blank = checkbox("Otevřít v novém okně", current?.target === "_blank");
    const variants = BUTTON_VARIANTS.some(([v]) => v === current?.variant) || !current ? BUTTON_VARIANTS : [...BUTTON_VARIANTS, [current.variant, current.variant] as [string, string]];
    const variant = select(variants, current?.variant || "medium");
    const urlRow = h("div", {}, field("Adresa", url), blank.wrap);
    const err = error("");
    err.hidden = true;
    const sync = () => { urlRow.hidden = action.value !== "link"; };
    action.addEventListener("change", sync);
    sync();
    const submit = () => {
        if (!text.value.trim()) { err.textContent = "Zadejte text tlačítka."; err.hidden = false; return; }
        let href = CONTACT_FORM_ACTION;
        if (action.value === "link") {
            href = safeHref(url.value);
            if (!href || href.startsWith("javascript:")) { err.textContent = "Zadejte platnou adresu."; err.hidden = false; return; }
        }
        m.close({ text: text.value.trim(), href, variant: variant.value, target: action.value === "link" && blank.input.checked ? "_blank" : null });
    };
    m.body.append(h("form", { class: "ce-form", onSubmit: (e: Event) => { e.preventDefault(); submit(); } },
        field("Text", text), field("Po kliknutí", action), urlRow, field("Vzhled", variant), err));
    m.footer.append(h("div", { class: "ce-spacer" }), textButton("Zrušit", "secondary", () => m.close(null)), textButton(current ? "Uložit" : "Vložit", "primary", submit));
    text.focus();
    text.select();
    return m.result as Promise<ButtonAttrs | null>;
}

// ------------------------------------------------------------------ video

export async function videoDialog(current: { src: string; title: string } | null, host?: HTMLElement): Promise<{ src: string; title: string } | null> {
    const m = modal(current ? "Video" : "Vložit video z YouTube", host, "ce-modal-sm");
    const url = input(current?.src ? current.src.replace("/embed/", "/watch?v=") : "", { placeholder: "https://www.youtube.com/watch?v=..." });
    const title = input(current?.title || "", { placeholder: "Název videa (pro čtečky)" });
    const preview = h("div", { class: "ce-img-preview ce-video-preview" });
    const err = error("");
    err.hidden = true;
    const render = () => {
        preview.textContent = "";
        const id = youtubeEmbed(url.value).split("/embed/")[1];
        if (id) preview.appendChild(h("img", { src: `https://img.youtube.com/vi/${id}/hqdefault.jpg`, alt: "" }));
        else preview.appendChild(h("span", { class: "ce-muted", text: "Vložte odkaz na video na YouTube." }));
    };
    url.addEventListener("input", render);
    render();
    const submit = () => {
        const src = youtubeEmbed(url.value);
        if (!src) { err.textContent = "Tohle není odkaz na video na YouTube."; err.hidden = false; return; }
        m.close({ src, title: title.value.trim() || "YouTube video player" });
    };
    m.body.append(h("form", { class: "ce-form", onSubmit: (e: Event) => { e.preventDefault(); submit(); } }, preview, field("Odkaz na video", url), field("Název", title), err));
    m.footer.append(h("div", { class: "ce-spacer" }), textButton("Zrušit", "secondary", () => m.close(null)), textButton(current ? "Uložit" : "Vložit", "primary", submit));
    url.focus();
    return m.result as Promise<{ src: string; title: string } | null>;
}

// ------------------------------------------------------------------ HTML blok

export async function rawDialog(html: string, host?: HTMLElement): Promise<string | null> {
    const m = modal("HTML blok", host, "ce-modal-wide ce-modal-code");
    m.body.append(h("p", { class: "ce-muted", text: "Obsah, který editor nezná (vlastní layout, formulář, vložený kód). Uloží se přesně tak, jak je zapsaný." }));
    const box = h("div", { class: "ce-source ce-source-dialog" });
    m.body.append(box);
    const src = new SourceEditor(box, html, { cursor: html.length });
    const done = (v: string | null) => { const val = v === null ? null : src.value; src.destroy(); m.close(val); };
    m.footer.append(h("div", { class: "ce-spacer" }), textButton("Zrušit", "secondary", () => done(null)), textButton("Uložit", "primary", () => done("")));
    src.focus();
    return m.result as Promise<string | null>;
}

// ------------------------------------------------------------------ tabulka

export interface TableProps { cls: string | null; width: string | null; border: string | null }
export interface TableInsert extends TableProps { rows: number; cols: number; headerRow: boolean; headerCol: boolean }

const GRID_ROWS = 8;
const GRID_COLS = 10;

/**
 * Mrizka pro vyber velikosti tabulky. Najeti mysi ukaze velikost, klik zavola onPick.
 * selected = zvolena velikost (zustane zvyraznena, kdyz mys mrizku opusti).
 */
export function tableGrid(onPick: (rows: number, cols: number) => void, selected: { rows: number; cols: number } | null = null) {
    const cells: HTMLElement[] = [];
    const size = h("div", { class: "ce-grid-size" });
    let sel = selected;
    const paint = (r: number, c: number, hover: boolean) => {
        cells.forEach((cell) => {
            const cr = +cell.dataset.r!;
            const cc = +cell.dataset.c!;
            cell.classList.toggle("is-on", cr <= r && cc <= c);
            cell.classList.toggle("is-hover", hover);
        });
        size.textContent = r && c ? `${r} x ${c}` : "Vyberte velikost";
    };
    const reset = () => paint(sel?.rows || 0, sel?.cols || 0, false);
    const grid = h("div", { class: "ce-grid", style: { gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)` } });
    for (let r = 1; r <= GRID_ROWS; r++) {
        for (let c = 1; c <= GRID_COLS; c++) {
            const cell = h("button", { type: "button", class: "ce-grid-cell", dataset: { r: String(r), c: String(c) }, "aria-label": `${r} x ${c}` });
            cell.addEventListener("mouseenter", () => paint(r, c, true));
            cell.addEventListener("focus", () => paint(r, c, true));
            cell.addEventListener("mousedown", (e) => e.preventDefault());
            // fokus na kliknutou bunku (mousedown je zablokovany kvuli fokusu editoru) - jinak by
            // obrys fokusu zustal na predchozi bunce
            cell.addEventListener("click", () => { if (cell.isConnected) cell.focus({ preventScroll: true }); onPick(r, c); });
            cells.push(cell);
            grid.appendChild(cell);
        }
    }
    grid.addEventListener("mouseleave", reset);
    reset();
    return {
        grid, size, cells,
        /** Zvolena velikost (napr. z poli Radky / Sloupce). */
        select(rows: number, cols: number) { sel = { rows, cols }; reset(); },
    };
}

/**
 * Rychle vlozeni tabulky z toolbaru: mrizka (klik = vlozit) a "Upresnit..." = dialog s volbami.
 */
export function tablePicker(anchor: HTMLElement, onPick: (rows: number, cols: number) => void, onMore: () => void): void {
    const g = tableGrid((r, c) => { closeMenu(); onPick(r, c); });
    const more = h("button", {
        type: "button", class: "ce-menu-item ce-table-more",
        onMousedown: (e: MouseEvent) => e.preventDefault(),
        onClick: () => { closeMenu(); onMore(); },
    }, icon("settings", 16), h("span", { class: "ce-menu-label", text: "Upřesnit..." }), h("span", { class: "ce-menu-hint", text: "záhlaví, šířka, ohraničení" }));
    showPopover(anchor, h("div", { class: "ce-menu ce-table-popover" },
        h("div", { class: "ce-menu-title", text: "Vložit tabulku" }), g.grid, g.size, h("div", { class: "ce-menu-sep" }), more));
}

/**
 * Vlozeni tabulky (mrizka + volby) nebo uprava vlastnosti existujici (current).
 * Sirka: automaticky / cela sirka / vlastni; trida img-responsive = na mobilu se
 * tabulka prizpusobi sirce stranky. Klik do mrizky jen nastavi velikost.
 */
export async function tableDialog(current: TableProps | null, host?: HTMLElement): Promise<TableInsert | null> {
    const m = modal(current ? "Vlastnosti tabulky" : "Vložit tabulku", host, current ? "ce-modal-sm" : "ce-modal-table");
    const rows = input("3", { type: "number", min: "1", max: "50", inputmode: "numeric" });
    const cols = input("3", { type: "number", min: "1", max: "12", inputmode: "numeric" });
    const headerRow = checkbox("První řádek jako záhlaví", false);
    const headerCol = checkbox("První sloupec jako záhlaví", false);

    const w = current?.width || "";
    const widthMode = select([["auto", "Automaticky (podle obsahu)"], ["full", "Celá šířka (100 %)"], ["custom", "Vlastní"]],
        !w ? "auto" : w === "100%" ? "full" : "custom");
    const widthVal = input(w && w !== "100%" ? w : "", { placeholder: "např. 600px nebo 80%" });
    const classes = (current?.cls || (current ? "" : "img-responsive")).split(/\s+/).filter(Boolean);
    const responsive = checkbox("Přizpůsobit šířce stránky na mobilu (img-responsive)", classes.includes("img-responsive"));
    const border = checkbox("Ohraničení buněk", current ? current.border !== "0" && current.border !== null : true);
    const otherCls = input(classes.filter((c) => c !== "img-responsive").join(" "), { placeholder: "-" });
    const err = error("");
    err.hidden = true;
    const syncWidth = () => { widthVal.hidden = widthMode.value !== "custom"; };
    widthMode.addEventListener("change", syncWidth);
    syncWidth();

    // mrizka: klik nastavi velikost (dialog zustane otevreny), vlozi se tlacitkem Vlozit
    const g = tableGrid((r, c) => {
        rows.value = String(r);
        cols.value = String(c);
        g.select(r, c);
    }, { rows: 3, cols: 3 });
    const { grid, size, cells } = g;
    [rows, cols].forEach((el) => el.addEventListener("input", () => g.select(parseInt(rows.value, 10) || 0, parseInt(cols.value, 10) || 0)));

    const submit = () => {
        let width: string | null = null;
        if (widthMode.value === "full") width = "100%";
        else if (widthMode.value === "custom") {
            const v = widthVal.value.trim().replace(/\s+/g, "");
            const norm = /^\d+(\.\d+)?$/.test(v) ? v + "px" : v;
            if (!/^\d+(\.\d+)?(px|%|em|rem)$/.test(norm)) { err.textContent = "Šířku zadejte jako číslo s jednotkou, např. 600px nebo 80%."; err.hidden = false; widthVal.focus(); return; }
            width = norm;
        }
        const cls = [responsive.input.checked ? "img-responsive" : "", ...otherCls.value.split(/\s+/)].filter(Boolean).join(" ") || null;
        m.close({
            rows: Math.max(1, Math.min(50, parseInt(rows.value, 10) || 3)),
            cols: Math.max(1, Math.min(12, parseInt(cols.value, 10) || 3)),
            headerRow: headerRow.input.checked,
            headerCol: headerCol.input.checked,
            width, cls, border: border.input.checked ? "1" : "0",
        });
    };

    const options = h("div", { class: "ce-form" },
        field("Šířka", h("div", { class: "ce-row" }, widthMode, widthVal)),
        border.wrap, responsive.wrap,
        field("Další třídy (class)", otherCls, "Třídy CSS webu, obvykle prázdné"),
        err);
    if (current) {
        m.body.append(h("form", { class: "ce-form", onSubmit: (e: Event) => { e.preventDefault(); submit(); } }, options));
    } else {
        m.body.append(h("form", { class: "ce-table-insert", onSubmit: (e: Event) => { e.preventDefault(); submit(); } },
            h("div", { class: "ce-table-pick" },
                h("span", { class: "ce-field-label", text: "Velikost - vyberte v mřížce nebo zadejte" }), grid, size,
                h("div", { class: "ce-row" }, field("Řádky", rows), field("Sloupce", cols))),
            h("div", { class: "ce-table-opts" }, headerRow.wrap, headerCol.wrap, options)));
    }
    m.footer.append(h("div", { class: "ce-spacer" }), textButton("Zrušit", "secondary", () => m.close(null)), textButton(current ? "Uložit" : "Vložit", "primary", submit));
    (current ? widthMode : cells[2 * GRID_COLS + 2]).focus();
    return m.result as Promise<TableInsert | null>;
}

// ------------------------------------------------------------------ sloupce

export interface ColumnsSettings { layout: string; widths: string | null; gap: string | null; valign: string | null; mobile: string | null }

/** Pevna rozvrzeni: klic, popisek, pomer sloupcu (pro obrazek). */
export const COLUMN_PRESETS: Array<[string, string, number[]]> = [
    ["2", "2 stejné", [1, 1]],
    ["3", "3 stejné", [1, 1, 1]],
    ["4", "4 stejné", [1, 1, 1, 1]],
    ["1-2", "1/3 + 2/3", [1, 2]],
    ["2-1", "2/3 + 1/3", [2, 1]],
];

/** Obrazek rozvrzeni: obdelniky v pomeru sirek. */
export function layoutIcon(ratios: number[]): HTMLElement {
    return h("span", { class: "ce-layout-icon", "aria-hidden": "true" },
        ...ratios.map((r) => h("span", { style: { flexGrow: String(r) } })));
}

function widthsRatios(widths: string): number[] {
    return widths.split(/\s+/).map((w) => {
        const v = parseFloat(w);
        return /fr$/.test(w) && v > 0 ? v : /%$/.test(w) && v > 0 ? v / 25 : 1;
    });
}

/**
 * Nastaveni sloupcu (vlozeni pres Upresnit... i uprava existujicich).
 * Rozvrzeni jako obrazkove volby, vlastni sirky (fr / % / px), mezera, svisle zarovnani, mobil.
 */
export async function columnsDialog(current: ColumnsSettings | null, host?: HTMLElement): Promise<ColumnsSettings | null> {
    const m = modal(current ? "Nastavení sloupců" : "Vložit sloupce", host, "ce-modal-columns");
    let layout = current?.layout || "2";
    const customWidths = (current?.widths || "1fr 1fr").split(/\s+/);

    const cards = h("div", { class: "ce-layouts", role: "radiogroup", "aria-label": "Rozvržení" });
    const customBox = h("div", { class: "ce-layout-custom" });
    const countSel = select([["2", "2 sloupce"], ["3", "3 sloupce"], ["4", "4 sloupce"]], String(Math.max(2, Math.min(4, customWidths.length))));
    const widthInputs: HTMLInputElement[] = [];
    const preview = h("span", { class: "ce-layout-icon ce-layout-preview" });
    const err = error("");
    err.hidden = true;

    const renderCustom = () => {
        const count = parseInt(countSel.value, 10);
        while (customWidths.length < count) customWidths.push("1fr");
        customWidths.length = count;
        const row = h("div", { class: "ce-row ce-widths" });
        widthInputs.length = 0;
        customWidths.forEach((w, i) => {
            const inp = input(w, { placeholder: "1fr", "aria-label": `Šířka ${i + 1}. sloupce` });
            inp.addEventListener("input", () => { customWidths[i] = inp.value.trim(); renderPreview(); });
            widthInputs.push(inp);
            row.appendChild(field(`${i + 1}. sloupec`, inp));
        });
        customBox.textContent = "";
        customBox.append(field("Počet", countSel), row,
            h("p", { class: "ce-field-hint", text: "Šířky jako poměr (1fr 2fr), procenta (30% 70%) nebo pevně (250px 1fr)." }),
            h("div", { class: "ce-field" }, h("span", { class: "ce-field-label", text: "Náhled" }), preview));
        renderPreview();
    };
    const renderPreview = () => {
        preview.textContent = "";
        widthsRatios(customWidths.join(" ")).forEach((r) => preview.appendChild(h("span", { style: { flexGrow: String(r) } })));
    };
    countSel.addEventListener("change", renderCustom);

    const choose = (key: string) => {
        layout = key;
        cards.querySelectorAll(".ce-layout-card").forEach((c) => {
            const on = (c as HTMLElement).dataset.layout === key;
            c.classList.toggle("is-active", on);
            c.setAttribute("aria-checked", on ? "true" : "false");
        });
        customBox.hidden = key !== "custom";
        if (key === "custom") renderCustom();
    };
    for (const [key, label, ratios] of [...COLUMN_PRESETS, ["custom", "Vlastní", [1, 2, 1]] as [string, string, number[]]]) {
        cards.appendChild(h("button", {
            type: "button", class: "ce-layout-card", role: "radio", dataset: { layout: key },
            onClick: () => choose(key),
        }, layoutIcon(ratios), h("span", { text: label })));
    }

    const gap = select([["", "Střední (výchozí)"], ["0", "Žádná"], ["s", "Malá"], ["l", "Velká"]], current?.gap || "");
    const valign = select([["", "Nahoru (výchozí)"], ["center", "Na střed"], ["end", "Dolů"], ["stretch", "Roztáhnout na stejnou výšku"]], current?.valign || "");
    const mobile = select([["", "Pod sebe (výchozí)"], ["rev", "Pod sebe, obráceně"], ["keep", "Nechat vedle sebe"]], current?.mobile || "");

    const submit = () => {
        let widths: string | null = null;
        if (layout === "custom") {
            const norm = customWidths.map((w) => (/^\d+(\.\d+)?$/.test(w.trim()) ? w.trim() + "fr" : w.trim())).join(" ");
            widths = /^((\d+(\.\d+)?(fr|%|px|rem|em)|auto)\s?){2,4}$/.test(norm) ? norm : null;
            if (!widths) { err.textContent = "Šířky zadejte jako 1fr, 30% nebo 250px."; err.hidden = false; return; }
        }
        m.close({ layout, widths, gap: gap.value || null, valign: valign.value || null, mobile: mobile.value || null });
    };

    m.body.append(h("form", { class: "ce-form", onSubmit: (e: Event) => { e.preventDefault(); submit(); } },
        h("div", { class: "ce-field" }, h("span", { class: "ce-field-label", text: "Rozvržení" }), cards),
        customBox,
        h("div", { class: "ce-row" }, field("Mezera mezi sloupci", gap), field("Svislé zarovnání", valign)),
        field("Na mobilu", mobile, "Na úzké obrazovce jsou sloupce standardně pod sebou."),
        current ? h("p", { class: "ce-field-hint", text: "Při menším počtu sloupců se obsah odebraných přesune do posledního sloupce." }) : null,
        err));
    m.footer.append(h("div", { class: "ce-spacer" }), textButton("Zrušit", "secondary", () => m.close(null)), textButton(current ? "Uložit" : "Vložit", "primary", submit));
    choose(layout);
    (cards.querySelector(".is-active") as HTMLElement | null)?.focus();
    return m.result as Promise<ColumnsSettings | null>;
}

// ------------------------------------------------------------------ kontejner / tabulka - vlastnosti

export async function attrsDialog(title: string, fields: Array<{ key: string; label: string; value: string | null; hint?: string }>, host?: HTMLElement): Promise<Record<string, string | null> | null> {
    const m = modal(title, host, "ce-modal-sm");
    const inputs = fields.map((f) => ({ f, el: input(f.value, { placeholder: "-" }) }));
    const submit = () => {
        const out: Record<string, string | null> = {};
        inputs.forEach(({ f, el }) => { out[f.key] = el.value.trim() || null; });
        m.close(out);
    };
    m.body.append(h("form", { class: "ce-form", onSubmit: (e: Event) => { e.preventDefault(); submit(); } },
        ...inputs.map(({ f, el }) => field(f.label, el, f.hint))));
    m.footer.append(h("div", { class: "ce-spacer" }), textButton("Zrušit", "secondary", () => m.close(null)), textButton("Uložit", "primary", submit));
    inputs[0]?.el.focus();
    return m.result as Promise<Record<string, string | null> | null>;
}

/** Male DOM pomucky: h() pro stavbu prvku, modal, rozbalovaci menu. */
import { icon } from "./icons";

type Child = Node | string | null | undefined | false | Child[];
type Attrs = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === false || v === null || v === undefined) continue;
        if (k === "class") el.className = Array.isArray(v) ? v.filter(Boolean).join(" ") : String(v);
        else if (k === "text") el.textContent = String(v);
        else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
        else if (k === "dataset" && typeof v === "object") Object.assign(el.dataset, v);
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
        else if (v === true) el.setAttribute(k, "");
        else el.setAttribute(k, String(v));
    }
    add(el, children);
    return el;
}

export function add(el: Node, children: Child[]): void {
    for (const c of children) {
        if (c === null || c === undefined || c === false) continue;
        if (Array.isArray(c)) add(el, c);
        else el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
}

export function iconButton(name: string, title: string, onClick: (e: MouseEvent) => void, extra: Attrs = {}): HTMLButtonElement {
    return h("button", {
        type: "button", class: "ce-btn", title, "aria-label": title,
        // mousedown nesmi vzit fokus editoru (zmizel by vyber)
        onMousedown: (e: MouseEvent) => e.preventDefault(),
        onClick,
        ...extra,
    }, icon(name, 18));
}

// ------------------------------------------------------------------ modal

export interface Modal {
    dialog: HTMLDialogElement;
    body: HTMLElement;
    footer: HTMLElement;
    close(value?: unknown): void;
    result: Promise<unknown>;
}

export function modal(title: string, host: HTMLElement = document.body, className = ""): Modal {
    let resolve!: (v: unknown) => void;
    const result = new Promise<unknown>((r) => { resolve = r; });
    const body = h("div", { class: "ce-modal-body" });
    const footer = h("div", { class: "ce-modal-foot" });
    const closeBtn = h("button", { type: "button", class: "ce-btn", "aria-label": "Zavřít", title: "Zavřít" }, icon("close", 16));
    const dialog = h("dialog", { class: ["ce-modal", className] },
        h("div", { class: "ce-modal-head" }, h("h3", { text: title }), closeBtn), body, footer);
    let done = false;
    const close = (value: unknown = null) => {
        if (done) return;
        done = true;
        if (dialog.open) dialog.close();
        dialog.remove();
        resolve(value);
    };
    closeBtn.addEventListener("click", () => close(null));
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(null); });
    dialog.addEventListener("mousedown", (e) => {
        // klik na sam <dialog> je bud pozadi, nebo uchyt pro zmenu velikosti -
        // rozhodne poloha: zavirame jen mimo okno
        if (e.target !== dialog) return;
        const r = dialog.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(null);
    });
    host.appendChild(dialog);
    dialog.showModal();
    return { dialog, body, footer, close, result };
}

export function textButton(label: string, variant: "primary" | "secondary" | "danger" = "secondary", onClick?: () => void): HTMLButtonElement {
    return h("button", { type: "button", class: ["ce-tbtn", "ce-tbtn-" + variant], onClick }, label);
}

export function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
    return h("label", { class: "ce-field" }, h("span", { class: "ce-field-label", text: label }), input, hint ? h("span", { class: "ce-field-hint", text: hint }) : null);
}

// ------------------------------------------------------------------ menu

export interface MenuItem {
    label: string;
    icon?: string;
    onClick: () => void;
    active?: boolean;
    danger?: boolean;
    disabled?: boolean;
    hint?: string;
}

/**
 * Plovouci panel uvnitr posuvne casti editoru (position: absolute v kontejneru): posouva se
 * s textem, orizne ho editor a lepive prvky stranky i lista nastroju ho prekryji.
 * anchor = souradnice textu na obrazovce (coordsAtPos), prefer = kam primarne (kdyz se tam
 * ve viditelne casti kontejneru nevejde, tak na druhou stranu).
 */
export function placeInside(el: HTMLElement, container: HTMLElement, anchor: { left: number; right: number; top: number; bottom: number }, prefer: "above" | "below", align: "start" | "center"): void {
    const cr = container.getBoundingClientRect();
    const ox = container.scrollLeft - cr.left - container.clientLeft;
    const oy = container.scrollTop - cr.top - container.clientTop;
    const w = el.offsetWidth, hgt = el.offsetHeight;
    let x = (align === "center" ? (anchor.left + anchor.right - w) / 2 : anchor.left) + ox;
    x = Math.max(container.scrollLeft + 4, Math.min(x, container.scrollLeft + container.clientWidth - w - 4));
    const visTop = container.scrollTop, visBottom = visTop + container.clientHeight;
    const below = anchor.bottom + oy + 6;
    const above = anchor.top + oy - hgt - 6;
    const fitsBelow = below + hgt <= visBottom - 2;
    const fitsAbove = above >= visTop + 2;
    const y = prefer === "below" ? (fitsBelow || !fitsAbove ? below : above) : (fitsAbove || !fitsBelow ? above : below);
    el.style.left = Math.round(x) + "px";
    el.style.top = Math.round(y) + "px";
}

let openMenu: HTMLElement | null = null;

export function closeMenu(): void {
    if (openMenu) openMenu.remove();
    openMenu = null;
    document.removeEventListener("mousedown", outside, true);
}

function outside(e: MouseEvent): void {
    if (openMenu && !openMenu.contains(e.target as Node)) closeMenu();
}

/** Menu pod prvkem (nebo na souradnicich). Polozka "-" = oddelovac, {title} = nadpis skupiny. */
export function showMenu(anchor: HTMLElement | DOMRect, items: Array<MenuItem | "-" | { title: string }>, host: HTMLElement = document.body): HTMLElement {
    const menu = h("div", { class: "ce-menu", role: "menu" });
    for (const it of items) {
        if (it === "-") { menu.appendChild(h("div", { class: "ce-menu-sep" })); continue; }
        if ("title" in it) { menu.appendChild(h("div", { class: "ce-menu-title", text: it.title })); continue; }
        menu.appendChild(h("button", {
            type: "button", role: "menuitem",
            class: ["ce-menu-item", it.active && "is-active", it.danger && "is-danger"],
            disabled: !!it.disabled,
            title: it.hint && it.hint.length > 24 ? it.hint : null,
            onMousedown: (e: MouseEvent) => e.preventDefault(),
            onClick: () => { closeMenu(); it.onClick(); },
        }, it.icon ? icon(it.icon, 16) : h("span", { class: "ce-icon" }), h("span", { class: "ce-menu-label", text: it.label }), it.hint ? h("span", { class: "ce-menu-hint", text: it.hint }) : null));
    }
    menu.addEventListener("keydown", (e) => {
        const list = Array.from(menu.querySelectorAll<HTMLButtonElement>(".ce-menu-item:not(:disabled)"));
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
        if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    });
    return showPopover(anchor, menu, host);
}

/** Libovolny obsah v plovoucim okenku pod prvkem (zavre ho klik mimo nebo Escape). */
export function showPopover(anchor: HTMLElement | DOMRect, el: HTMLElement, host: HTMLElement = document.body): HTMLElement {
    closeMenu();
    // tema editoru (ce-theme-*) prenest i na okenko mimo editor
    const root = anchor instanceof HTMLElement ? anchor.closest(".ce-root") : null;
    if (root?.classList.contains("ce-theme-light")) el.classList.add("ce-theme-light");
    if (root?.classList.contains("ce-theme-dark")) el.classList.add("ce-theme-dark");
    host.appendChild(el);
    const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
    const mr = el.getBoundingClientRect();
    el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - mr.width - 8)) + "px";
    const below = r.bottom + 4;
    el.style.top = (below + mr.height > window.innerHeight - 8 ? Math.max(8, r.top - mr.height - 4) : below) + "px";
    openMenu = el;
    el.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.preventDefault(); closeMenu(); }
    });
    setTimeout(() => document.addEventListener("mousedown", outside, true));
    return el;
}

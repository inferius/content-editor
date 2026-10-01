/**
 * Samostatny editor HTML / kodu (bez editoru obsahu).
 *
 * Pouziva stejny CodeMirror jako zdrojovy rezim editoru - obarveni, napovedu
 * tagu, hledani a formatovani - jen bez ProseMirroru. Hostitel ho pusti na
 * <textarea>: ta zustane v DOM (skryta) a drzi hodnotu, takze formular,
 * validace i sledovani zmen funguji dal.
 *
 * Styly: dist/content-editor.css (tridy .ce-root / .ce-source / .ce-src).
 *
 *   CodeEditor.replace(document.getElementById("x"), { minHeight: 180 });
 */
import { SourceEditor } from "./editor/source";
import { h } from "./ui/dom";

export interface CodeEditorOptions {
    /** Minimalni vyska editoru v px (vychozi 180). */
    minHeight?: number;
    /** Lista s formatovanim a napovedou kláves (vychozi true). */
    toolbar?: boolean;
    /** Nabidnout formatovani HTML (vychozi true). Vypnout tam, kde se obsah vklada
     *  do stranky tak, jak je - formatovani jde pres parser prohlizece a prepsalo by entity. */
    format?: boolean;
    /** Cisla radku a sbalovani (vychozi true). */
    gutters?: boolean;
    /** Pocatecni vyska v px (napr. drive ulozena). Bez ni plati minHeight. */
    height?: number;
    /** Uzivatel pretahl vysku - hostitel si ji ulozi (uz po ustaleni, v px). */
    onResize?: (height: number) => void;
    /** Zmena textu. */
    onChange?: (value: string) => void;
    /** Ctrl+S (napr. ulozeni formulare). */
    onSave?: () => void;
}

export interface CodeEditorHandle {
    /** Obsah editoru (zapis prepise i textareu). */
    value: string;
    focus(): void;
    /** Vrati textareu zpet do puvodniho stavu. */
    destroy(): void;
    readonly textarea: HTMLTextAreaElement;
}

export function replace(textarea: HTMLTextAreaElement, options: CodeEditorOptions = {}): CodeEditorHandle {
    const host = h("div", { class: "ce-root ce-source ce-code-standalone" });
    if (options.minHeight) host.style.setProperty("--ce-code-min", options.minHeight + "px");
    textarea.insertAdjacentElement("afterend", host);
    const display = textarea.style.display;
    textarea.style.display = "none";

    // zmena v editoru -> textarea + "input", aby na ni stranka reagovala jako driv
    const sync = (value: string) => {
        if (textarea.value === value) return;
        textarea.value = value;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        options.onChange?.(value);
    };

    const src = new SourceEditor(host, textarea.value, {
        gutters: options.gutters !== false,
        toolbar: options.toolbar !== false,
        format: options.format !== false,
        minHeight: options.minHeight ?? 180,
        onChange: sync,
        onSave: options.onSave,
    });

    const stopSizeWatch = watchHeight(host, options);

    return {
        get value(): string { return src.value; },
        set value(v: string) { src.setValue(v); sync(v); },
        focus: () => src.focus(),
        destroy() {
            stopSizeWatch();
            src.destroy();
            host.remove();
            textarea.style.display = display;
        },
        textarea,
    };
}

/**
 * Pocatecni vyska a hlaseni pretazeni. Vysku si uklada hostitel (u administrace
 * k uctu), editor ji jen nastavi a po ustaleni ohlasi novou hodnotu.
 */
function watchHeight(host: HTMLElement, options: CodeEditorOptions): () => void {
    if (options.height && options.height > 0) {
        host.style.height = Math.min(options.height, Math.round(window.innerHeight * 0.9)) + "px";
    }

    const report = options.onResize;
    if (!report || typeof ResizeObserver === "undefined") return () => { /* nic k uklizeni */ };

    let last = Math.round(host.offsetHeight);
    let timer = 0;
    const obs = new ResizeObserver(() => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
            const now = Math.round(host.offsetHeight);
            // hlasit jen skutecne pretazeni, ne prepocet rozlozeni o par pixelu
            if (Math.abs(now - last) < 8) return;
            last = now;
            report(now);
        }, 400);
    });
    obs.observe(host);

    return () => {
        window.clearTimeout(timer);
        obs.disconnect();
    };
}

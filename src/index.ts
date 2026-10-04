/**
 * Verejne API (window.ContentEditor po nacteni dist/content-editor.js):
 *
 *   ContentEditor.create(element, html, options)  -> ContentEditor
 *   ContentEditor.replace(textarea, options)       -> fasada kompatibilni s CKEditorem 4
 *                                                     (getData, setData, on("change"), destroy, ...)
 *   ContentEditor.sourceEditor(element, html, opts) -> HTML editor (CodeMirror) bez vizualniho rezimu
 *   ContentEditor.previewDocument(html, web, opts)  -> HTML dokument pro iframe nahledu ve stylech webu
 */
import { ContentEditor, type ContentEditorOptions } from "./editor/editor";
import { SourceEditor, type SourceOptions } from "./editor/source";
import { frameDocument, type WebLook } from "./editor/web";

export { ContentEditor, SourceEditor };
export type { ContentEditorOptions, SourceOptions };
export { parseHTML, serializeHTML } from "./core/html";
export { configureMarkup, type MarkupOptions } from "./core/schema";
export { PRESETS, ALL_FEATURES, type Feature } from "./editor/features";
export type { VariableDef, VariableParam, VariableOption, RenderVariables } from "./editor/variables";
export type { WebLook } from "./editor/web";
export { sanitizePreview } from "./editor/web";

/** HTML editor (napr. sablona kodu do textu). Ctrl+Mezera napoveda, Ctrl+F hledani. */
export function sourceEditor(element: HTMLElement, html: string, opts: SourceOptions = {}): SourceEditor {
    // samostatne pouziti (mimo editor obsahu): barvy, kurzor a vyber berou promenne z .ce-root
    // (bez nich byl kurzor i oznaceni neviditelne a obarveni jen ve svetlem tematu)
    if (!element.closest(".ce-root")) element.classList.add("ce-root", "ce-source");
    return new SourceEditor(element, html, opts);
}

/** Dokument pro iframe (bez sandboxu - obsah se cisti od skriptu a obsluh udalosti). */
export function previewDocument(html: string, web: WebLook | null, opts: { padding?: string; scroll?: boolean; width?: number } = {}): string {
    return frameDocument(html, web, opts);
}

export const version = "0.1.0";

export function create(element: HTMLElement, html: string, options: ContentEditorOptions = {}): ContentEditor {
    return new ContentEditor(element, html, options);
}

/** Cast rozhrani CKEDITOR.editor, kterou pouziva administrace. */
export interface CKEditorLike {
    readonly name: string;
    readonly element: HTMLTextAreaElement;
    readonly editor: ContentEditor;
    getData(): string;
    setData(html: string, callback?: (() => void) | { callback?: () => void }): void;
    on(event: "change" | "focus" | "blur" | "instanceReady", fn: () => void): void;
    checkDirty(): boolean;
    resetDirty(): void;
    updateElement(): void;
    focus(): void;
    destroy(noUpdate?: boolean): void;
    isDestroyed(): boolean;
}

/**
 * Nahradi textarea editorem (jako CKEDITOR.replace). Hodnota textarey se
 * prubezne aktualizuje, takze funguje i obycejne odeslani formulare.
 */
export function replace(textarea: HTMLTextAreaElement, options: ContentEditorOptions = {}): CKEditorLike {
    const host = document.createElement("div");
    host.className = "ce-host";
    textarea.insertAdjacentElement("afterend", host);
    textarea.style.display = "none";
    const editor = new ContentEditor(host, textarea.value, { storageKey: textarea.name || textarea.id || undefined, ...options });

    const sync = () => { textarea.value = editor.getHTML(); };
    editor.on("change", sync);

    const facade: CKEditorLike = {
        name: textarea.name || textarea.id,
        element: textarea,
        editor,
        getData: () => editor.getHTML(),
        setData(html, callback) {
            editor.setHTML(html || "");
            textarea.value = editor.getHTML();
            const cb = typeof callback === "function" ? callback : callback?.callback;
            if (cb) cb();
        },
        on(event, fn) {
            if (event === "instanceReady") setTimeout(fn);
            else editor.on(event, fn);
        },
        checkDirty: () => editor.isDirty(),
        resetDirty: () => editor.resetDirty(),
        updateElement: sync,
        focus: () => editor.focus(),
        destroy(noUpdate) {
            if (!noUpdate) sync();
            editor.destroy();
            host.remove();
            textarea.style.display = "";
        },
        isDestroyed: () => editor.isDestroyed(),
    };
    return facade;
}

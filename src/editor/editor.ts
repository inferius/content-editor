/**
 * ContentEditor - blokovy editor obsahu nad ProseMirror.
 *
 *   const ed = new ContentEditor(hostElement, "<p>Ahoj</p>", { pickImage, uploadImage });
 *   ed.getHTML(); ed.setHTML(html); ed.on("change", fn); ed.destroy();
 */
import { configureMarkup, type MarkupOptions } from "../core/schema";
import { EditorState, NodeSelection, Selection, type Command, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { schema } from "../core/schema";
import { parseHTML, serializeHTML, serializeParts, pasteParser, tokenizeSlice } from "../core/html";
import { cleanOfficeHTML, extractRtfImages, type OfficeSource, type PastedImage } from "../core/office";
import { varText } from "../core/vartext";
import { buildPlugins } from "./setup";
import { nodeViews } from "./nodeviews";
import { BlockHandle } from "./handle";
import { SourceEditor } from "./source";
import { Features, type FeatureOptions } from "./features";
import { VariableView, VariableRenderer, variableDialog, variableMenu, paramsOf, type VariableDef, type RenderVariables, type VariableMode, type VariableContext } from "./variables";
import { variableSuggest } from "./varsuggest";
import { WEB_SCOPE, loadScopedCss, adoptSheet, frameDocument, type WebLook } from "./web";
import { LinkPopover, linkHighlight } from "../ui/linkpop";
import { TableTools, tableAt, targetCells } from "../ui/tabletools";
import { tablePropsDialog, cellPropsDialog, borderCss, parseBorder, type BorderKind } from "../ui/tableprops";
import { Toolbar, Bubble, DEFAULT_COLORS, type ToolbarActions, type ColorDef } from "../ui/toolbar";
import { h, closeMenu, showMenu, modal, textButton, type MenuItem } from "../ui/dom";
import { icon } from "../ui/icons";
import * as dlg from "../ui/dialogs";
import * as cmd from "./commands";

export interface ContentEditorOptions extends FeatureOptions {
    /** Zastupny text prazdneho editoru. */
    placeholder?: string;
    /** Vyber obrazku (napr. MediaLibrary.pick). Bez nej jen zadani adresy. */
    pickImage?: dlg.PickImage | null;
    /** Nahrani obrazku ze schranky / pretazeni. Bez nej se soubory ignoruji. */
    uploadImage?: ((file: File, o?: { folder?: string }) => Promise<{ src: string; alt?: string; reused?: boolean }>) | null;
    /** Stazeni obrazku z cizi adresy do knihovny (obrazky vlozene z Google Docs / Wordu online). */
    importImage?: ((url: string, o?: { folder?: string; name?: string }) => Promise<{ src: string; reused?: boolean }>) | null;
    /** Slozka knihovny pro obrazky vlozene z dokumentu (Word, Google Docs). Bez ni koren hostitele. */
    documentImagesFolder?: string;
    /** Kam se obrazky ukladaji - 2. pad do stavoveho radku ("Ukládám obrázky do ..."). Vychozi "Souborů a obrázků". */
    imageLibraryName?: string;
    /** Minimalni vyska obsahu v px. */
    minHeight?: number;
    /** Klic pro zapamatovani vysky editoru v prohlizeci (napr. nazev pole). Bez nej se nepamatuje. */
    storageKey?: string;
    /** Promenne, ktere web v textu nahrazuje ({$nazev}). */
    variables?: VariableDef[];
    /** Nahled promennych jak na webu (HTML od serveru). */
    renderVariables?: RenderVariables | null;
    /** Cely obsah jak ho zobrazi web (promenne nahrazene serverem). Bez nej se pouzije renderVariables. */
    renderPreview?: ((html: string) => Promise<string>) | null;
    /**
     * Cela stranka webu s neulozenym obsahem: adresa pro iframe nahledu (stranka i se skripty webu - galerie,
     * slidery, hlavicka). null = stranka nejde (novy zaznam bez adresy) - nahled jen obsahu (renderPreview).
     */
    previewPage?: ((html: string) => Promise<string | null>) | null;
    /** Styly a obaly webu - vzhled webu v editoru a nahled. */
    web?: WebLook | null;
    /** Paleta barev textu. */
    colors?: ColorDef[];
    /** Odkaz na spravu promennych (Kody do textu) - polozka v nabidkach promennych. */
    manageVariablesUrl?: string | null;
    /** Markup podle webu (napr. obal videa) - plati pro vsechny editory na strance, viz configureMarkup. */
    markup?: MarkupOptions | null;
}

type EventName = "change" | "focus" | "blur";
type ThemeMode = "auto" | "light" | "dark";

const THEME_KEY = "content-editor:theme";
const SEP = String.fromCharCode(10, 10);
const WEB_KEY = "content-editor:web";
const VARS_KEY = "content-editor:vars";

export class ContentEditor {
    readonly root: HTMLElement;
    readonly view: EditorView;
    readonly features: Features;
    private body: HTMLElement;
    private frame: HTMLElement;
    private wrapperEls: HTMLElement[] = [];
    private toolbar: Toolbar;
    private bubble: Bubble;
    private linkPop: LinkPopover | null = null;
    private tableTools: TableTools | null = null;
    /** Klic pevne vysky v localStorage (opts.storageKey), viz buildResize. */
    private heightKey: string | null = null;
    private onScroll: () => void = () => undefined;
    private onWindowScroll: () => void = () => undefined;
    private bodyObserver: ResizeObserver | null = null;
    private handle: BlockHandle;
    private status: HTMLElement;
    /** Docasna zprava ve stavovem radku (napr. po vycisteni vlozeneho textu). */
    private statusNote: { text: string; until: number } | null = null;
    /** Docasne adresy obrazku, ktere se prave nahravaji (viz storePastedImages). */
    private pendingImages = new Set<string>();
    /** RTF verze posledniho vlozeni (obrazky Wordu - viz extractRtfImages). */
    private pasteRtf = "";
    private source: SourceEditor | null = null;
    private sourceHost: HTMLElement;
    private listeners: Record<EventName, Array<() => void>> = { change: [], focus: [], blur: [] };
    private savedDoc: PMNode;
    private destroyed = false;
    private theme: ThemeMode = "auto";
    private webOn = false;
    private varMode: VariableMode = "chip";
    private varCtx: VariableContext;
    private defs: Map<string, VariableDef>;

    constructor(host: HTMLElement, html: string, private opts: ContentEditorOptions = {}) {
        if (opts.markup) configureMarkup(opts.markup);
        this.features = new Features(opts);
        this.defs = new Map((opts.variables || []).map((d) => [d.name, d]));
        this.varCtx = {
            defs: this.defs,
            mode: () => this.varMode,
            renderer: opts.renderVariables ? new VariableRenderer(opts.renderVariables) : null,
            web: opts.web || null,
            edit: (pos) => this.editBlock(pos),
        };

        this.body = h("div", { class: "ce-body" });
        this.frame = h("div", { class: "ce-frame" });
        this.sourceHost = h("div", { class: "ce-source", hidden: true });
        this.status = h("div", { class: "ce-status" });
        this.root = h("div", { class: "ce-root" });
        host.appendChild(this.root);

        // obaly obsahu jako na webu (tridy dostanou jen ve vzhledu webu)
        let parent = this.frame;
        for (let i = 0; i < (opts.web?.wrappers || []).length; i++) {
            const w = h("div");
            parent.appendChild(w);
            this.wrapperEls.push(w);
            parent = w;
        }
        const mount = h("div");
        parent.appendChild(mount);
        this.body.append(this.frame, this.sourceHost);

        const actions: ToolbarActions & { editBlock(pos: number): void; hasVariables(): boolean; unwrapColumns(pos: number): void } = {
            features: this.features,
            openLink: () => this.openLink(),
            insertImage: () => this.insertImage(),
            insertButton: () => this.insertButton(),
            insertVideo: () => this.insertVideo(),
            insertTable: (anchor?: HTMLElement) => this.insertTable(anchor),
            tableProps: () => this.tableProps(),
            insertRaw: () => this.insertRaw(),
            insertColumns: (layout: string | null, anchor?: HTMLElement) => this.insertColumns(layout, anchor),
            unwrapColumns: (pos: number) => cmd.unwrapColumns(this.view, pos),
            insertVariable: (def: VariableDef | null, anchor?: HTMLElement) => this.insertVariable(def, anchor),
            variables: () => opts.variables || [],
            manageVariablesUrl: () => opts.manageVariablesUrl || null,
            hasVariables: () => (opts.variables || []).length > 0,
            colors: () => opts.colors || DEFAULT_COLORS,
            toggleSource: () => this.toggleSource(),
            isSource: () => !!this.source,
            toggleFullscreen: () => this.root.classList.toggle("ce-fullscreen"),
            viewMenu: () => this.viewMenu(),
            viewActive: () => this.webOn || this.varMode === "preview",
            hasPreview: () => !!(opts.web || opts.renderPreview),
            openPreview: () => this.openPreview(),
            editBlock: (pos: number) => this.editBlock(pos),
        };

        const doc = parseHTML(html);
        this.savedDoc = doc;
        this.view = new EditorView({ mount }, {
            state: this.createState(doc),
            nodeViews: this.buildNodeViews(),
            clipboardParser: pasteParser,
            transformPastedHTML: (html) => this.cleanPastedHTML(html),
            transformPasted: (slice) => tokenizeSlice(slice),
            attributes: () => ({
                class: "ce-content " + (this.webOn ? (opts.web?.contentClass || "") : "ce-typo"),
                spellcheck: "true", lang: "cs", "aria-label": "Obsah",
            }),
            dispatchTransaction: (tr) => this.onTransaction(tr),
            // Alt+F10 = fokus do listy tabulky (ovladani bez mysi)
            handleKeyDown: (_view, event) => {
                if (event.altKey && event.key === "F10" && this.tableTools?.focusFirst()) {
                    event.preventDefault();
                    return true;
                }
                return false;
            },
            handleDoubleClickOn: (_view, _pos, node, nodePos) => {
                if (node.type === schema.nodes.image) {
                    this.editBlock(nodePos);
                    return true;
                }
                return false;
            },
            handlePaste: (view, event) => {
                // Word / Excel davaji do schranky i obrazek vyberu - kdyz je tam text, vklada se text
                if (event.clipboardData?.getData("text/plain").trim()) return false;
                return this.pasteFiles(view, event.clipboardData?.files, null);
            },
            handleDrop: (view, event) => {
                const files = (event as DragEvent).dataTransfer?.files;
                if (!files || !files.length) return false;
                const at = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY });
                return this.pasteFiles(view, files, at ? at.pos : null);
            },
            handleDOMEvents: {
                focus: () => { this.emit("focus"); setTimeout(() => this.updateFloating()); return false; },
                // RTF schranky si poznamenat pred zpracovanim HTML (transformPastedHTML ho nedostane)
                paste: (_view, event) => {
                    this.pasteRtf = (event as ClipboardEvent).clipboardData?.getData("text/rtf") || "";
                    // jen pro toto vlozeni (jinak by ho pouzilo az pristi pretazeni HTML)
                    setTimeout(() => { this.pasteRtf = ""; });
                    return false;
                },
                blur: (_view, event) => {
                    // fokus presel do plovouci listy / nabidky (klavesnice) - nechat ji videt
                    const to = (event as FocusEvent).relatedTarget as HTMLElement | null;
                    const floating = !!to?.closest?.(".ce-bubble, .ce-menu, .ce-table-handle");
                    if (!floating) { this.bubble.hide(); this.linkPop?.hide(); this.tableTools?.hide(); }
                    this.emit("blur");
                    return false;
                },
            },
        });

        this.toolbar = new Toolbar(this.view, actions);
        this.bubble = new Bubble(this.view, actions, this.body);
        this.linkPop = new LinkPopover(this.view, { edit: () => void this.openLink(), remove: () => this.run(cmd.removeLink) }, this.body);
        if (this.features.has("table")) {
            this.tableTools = new TableTools(this.view, {
                tableProps: () => void this.tableProps(),
                cellProps: () => void this.cellProps(),
                stickyBottom: () => this.toolbar.dom.getBoundingClientRect().bottom,
            }, this.body);
        }
        this.handle = new BlockHandle(this.view, this.body, actions);

        if (opts.minHeight) this.view.dom.style.minHeight = opts.minHeight + "px";
        const resize = this.buildResize();
        // bublina a panel odkazu jsou uvnitr posuvne casti (posouvaji se s textem); pri posunu
        // a zmene sirky jen prepocitat, jestli se vejdou nad / pod text
        this.onScroll = () => this.updateFloating();
        this.body.addEventListener("scroll", this.onScroll, { passive: true });
        window.addEventListener("resize", this.onScroll, { passive: true });
        // lista tabulky se lepi k horni hrane viditelne casti - zavisi i na posunu stranky
        this.onWindowScroll = () => { if (this.tableTools && !this.tableTools.dom.hidden) this.updateFloating(); };
        window.addEventListener("scroll", this.onWindowScroll, { passive: true });
        // zmena vysky (tazeni, cela obrazovka) posune obsah pod plovoucimi panely
        this.bodyObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this.updateFloating()) : null;
        this.bodyObserver?.observe(this.body);
        this.applyTheme(readStore(THEME_KEY) as ThemeMode || "auto");
        this.root.append(this.toolbar.dom, this.body, resize, this.status);

        const storedVars = readStore(VARS_KEY);
        if (storedVars === "preview" && this.varCtx.renderer) this.setVarMode("preview");
        const storedWeb = readStore(WEB_KEY);
        if (opts.web && (storedWeb === "on" || (storedWeb === null && opts.web.enabled))) void this.setWebMode(true, false);
        this.refreshUi();
    }

    // ------------------------------------------------------------------ verejne API

    getHTML(): string {
        // i ze zdrojoveho rezimu vzdy pres schema - vystup ma stejny tvar a jen povolene prvky
        if (this.source) return serializeHTML(parseHTML(this.source.value));
        return serializeHTML(this.withoutPendingImages(this.view.state.doc));
    }

    /** Nahravaji se jeste obrazky vlozene z dokumentu? (ukladani je zatim vynecha) */
    isBusy(): boolean {
        return this.pendingImages.size > 0;
    }

    /**
     * Dokument bez obrazku, ktere se jeste nahravaji: do ulozeneho obsahu se nesmi dostat data: URL
     * (MB base64) ani docasna adresa Googlu. Po nahrani se dokument zmeni -> "Neulozene zmeny".
     */
    private withoutPendingImages(doc: PMNode): PMNode {
        if (!this.pendingImages.size) return doc;
        const tr = EditorState.create({ doc }).tr;
        const del: Array<[number, number]> = [];
        doc.descendants((node, pos) => {
            if (node.type === schema.nodes.image && this.pendingImages.has(node.attrs.src)) del.push([pos, pos + node.nodeSize]);
        });
        for (const [a, b] of del.reverse()) tr.delete(a, b);
        return tr.doc;
    }

    /** Nahradi obsah (napr. prepnuti jazyka). Historie a stav "zmeneno" se vynuluji. */
    setHTML(html: string): void {
        if (this.source) this.closeSource(false);
        const doc = parseHTML(html);
        this.savedDoc = doc;
        this.view.updateState(this.createState(doc));
        this.refreshUi();
    }

    isDirty(): boolean {
        return !!this.source || !this.view.state.doc.eq(this.savedDoc);
    }

    resetDirty(): void {
        this.savedDoc = this.view.state.doc;
    }

    focus(): void {
        if (this.source) this.source.focus();
        else this.view.focus();
    }

    on(event: EventName, fn: () => void): void {
        this.listeners[event].push(fn);
    }

    isDestroyed(): boolean {
        return this.destroyed;
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        closeMenu();
        this.source?.destroy();
        this.handle.destroy();
        window.removeEventListener("resize", this.onScroll);
        window.removeEventListener("scroll", this.onWindowScroll);
        this.bodyObserver?.disconnect();
        this.bubble.destroy();
        this.linkPop?.destroy();
        this.tableTools?.destroy();
        this.view.destroy();
        this.root.remove();
    }

    // ------------------------------------------------------------------ interni

    private createState(doc: PMNode): EditorState {
        return EditorState.create({
            doc,
            plugins: [
                // napoveda promennych po napsani "{$" - pred klavesovymi zkratkami (Enter, Tab)
                variableSuggest({
                    defs: () => (this.features.has("variables") ? this.opts.variables || [] : []),
                    pick: (def, from, to) => void this.pickSuggested(def, from, to),
                    manageUrl: this.opts.manageVariablesUrl,
                }),
                ...buildPlugins({ openLink: () => this.openLink() }, this.opts.placeholder ?? "Začněte psát...", this.features),
                linkHighlight(),
            ],
        });
    }

    private buildNodeViews() {
        return {
            ...nodeViews((pos) => this.editBlock(pos)),
            variable: (node: PMNode, view: EditorView, getPos: () => number | undefined) => new VariableView(node, view, getPos, this.varCtx),
        };
    }

    private onTransaction(tr: Transaction): void {
        const state = this.view.state.apply(tr);
        this.view.updateState(state);
        this.refreshUi();
        if (tr.docChanged) this.emit("change");
    }

    /** Bublina formatovani a panel odkazu (poloha uvnitr posuvne casti editoru). */
    private updateFloating(): void {
        if (this.bubble.dom.hidden && (!this.linkPop || this.linkPop.dom.hidden) && !this.view.hasFocus()) return;
        this.bubble.update(this.view);
        this.linkPop?.update(this.view, !!this.source);
        this.tableTools?.update(this.view, !!this.source);
    }

    private refreshUi(): void {
        this.toolbar.update(this.view.state);
        this.updateFloating();
        const text = this.view.state.doc.textContent.trim();
        const words = text ? text.split(/\s+/).length : 0;
        // pole s promennymi: napoveda primo u nej (ne nad strankou - nebylo jasne, ke kteremu poli patri)
        const vars = this.features.has("variables") && (this.opts.variables || []).some((d) => d.offer !== false);
        if (this.statusNote && this.statusNote.until > Date.now()) {
            this.status.textContent = this.statusNote.text;
            this.status.classList.add("is-note");
            return;
        }
        this.statusNote = null;
        this.status.classList.remove("is-note");
        this.status.textContent = `${words} ${words === 1 ? "slovo" : words >= 2 && words <= 4 ? "slova" : "slov"}  |  `
            + (vars ? "{$ = proměnné webu (" + this.variableExamples() + "), " : "")
            + "Enter nový odstavec, Shift+Enter nový řádek, ## nadpis, - odrážky";
    }

    /** Priklady promennych pro napovedu ve stavovem radku (prvni dve nabizene). */
    private variableExamples(): string {
        const labels = (this.opts.variables || []).filter((d) => d.offer !== false).map((d) => d.label.toLowerCase());
        return labels.slice(0, 2).join(", ") + (labels.length > 2 ? "..." : "");
    }

    /** Kratka zprava ve stavovem radku, pak zpet napoveda. */
    private flashStatus(text: string, ms = 7000): void {
        this.statusNote = { text, until: Date.now() + ms };
        this.refreshUi();
        setTimeout(() => { if (!this.destroyed) this.refreshUi(); }, ms + 50);
    }

    /** HTML ze schranky: obsah z Wordu / Excelu / Google Docs vycistit (ostatni beze zmeny). */
    private cleanPastedHTML(html: string): string {
        const images = this.features.has("image");
        const rtf = this.pasteRtf;
        this.pasteRtf = "";
        let res: ReturnType<typeof cleanOfficeHTML>;
        try {
            res = cleanOfficeHTML(html, {
                palette: this.features.has("color") ? (this.opts.colors || DEFAULT_COLORS).map((c) => c.value) : [],
                headings: this.features.has("headings") ? this.features.headings.filter((l) => this.features.heading(l)) : [],
                localImages: images && this.opts.uploadImage && /src=["']?file:/i.test(html) ? extractRtfImages(rtf) : undefined,
                remoteImages: images && !!this.opts.importImage,
                keepImages: images && !!this.opts.uploadImage,
            });
        }
        catch (e) {
            // cistic nesmi shodit vlozeni - pasteParser vstup stejne omezi na povolene prvky
            console.error("content-editor: cisteni vlozeneho HTML selhalo", e);
            return html;
        }
        if (!res) return html;
        const names: Record<OfficeSource, string> = {
            "word": "z Wordu", "word-online": "z Wordu", "excel": "z Excelu", "gdocs": "z Google Docs", "gsheets": "z Google Sheets",
        };
        const sheet = res.source === "excel" || res.source === "gsheets";
        let note = `Vloženo ${names[res.source]} - formátování vyčištěno (zachováno: `
            + (sheet ? "tabulka, tučné, barvy z palety" : "nadpisy, tučné, seznamy, odkazy, tabulky, barvy z palety") + ")";
        if (res.unmatchedLocal) note += ". Obrázky se nepodařilo přenést (Word je předal neúplně) - vložte je přes tlačítko Obrázek.";
        else if (res.droppedImages) note += `. Obrázky (${res.droppedImages}) vynechány - vložte je přes tlačítko Obrázek.`;
        // az po vlozeni (transakce paste prekresli stavovy radek)
        const found = res;
        setTimeout(() => {
            if (found.images.length) void this.storePastedImages(found.images, found.source, note);
            else this.flashStatus(note);
        });
        return res.html;
    }

    /**
     * Obrazky vlozene z dokumentu: data z Wordu nahrat, cizi adresy (Google Docs) stahnout do
     * knihovny a v textu nahradit docasnou adresu trvalou. Co se nepovede, z textu zmizi
     * (data: URL ani docasnou adresu Googlu do obsahu neukladat).
     */
    private async storePastedImages(all: PastedImage[], source: OfficeSource, note: string): Promise<void> {
        const folder = this.opts.documentImagesFolder;
        const prefix = source === "gdocs" || source === "gsheets" ? "google-docs" : source === "excel" ? "excel" : "word";
        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        // stejna adresa vicekrat = jeden soubor
        const images = all.filter((img, i) => all.findIndex((x) => x.src === img.src) === i);
        images.forEach((img) => this.pendingImages.add(img.src));
        let failed = 0;
        let reused = 0;
        let done = 0;
        this.status.classList.add("is-busy");
        const progress = () => {
            // prubeh drzet i pri psani (refreshUi by ho jinak prepsal napovedou)
            this.statusNote = { text: `Ukládám obrázky do ${this.opts.imageLibraryName || "Souborů a obrázků"} (${done}/${images.length}) - do uložení textu se dostanou až po dokončení...`, until: Date.now() + 120000 };
            if (!this.destroyed) this.refreshUi();
        };
        progress();
        const one = async (img: PastedImage, i: number) => {
            try {
                // obrazek mezitim z textu zmizel (smazani, zpet) - nenahravat
                if (!this.hasImageSrc(img.src)) return;
                const name = `${prefix}-${stamp}-${i + 1}`;
                let stored: { src: string; reused?: boolean };
                if (img.kind === "data") {
                    if (!this.opts.uploadImage) throw new Error("nahrávání není zapnuté");
                    stored = await this.opts.uploadImage(dataUrlToFile(img.src, name), { folder });
                }
                else {
                    if (!this.opts.importImage) throw new Error("stahování není zapnuté");
                    stored = await this.opts.importImage(img.src, { folder, name });
                }
                if (this.destroyed) return;
                if (stored.reused) reused++;
                this.replaceImageSrc(img.src, stored.src);
            }
            catch (e) {
                console.warn("content-editor: obrázek se nepodařilo uložit", e);
                failed++;
                if (!this.destroyed) this.replaceImageSrc(img.src, null);
            }
            finally {
                this.pendingImages.delete(img.src);
                done++;
                progress();
            }
        };
        // po trech soucasne (server obrazek zmensuje, Google stahuje)
        let next = 0;
        const worker = async () => { while (next < images.length) { const i = next++; await one(images[i], i); } };
        await Promise.all([worker(), worker(), worker()]);
        if (this.destroyed) return;
        this.status.classList.remove("is-busy");
        const ok = images.length - failed;
        let text = note + (ok ? `. Obrázky (${ok}) uloženy${folder ? " do " + folder : ""}` : "");
        if (reused) text += ` (${reused === ok ? "všechny" : reused} už v knihovně byly - použity existující soubory)`;
        if (failed) text += `. ${failed === images.length ? "Obrázky" : "Některé obrázky (" + failed + ")"} se nepodařilo uložit - vložte je přes tlačítko Obrázek.`;
        this.flashStatus(text, failed ? 12000 : 8000);
    }

    private hasImageSrc(src: string): boolean {
        let found = false;
        this.view.state.doc.descendants((node) => {
            if (found) return false;
            if (node.type === schema.nodes.image && node.attrs.src === src) found = true;
            return !found;
        });
        return found;
    }

    /** Vsechny obrazky s adresou from -> adresa to (null = obrazek odebrat). Mimo historii zpet. */
    private replaceImageSrc(from: string, to: string | null): void {
        if (this.destroyed || this.view.isDestroyed) return;
        const tr = this.view.state.tr;
        const found: Array<{ pos: number; size: number; attrs: Record<string, unknown> }> = [];
        tr.doc.descendants((node, pos) => {
            if (node.type === schema.nodes.image && node.attrs.src === from) found.push({ pos, size: node.nodeSize, attrs: node.attrs });
        });
        if (!found.length) return;
        // od konce - smazani nemeni pozice predchozich
        for (const f of found.reverse()) {
            if (to === null) tr.delete(f.pos, f.pos + f.size);
            else tr.setNodeMarkup(f.pos, null, { ...f.attrs, src: to });
        }
        tr.setMeta("addToHistory", false);
        this.view.dispatch(tr);
    }

    private emit(event: EventName): void {
        for (const fn of this.listeners[event]) {
            try {
                fn();
            } catch (e) {
                console.error(e);
            }
        }
    }

    private run(command: Command): void {
        command(this.view.state, this.view.dispatch, this.view);
        this.view.focus();
    }

    // ------------------------------------------------------------------ akce

    async openLink(): Promise<void> {
        const state = this.view.state;
        const link = cmd.linkAt(state);
        const needText = state.selection.empty && !link;
        const res = await dlg.linkDialog(link ? { href: link.mark.attrs.href, target: link.mark.attrs.target } : null, needText, this.root);
        this.view.focus();
        if (res === "remove") this.run(cmd.removeLink);
        else if (res) this.run(cmd.setLink({ href: res.href, target: res.target }, res.text));
    }

    async insertImage(): Promise<void> {
        const sel = this.view.state.selection;
        if (sel instanceof NodeSelection && sel.node.type === schema.nodes.image) return this.editBlock(sel.from);
        const attrs = await dlg.imageDialog(null, this.opts.pickImage ?? null, this.root);
        this.view.focus();
        if (attrs) this.run(cmd.insertInline(schema.nodes.image.create(attrs)));
    }

    async insertButton(): Promise<void> {
        const attrs = await dlg.buttonDialog(null, this.root);
        this.view.focus();
        if (attrs) this.run(cmd.insertBlock(schema.nodes.button.create(attrs)));
    }

    async insertVideo(): Promise<void> {
        const attrs = await dlg.videoDialog(null, this.root);
        this.view.focus();
        if (attrs) this.run(cmd.insertBlock(schema.nodes.video.create(attrs)));
    }

    /** anchor = rychla nabidka s mrizkou u prvku (klik = vlozit, Upresnit = dialog). */
    async insertTable(anchor?: HTMLElement): Promise<void> {
        if (anchor) {
            dlg.tablePicker(anchor, (rows, cols) => {
                this.view.focus();
                this.run(cmd.insertBlock(cmd.createTable({ rows, cols })));
            }, () => void this.insertTable());
            return;
        }
        const res = await dlg.tableDialog(null, this.root);
        this.view.focus();
        if (res) this.run(cmd.insertBlock(cmd.createTable({ ...res, border: res.border !== "0" })));
    }

    /** Vlastnosti tabulky kolem kurzoru. */
    /**
     * Vlastnosti tabulky (sirka, zarovnani, ohraniceni vsech bunek, tridy).
     * pos = tabulka z nabidky bloku, jinak ta s kurzorem.
     */
    async tableProps(pos?: number): Promise<void> {
        const state = this.view.state;
        const t = pos !== undefined ? { pos, node: state.doc.nodeAt(pos)! } : tableAt(state);
        if (!t || !t.node || t.node.type !== schema.nodes.table) return;
        const cells = this.tableCells(t.pos, t.node);
        const first = parseBorder((cells[0]?.node.attrs.border as string | null) ?? null);
        const kind: BorderKind = t.node.attrs.border === "0" || first.kind === "none" ? "none" : first.kind === "thick" ? "thick" : "thin";
        const initial = { width: t.node.attrs.width, align: t.node.attrs.align, border: kind, borderColor: first.color, cls: t.node.attrs.cls };
        const res = await tablePropsDialog(initial, this.opts.colors || DEFAULT_COLORS, this.root);
        this.view.focus();
        const cur = this.view.state.doc.nodeAt(t.pos);
        if (!res || !cur || cur.type !== schema.nodes.table) return;
        const tr = this.view.state.tr.setNodeMarkup(t.pos, null, {
            ...cur.attrs, width: res.width, align: res.align, cls: res.cls, border: res.border === "none" ? "0" : "1",
        });
        // ohraniceni vsech bunek jen pri jeho zmene - jinak by se prepsalo nastaveni jednotlivych bunek
        // (a stary obsah bez stylu bunek by dostal inline ohraniceni, ktere prebije CSS webu)
        if (res.border !== initial.border || (res.border !== "none" && res.borderColor !== initial.borderColor)) {
            const css = borderCss(res.border, res.borderColor);
            for (const c of this.tableCells(t.pos, cur)) tr.setNodeMarkup(c.pos, null, { ...c.node.attrs, border: css });
        }
        this.view.dispatch(tr);
    }

    /** Vlastnosti vybranych bunek (nebo bunky s kurzorem): pozadi, zarovnani, ohraniceni. */
    async cellProps(): Promise<void> {
        const cells = targetCells(this.view.state);
        if (!cells.length) return;
        const a = cells[0].node.attrs;
        const b = parseBorder((a.border as string | null) ?? null);
        const initial = { background: a.background, align: a.align, valign: a.valign, border: b.kind, borderColor: b.color };
        const res = await cellPropsDialog(initial, cells.length, this.opts.colors || DEFAULT_COLORS, this.root);
        this.view.focus();
        if (!res) return;
        const changed: Record<string, unknown> = {};
        if (res.background !== initial.background) changed.background = res.background;
        if (res.align !== initial.align) changed.align = res.align;
        if (res.valign !== initial.valign) changed.valign = res.valign;
        if (res.border !== initial.border || res.borderColor !== initial.borderColor) changed.border = borderCss(res.border, res.borderColor);
        if (!Object.keys(changed).length) return;
        const tr = this.view.state.tr;
        for (const c of cells) {
            const node = tr.doc.nodeAt(c.pos);
            if (!node || node.type.spec.tableRole === undefined) continue;
            tr.setNodeMarkup(c.pos, null, { ...node.attrs, ...changed });
        }
        this.view.dispatch(tr);
    }

    /** Bunky tabulky na pozici: [{pos, node}] (absolutni pozice). */
    private tableCells(tablePos: number, table: PMNode): Array<{ pos: number; node: PMNode }> {
        const out: Array<{ pos: number; node: PMNode }> = [];
        table.descendants((n, p) => {
            const role = n.type.spec.tableRole;
            if (role === "cell" || role === "header_cell") {
                out.push({ pos: tablePos + 1 + p, node: n });
                return false;
            }
            return true;
        });
        return out;
    }

    /**
     * Sloupce: layout = pevne rozvrzeni (vlozi hned), null + anchor = nabidka rozvrzeni u prvku,
     * null bez anchor = dialog s nastavenim (Upresnit...).
     */
    async insertColumns(layout: string | null, anchor?: HTMLElement): Promise<void> {
        if (layout) {
            this.view.focus();
            this.run(cmd.insertBlock(cmd.createColumns({ layout })));
            return;
        }
        if (anchor) {
            showMenu(anchor, [
                { title: "Vložit sloupce" },
                ...dlg.COLUMN_PRESETS.map(([key, label]): MenuItem => ({ label, icon: "columns", onClick: () => void this.insertColumns(key) })),
                "-",
                { label: "Upřesnit...", icon: "settings", hint: "vlastní šířky, mezery, mobil", onClick: () => void this.insertColumns(null) },
            ]);
            return;
        }
        const res = await dlg.columnsDialog(null, this.root);
        this.view.focus();
        if (res) this.run(cmd.insertBlock(cmd.createColumns(res)));
    }

    /** Promenna z napovedy: napsany "{$..." nahradit cipem (s parametry pres dialog). */
    private async pickSuggested(def: VariableDef, from: number, to: number): Promise<void> {
        // napsany zacatek zapisu pryc, kurzor na jeho misto
        this.view.dispatch(this.view.state.tr.delete(from, to));
        let value: { name: string; args: string | null } | null = { name: def.name, args: null };
        if (paramsOf(def).length) {
            const res = await variableDialog(def, null, this.root);
            value = res === "remove" ? null : res;
        }
        this.view.focus();
        if (!value) return;
        this.run(cmd.insertInline(schema.nodes.variable.create(value)));
    }

    async insertRaw(): Promise<void> {
        const html = await dlg.rawDialog("", this.root);
        this.view.focus();
        if (html && html.trim()) this.run(cmd.insertBlock(schema.nodes.rawhtml.create({ html: html.trim() })));
    }

    /**
     * Vlozeni promenne. def = z nabidky; null + anchor = nabidka u prvku (uchyt bloku);
     * null bez anchor = libovolna promenna (nazev rucne).
     */
    async insertVariable(def: VariableDef | null, anchor?: HTMLElement): Promise<void> {
        const list = this.opts.variables || [];
        if (!def && anchor && list.length) {
            showMenu(anchor, variableMenu(list, (d) => void this.insertVariable(d), this.opts.manageVariablesUrl));
            return;
        }
        let value: { name: string; args: string | null } | null;
        if (def && !paramsOf(def).length) value = { name: def.name, args: null };
        else {
            const res = await variableDialog(def, null, this.root);
            value = res === "remove" ? null : res;
        }
        this.view.focus();
        if (!value) return;
        this.run(cmd.insertInline(schema.nodes.variable.create(value)));
    }

    /** Nastaveni bloku na pozici (dvojklik, menu uchytu, ozubene kolo). */
    async editBlock(pos: number): Promise<void> {
        const node = this.view.state.doc.nodeAt(pos);
        if (!node) return;
        const t = node.type;
        const n = schema.nodes;
        let attrs: Record<string, unknown> | null = null;
        if (t === n.image) attrs = await dlg.imageDialog(node.attrs as dlg.ImageAttrs, this.opts.pickImage ?? null, this.root) as Record<string, unknown> | null;
        else if (t === n.button) attrs = await dlg.buttonDialog(node.attrs as dlg.ButtonAttrs, this.root) as Record<string, unknown> | null;
        else if (t === n.video) attrs = await dlg.videoDialog(node.attrs as { src: string; title: string }, this.root);
        else if (t === n.rawhtml) {
            const html = await dlg.rawDialog(node.attrs.html, this.root);
            attrs = html === null ? null : { html };
        } else if (t === n.container) {
            attrs = await dlg.attrsDialog("Kontejner", [
                { key: "cls", label: "Třída (class)", value: node.attrs.cls, hint: "Třídy CSS webu, např. flex mobile-f-column" },
                { key: "style", label: "Styl (style)", value: node.attrs.style },
            ], this.root);
        } else if (t === n.table) {
            return this.tableProps(pos);
        } else if (t === n.columns) {
            const res = await dlg.columnsDialog(node.attrs as dlg.ColumnsSettings, this.root);
            this.view.focus();
            const cur = this.view.state.doc.nodeAt(pos);
            if (res && cur && cur.type === t) cmd.updateColumns(this.view, pos, res);
            return;
        } else if (t === n.variable) {
            const res = await variableDialog(this.defs.get(node.attrs.name) || null, { name: node.attrs.name, args: node.attrs.args }, this.root);
            this.view.focus();
            const cur = this.view.state.doc.nodeAt(pos);
            if (!res || !cur || cur.type !== t) return;
            if (res === "remove") this.view.dispatch(this.view.state.tr.delete(pos, pos + cur.nodeSize));
            else {
                // vyber musi mirit do dokumentu po uprave, ne do puvodniho
                const tr = this.view.state.tr.setNodeMarkup(pos, undefined, res);
                this.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
            }
            return;
        } else return;
        this.view.focus();
        if (!attrs) return;
        const current = this.view.state.doc.nodeAt(pos);
        if (!current || current.type !== t) return;
        const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs });
        if (NodeSelection.isSelectable(current)) tr.setSelection(NodeSelection.create(tr.doc, pos));
        this.view.dispatch(tr);
    }

    /** Obrazky ze schranky / pretazene soubory -> nahrat a vlozit. */
    private pasteFiles(view: EditorView, files: FileList | null | undefined, pos: number | null): boolean {
        const images = Array.from(files || []).filter((f) => f.type.startsWith("image/"));
        if (!images.length || !this.opts.uploadImage || !this.features.has("image")) return false;
        const upload = this.opts.uploadImage;
        this.status.classList.add("is-busy");
        this.status.textContent = `Nahrávám ${images.length === 1 ? "obrázek" : images.length + " obrázky"}...`;
        (async () => {
            let at = pos;
            for (const file of images) {
                try {
                    const res = await upload(file);
                    const node = schema.nodes.image.create({ src: res.src, alt: res.alt || "", cls: "img-responsive" });
                    const tr = at !== null ? view.state.tr.insert(at, node) : view.state.tr.replaceSelectionWith(node, false);
                    view.dispatch(tr.scrollIntoView());
                    if (at !== null) at += node.nodeSize;
                } catch (e) {
                    this.status.textContent = "Obrázek se nepodařilo nahrát: " + ((e as Error).message || e);
                    this.status.classList.remove("is-busy");
                    return;
                }
            }
            this.status.classList.remove("is-busy");
            this.refreshUi();
        })();
        return true;
    }

    // ------------------------------------------------------------------ zdrojovy rezim

    /** Prepnuti vizualni / zdrojovy rezim. Stranka zustane na miste, posouva se jen telo editoru. */
    toggleSource(): void {
        // zdroj by si podrzel docasne adresy obrazku, ktere se jeste nahravaji
        if (!this.source && this.pendingImages.size) {
            this.flashStatus("Počkejte, až se nahrají vložené obrázky - pak zdrojový kód otevřete.", 5000);
            return;
        }
        const x = window.scrollX;
        const y = window.scrollY;
        if (this.source) this.closeSource(true);
        else this.openSource();
        // fokus a zmena vysky obsahu by jinak posunuly stranku
        const keep = () => { if (window.scrollY !== y || window.scrollX !== x) window.scrollTo(x, y); };
        keep();
        requestAnimationFrame(keep);
        setTimeout(keep, 60);
    }

    /** Blok na pozici do horni tretiny tela editoru (bez posunu stranky). */
    private revealInBody(pos: number): void {
        const run = () => {
            const b = this.body;
            if (b.scrollHeight <= b.clientHeight + 1) return;
            let top: number;
            try {
                top = this.view.coordsAtPos(Math.min(pos, this.view.state.doc.content.size)).top;
            } catch {
                return;
            }
            const r = b.getBoundingClientRect();
            b.scrollTop += top - r.top - r.height / 3;
        };
        run();
        setTimeout(run, 50);
    }

    private openSource(): void {
        closeMenu();
        this.handle.hide();
        this.bubble.hide();
        this.sourceHost.hidden = false;
        this.frame.hidden = true;
        this.root.classList.add("is-source");
        // kurzor na zacatek bloku, ve kterem byl kurzor v editoru
        const parts = serializeParts(this.view.state.doc);
        const index = Math.min(this.view.state.selection.$from.index(0), Math.max(0, parts.length - 1));
        let cursor = 0;
        for (let i = 0; i < index; i++) cursor += parts[i].length + 2;
        this.source = new SourceEditor(this.sourceHost, parts.join(SEP), { cursor });
        this.source.focus();
        this.source.revealCursor(this.body);
        this.refreshUi();
    }

    /** apply = prevzit zmeny ze zdroje (pres transakci - jde vratit Ctrl+Z). */
    private closeSource(apply: boolean): void {
        if (!this.source) return;
        const text = this.source.value;
        const cursor = this.source.cursor;
        this.source.destroy();
        this.source = null;
        this.sourceHost.textContent = "";
        this.sourceHost.hidden = true;
        this.frame.hidden = false;
        this.root.classList.remove("is-source");
        if (apply) {
            const doc = parseHTML(text);
            const tr = this.view.state.tr;
            if (!doc.eq(this.view.state.doc)) tr.replaceWith(0, this.view.state.doc.content.size, doc.content);
            // blok pod kurzorem ze zdroje = pocet bloku v textu pred kurzorem (posledni je rozepsany)
            const before = parseHTML(text.slice(0, cursor));
            const index = Math.max(0, Math.min(tr.doc.childCount - 1, before.childCount - (text.slice(0, cursor).trim() ? 1 : before.childCount)));
            let pos = 0;
            for (let i = 0; i < index; i++) pos += tr.doc.child(i).nodeSize;
            tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size))));
            this.view.dispatch(tr);
            try { (this.view.dom as HTMLElement).focus({ preventScroll: true }); } catch { this.view.focus(); }
            this.revealInBody(pos + 1);
        }
        this.refreshUi();
    }

    // ------------------------------------------------------------------ zobrazeni: vzhled webu, promenne, tema

    private viewMenu(): Array<MenuItem | "-" | { title: string }> {
        const check = (on: boolean) => (on ? "check" : undefined);
        const items: Array<MenuItem | "-" | { title: string }> = [{ title: "Zobrazení obsahu" }];
        if (this.opts.web) {
            items.push({ label: "Vzhled webu", icon: check(this.webOn), active: this.webOn, hint: "písmo a styly stránky", onClick: () => void this.setWebMode(!this.webOn, true) });
        }
        if (this.varCtx.renderer) {
            const on = this.varMode === "preview";
            items.push({ label: "Proměnné jako na webu", icon: check(on), active: on, hint: "místo čipů náhled", onClick: () => { this.setVarMode(on ? "chip" : "preview"); writeStore(VARS_KEY, on ? null : "preview"); } });
            if (on) items.push({ label: "Obnovit náhledy proměnných", icon: "refresh", onClick: () => { this.varCtx.renderer!.clear(); this.setVarMode("preview"); } });
        }
        // vyska: roste s obsahem do 70 % okna; tazenim za spodni okraj pevna (pamatuje si prohlizec)
        const fixed = this.fixedHeight();
        items.push({ title: "Výška editoru" });
        items.push({ label: "Podle obsahu", icon: check(!fixed), active: !fixed, hint: "max. 70 % okna", onClick: () => this.resetHeight() });
        items.push({
            label: fixed ? `Pevná - ${fixed} px` : "Pevná výška", icon: check(!!fixed), active: !!fixed, disabled: !fixed,
            hint: "táhněte za spodní okraj", onClick: () => undefined,
        });
        items.push({ title: "Téma editoru" });
        const themes: Array<[ThemeMode, string, string]> = [["auto", "Podle administrace", "contrast"], ["light", "Světlé", "sun"], ["dark", "Tmavé", "moon"]];
        for (const [mode, label, ic] of themes) {
            items.push({ label, icon: ic, active: this.theme === mode, onClick: () => { this.applyTheme(mode); writeStore(THEME_KEY, mode === "auto" ? null : mode); } });
        }
        return items;
    }

    private setVarMode(mode: VariableMode): void {
        this.varMode = mode;
        // nove nodeViews = ProseMirror prekresli vsechny promenne
        this.view.setProps({ nodeViews: this.buildNodeViews() });
        this.refreshUi();
    }

    /** Vzhled webu: styly webu omezene na obsah editoru + obaly jako na webu. */
    private async setWebMode(on: boolean, remember: boolean): Promise<void> {
        const web = this.opts.web;
        if (!web) return;
        if (remember) writeStore(WEB_KEY, on ? "on" : "off");
        if (on) {
            this.root.classList.add("is-web-loading");
            const sheet = await loadScopedCss(web);
            this.root.classList.remove("is-web-loading");
            if (!sheet) {
                this.status.textContent = "Styly webu se nepodařilo načíst - editor zůstává ve vzhledu administrace.";
                return;
            }
            adoptSheet(sheet);
        }
        this.webOn = on;
        this.frame.className = on ? ["ce-frame", "is-web", WEB_SCOPE, web.bodyClass || ""].join(" ").trim() : "ce-frame";
        this.frame.style.maxWidth = on && web.width ? web.width + "px" : "";
        (web.wrappers || []).forEach((cls, i) => { this.wrapperEls[i].className = on ? cls : ""; });
        this.root.classList.toggle("is-web", on);
        // prepocitat atributy obsahu (trida obsahu webu misto ce-typo)
        this.view.setProps({});
        this.refreshUi();
    }

    /**
     * Nahled jak na webu v okne se sirkou zarizeni. S previewPage cela stranka webu s neulozenym obsahem
     * (hlavicka, skripty webu - galerie, slidery), prepinac "Jen obsah" = obsah ve stylech webu (renderPreview).
     */
    async openPreview(): Promise<void> {
        closeMenu();
        const html = this.getHTML();
        const m = modal("Náhled jak na webu", this.root, "ce-modal-preview");
        const frame = h("iframe", { class: "ce-preview-frame", title: "Náhled obsahu" });
        const stage = h("div", { class: "ce-preview-stage" });
        const note = h("span", { class: "ce-muted" });
        const openLink = h("a", { class: "ce-btn ce-btn-text", target: "_blank", rel: "noopener", title: "Otevřít náhled stránky v nové záložce" }, icon("external", 16), h("span", { text: "Nová záložka" }));
        openLink.hidden = true;
        const sizes: Array<[string, string, number | null]> = [["monitor", "Počítač", null], ["tablet", "Tablet", 768], ["phone", "Mobil", 390]];
        const btns = sizes.map(([ic, label, w]) => {
            const b = h("button", { type: "button", class: "ce-btn ce-btn-text", title: label + (w ? ` (${w} px)` : "") }, icon(ic, 16), h("span", { text: label }));
            b.addEventListener("click", () => {
                btns.forEach((x) => x.classList.toggle("is-active", x === b));
                frame.style.width = w ? w + "px" : "100%";
                writeStore("content-editor:preview-size", String(w || ""));
            });
            return b;
        });
        const savedW = readStore("content-editor:preview-size");
        (btns[sizes.findIndex(([, , w]) => String(w || "") === (savedW || ""))] || btns[0]).click();

        // stranka webu / jen obsah (bez previewPage jen obsah)
        const pageFn = this.opts.previewPage || null;
        let seq = 0;
        let contentDoc: string | null = null;
        const loading = (text: string) => { stage.textContent = ""; stage.appendChild(h("div", { class: "ce-preview-loading", text })); };
        const show = async (page: boolean) => {
            const my = ++seq;
            modeBtns.forEach((b, i) => b.classList.toggle("is-active", (i === 0) === page));
            openLink.hidden = true;
            loading("Připravuji náhled...");
            try {
                if (page && pageFn) {
                    const url = await pageFn(html);
                    if (my !== seq) return;
                    if (url) {
                        frame.removeAttribute("srcdoc");
                        frame.src = url;
                        openLink.href = url;
                        openLink.hidden = false;
                        note.textContent = "Stránka webu s neuloženými změnami - tak, jak ji uvidí návštěvník.";
                        stage.textContent = "";
                        stage.appendChild(frame);
                        return;
                    }
                    note.textContent = "Stránku webu zatím nejde zobrazit (záznam nemá adresu) - náhled jen obsahu.";
                }
                else note.textContent = "Obsah článku ve stylech webu, bez hlavičky, patičky a skriptů stránky. Neuložené změny jsou zahrnuté.";
                if (contentDoc === null) {
                    const rendered = await this.renderForPreview(html);
                    contentDoc = frameDocument(rendered, this.opts.web || null, { scroll: true, padding: "24px 16px", width: this.opts.web?.width });
                }
                if (my !== seq) return;
                frame.removeAttribute("src");
                frame.srcdoc = contentDoc;
                stage.textContent = "";
                stage.appendChild(frame);
            } catch (e) {
                if (my !== seq) return;
                stage.textContent = "";
                stage.appendChild(h("div", { class: "ce-error", text: "Náhled se nepodařilo připravit: " + ((e as Error)?.message || e) }));
            }
        };
        const modeBtns = pageFn ? [
            h("button", { type: "button", class: "ce-btn ce-btn-text", title: "Celá stránka webu i se skripty (galerie, slidery)", onClick: () => { writeStore("content-editor:preview-mode", null); void show(true); } }, icon("web", 16), h("span", { text: "Stránka" })),
            h("button", { type: "button", class: "ce-btn ce-btn-text", title: "Jen obsah pole ve stylech webu", onClick: () => { writeStore("content-editor:preview-mode", "content"); void show(false); } }, icon("paragraph", 16), h("span", { text: "Jen obsah" })),
        ] : [];

        m.body.append(h("div", { class: "ce-preview-bar" }, ...btns,
            modeBtns.length ? h("span", { class: "ce-preview-sep" }) : null, ...modeBtns,
            h("span", { class: "ce-spacer" }), note, openLink), stage);
        m.footer.append(h("div", { class: "ce-spacer" }), textButton("Zavřít", "secondary", () => m.close(null)));
        await show(!!pageFn && readStore("content-editor:preview-mode") !== "content");
    }

    private async renderForPreview(html: string): Promise<string> {
        if (this.opts.renderPreview) return this.opts.renderPreview(html);
        const renderer = this.varCtx.renderer;
        if (!renderer) return html;
        // promenne nahradit po jedne (stejne jako web: nezname zmizi)
        const codes = new Set<string>();
        this.view.state.doc.descendants((node) => {
            if (node.type === schema.nodes.variable) codes.add(varText(node.attrs.name, node.attrs.args));
        });
        let out = html;
        for (const code of codes) out = out.split(code).join(await renderer.get(code));
        return out;
    }

    // ------------------------------------------------------------------ vyska a tema

    /** Tahlo pod obsahem: tazeni meni vysku, dvojklik vrati automatickou. Vyska se pamatuje. */
    /** Vyska podle obsahu (max. 70 % okna) - zrusi pevnou vysku nastavenou tazenim. */
    private resetHeight(): void {
        this.body.style.height = "";
        this.body.style.maxHeight = "";
        if (this.heightKey) writeStore(this.heightKey, null);
    }

    /** Pevna vyska v px, nebo null (roste s obsahem). */
    private fixedHeight(): number | null {
        return this.body.style.height ? parseInt(this.body.style.height, 10) || null : null;
    }

    private buildResize(): HTMLElement {
        const key = this.heightKey = this.opts.storageKey ? "content-editor:height:" + this.opts.storageKey : null;
        const saved = key ? parseInt(readStore(key) || "", 10) : NaN;
        if (saved > 0) this.setBodyHeight(saved);
        const grip = h("div", {
            class: "ce-resize", role: "separator", "aria-orientation": "horizontal",
            title: "Tažením změníte výšku editoru, dvojklikem vrátíte automatickou",
        });
        grip.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            const startY = e.clientY;
            const startH = this.body.getBoundingClientRect().height;
            try { grip.setPointerCapture(e.pointerId); } catch { /* synteticka udalost */ }
            this.root.classList.add("is-resizing");
            const move = (ev: PointerEvent) => this.setBodyHeight(startH + ev.clientY - startY);
            const up = () => {
                grip.removeEventListener("pointermove", move);
                grip.removeEventListener("pointerup", up);
                grip.removeEventListener("pointercancel", up);
                grip.removeEventListener("lostpointercapture", up);
                this.root.classList.remove("is-resizing");
                if (key) writeStore(key, String(Math.round(this.body.getBoundingClientRect().height)));
            };
            grip.addEventListener("pointermove", move);
            grip.addEventListener("pointerup", up);
            // prerusene tazeni (prepnuti okna, dotyk) - jinak by vyska jela dal s mysi
            grip.addEventListener("pointercancel", up);
            grip.addEventListener("lostpointercapture", up);
        });
        grip.addEventListener("dblclick", () => this.resetHeight());
        return grip;
    }

    private setBodyHeight(px: number): void {
        const hgt = Math.max(160, Math.round(px));
        this.body.style.height = hgt + "px";
        this.body.style.maxHeight = "none";
    }

    /** Tema editoru nezavisle na administraci: auto (jako admin) / svetle / tmave. */
    private applyTheme(mode: ThemeMode): void {
        this.theme = ["light", "dark"].includes(mode) ? mode : "auto";
        for (const el of [this.root, this.bubble.dom, ...(this.linkPop ? [this.linkPop.dom] : []), ...(this.tableTools ? [this.tableTools.dom] : [])]) {
            el.classList.toggle("ce-theme-light", this.theme === "light");
            el.classList.toggle("ce-theme-dark", this.theme === "dark");
        }
        this.toolbar.update(this.view.state);
    }
}

function readStore(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStore(key: string, value: string | null): void {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch { /* neni kam ulozit */ }
}

/** data: URL -> soubor k nahrani (pripona podle typu). */
function dataUrlToFile(dataUrl: string, name: string): File {
    const [head, b64] = dataUrl.split(",", 2);
    const mime = /data:([^;]+)/.exec(head)?.[1] || "image/png";
    const bin = atob(b64 || "");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = mime === "image/jpeg" ? "jpg" : mime.split("/")[1] || "png";
    return new File([bytes], name + "." + ext, { type: mime });
}

/**
 * Co editor nabizi (toolbar, menu bloku, zkratky). Nastavuje se pro kazde pole:
 *
 *   { preset: "basic" }                        predvolba
 *   { preset: "article", disable: ["html"] }   predvolba bez neceho
 *   { features: ["bold", "italic", "link"] }   presny vycet
 *   { headings: [2, 3] }                       povolene urovne nadpisu
 *
 * Omezuje jen nabidku - existujici obsah (napr. HTML blok ve starem clanku)
 * zustane a da se dal upravovat i smazat.
 */
export const ALL_FEATURES = [
    "bold", "italic", "underline", "strike", "sup", "sub", "clear", "link",
    "color", "headings", "lists", "indent", "quote", "align",
    "image", "button", "table", "columns", "video", "hr", "html", "nbsp",
    "variables", "source",
] as const;

export type Feature = typeof ALL_FEATURES[number];

export const PRESETS: Record<string, readonly Feature[]> = {
    /** Vse. */
    full: ALL_FEATURES,
    /** Clanek (blog, pripadova studie): vse krome HTML bloku. */
    article: ALL_FEATURES.filter((f) => f !== "html"),
    /** Kratky text se zakladnim formatovanim (popisky, perex). */
    basic: ["bold", "italic", "underline", "clear", "link", "headings", "lists", "align", "nbsp", "variables", "source"],
    /** Jen formatovani textu. */
    minimal: ["bold", "italic", "link", "clear", "nbsp"],
};

export interface FeatureOptions {
    /** Nazev predvolby (full | article | basic | minimal). Vychozi full. */
    preset?: string;
    /** Presny vycet funkci - ma prednost pred predvolbou. */
    features?: Feature[];
    /** Funkce navic k predvolbe. */
    enable?: Feature[];
    /** Funkce, ktere z predvolby vypnout. */
    disable?: Feature[];
    /** Povolene urovne nadpisu. Vychozi [2, 3, 4]. */
    headings?: number[];
}

export class Features {
    private set: Set<Feature>;
    readonly headings: number[];

    constructor(o: FeatureOptions = {}) {
        const base = o.features || PRESETS[o.preset || "full"] || PRESETS.full;
        this.set = new Set(base.filter((f) => (ALL_FEATURES as readonly string[]).includes(f)));
        (o.enable || []).forEach((f) => this.set.add(f));
        (o.disable || []).forEach((f) => this.set.delete(f));
        const levels = (o.headings || [2, 3, 4]).map(Number).filter((l) => l >= 1 && l <= 6);
        this.headings = [...new Set(levels)].sort();
        if (!this.headings.length) this.set.delete("headings");
    }

    has(f: Feature): boolean {
        return this.set.has(f);
    }

    heading(level: number): boolean {
        return this.set.has("headings") && this.headings.includes(level);
    }
}

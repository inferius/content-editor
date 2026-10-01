/**
 * Promenne v textu: {$nazev} nebo {$nazev:parametr} (napr. {$ig_post:"CxYz123"}).
 * Web je pri zobrazeni nahradi vlastnim obsahem. Stejny zapis jako na webu
 * (parseInnerCode): nazev = pismeno/podtrzitko + znaky slova, parametr do prvni "}".
 */
export const VAR_PATTERN = "\\{\\$([A-Za-z_]\\w*)(?::([^}]*))?\\}";

export function varRegExp(flags = "g"): RegExp {
    return new RegExp(VAR_PATTERN, flags);
}

/** Zapis promenne do textu. args = null -> bez parametru. */
export function varText(name: string, args: string | null): string {
    return args === null || args === undefined ? "{$" + name + "}" : "{$" + name + ":" + args + "}";
}

/** Hodnota parametru bez uvozovek: "\"CxYz\"" -> "CxYz". */
export function argValue(args: string | null): string {
    if (args === null || args === undefined) return "";
    const t = args.trim();
    const m = t.match(/^"(.*)"$/s) || t.match(/^'(.*)'$/s);
    return m ? m[1] : t;
}

/** Hodnota -> parametr (v uvozovkach, pokud je promenna tak zapisuje web). */
export function makeArgs(value: string, quoted: boolean): string | null {
    const v = value.replace(/[{}]/g, "").trim();
    if (v === "") return null;
    return quoted ? "\"" + v.replace(/"/g, "") + "\"" : v;
}

/**
 * Parametry promenne jako seznam hodnot: "\"a\":b" -> ["a", "b"] (args = text za prvni ":").
 * Stejne jako web: hodnota v uvozovkach muze obsahovat ":" a escapovane znaky.
 */
export function splitArgs(args: string | null): string[] {
    if (args === null || args === undefined) return [];
    const re = /:("(?:\\.|[^"\\])*"|[^:}]*)/y;
    const src = ":" + args;
    const out: string[] = [];
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while (re.lastIndex < src.length && (m = re.exec(src))) {
        const v = m[1];
        out.push(v.length >= 2 && v[0] === "\"" && v[v.length - 1] === "\"" ? v.slice(1, -1).replace(/\\(.)/g, "$1") : v);
        if (m[0].length === 0) break;
    }
    return out;
}

/** Hodnoty parametru -> args. Prazdne hodnoty na konci se vynechaji, uvnitr zustanou prazdne. */
export function joinArgs(values: string[], quoted: boolean[]): string | null {
    const vals = values.map((v) => v.replace(/[{}]/g, "").trim());
    while (vals.length && vals[vals.length - 1] === "") vals.pop();
    if (!vals.length) return null;
    return vals.map((v, i) => (quoted[i] !== false ? "\"" + v.replace(/["\\]/g, "") + "\"" : v.replace(/:/g, ""))).join(":");
}

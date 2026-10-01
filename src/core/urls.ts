/**
 * Kontrola URL v odkazech, obrazcich a videich. Editor nikdy nepusti
 * javascript:, data: apod. - s vyjimkou akci webu, ktere obsah pouziva
 * (ALLOWED_JS_ACTIONS, napr. odskok na kontaktni formular).
 */

export const CONTACT_FORM_ACTION = "javascript:scrollToContactForm()";

/** Akce webu, ktere obsah smi volat z odkazu (jine javascript: odkazy editor zahodi). */
export const ALLOWED_JS_ACTIONS = [CONTACT_FORM_ACTION, "javascript:setFocusToTextArea()"];

const SAFE_SCHEME = /^(https?:|mailto:|tel:)/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Bezpecny odkaz (http, https, mailto, tel, relativni, kotva). Jinak "". */
export function safeHref(href: string | null | undefined): string {
    const v = (href ?? "").trim();
    if (v === "") return "";
    const action = ALLOWED_JS_ACTIONS.find((a) => a === v.replace(/\s+/g, ""));
    if (action) return action;
    // ridici znaky a mezery pred schematem se v prohlizeci ignoruji ("java\tscript:")
    const compact = v.replace(/[\x00-\x20]+/g, "");
    if (HAS_SCHEME.test(compact) && !SAFE_SCHEME.test(compact)) return "";
    return v;
}

/** Bezpecny zdroj obrazku (http, https, relativni; data:image jen rastrove). */
export function safeSrc(src: string | null | undefined): string {
    const v = (src ?? "").trim();
    if (v === "") return "";
    const compact = v.replace(/[\x00-\x20]+/g, "");
    if (/^data:image\/(png|jpe?g|gif|webp|avif);/i.test(compact)) return v;
    if (HAS_SCHEME.test(compact) && !/^https?:/i.test(compact)) return "";
    return v;
}

/**
 * YouTube adresa (watch, youtu.be, shorts, embed) -> embed URL, jinak "".
 * Jine sluzby zatim nepodporujeme - vlozit jde pres HTML blok.
 */
export function youtubeEmbed(url: string | null | undefined): string {
    const v = (url ?? "").trim();
    const m = v.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i);
    return m ? `https://www.youtube.com/embed/${m[1]}` : "";
}

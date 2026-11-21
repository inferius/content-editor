/**
 * Inertni dokument (bez okna) pro parsovani a skladani HTML obsahu: prvky v nem nic
 * nenacitaji a nespousti. Obsah je z databaze nebo od jineho uzivatele - v dokumentu
 * stranky by <img src=x onerror=...> nebo <svg onload> spustil skript uz pri parsovani
 * (innerHTML) nebo pri ukladani, i kdyz prvek nikdy nebyl na strance.
 *
 * Parsovat i serializovat je nutne ve STEJNEM dokumentu: inertni dokument nema skriptovani,
 * takze <noscript> v nem obsahuje prvky; v dokumentu stranky je to jeden textovy uzel
 * a po prenosu mezi nimi by se obsah noscriptu pri ulozeni dvakrat escapoval.
 *
 * Nastroje v Node (roundtrip, paste-test) nastavuji globalThis.document z jsdom.
 */
let inert: Document | null = null;

export function inertDocument(): Document {
    if (typeof document === "undefined") throw new Error("content-editor: chybi document");
    return inert ??= document.implementation.createHTMLDocument("");
}

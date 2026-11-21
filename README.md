# Content Editor

Blokový editor obsahu na jádru [ProseMirror](https://prosemirror.net/) (MIT). Náhrada CKEditoru 4 bez licenčních omezení. Výstupem je čisté HTML ve stejném tvaru, jaký ukládal CKEditor, takže web se nemění.

Licence závislostí: ProseMirror, prosemirror-tables a CodeMirror 6 jsou MIT. Nepotřebují licenční klíč, neposílají telemetrii a nemají placené verze.

## Co umí

- **Text:** odstavce, nadpisy 2–4, tučné / kurzíva / podtržení / přeškrtnuté, horní a dolní index, odkazy, odrážky a číslované seznamy (vnořování přes Tab), citace, zarovnání, odsazení.
- **Bloky:**
  - obrázek (výběr přes správce souborů, alt, šířka, `img-responsive`),
  - tlačítko (`div.flex.f-jc-center > a.btn`, akce „posunout na kontaktní formulář“ nebo odkaz),
  - tabulka (mřížka pro velikost, záhlaví řádku i sloupce, šířka, ohraničení, `img-responsive`; řádky, sloupce, sloučení buněk),
  - sloupce (`div.cms-cols > div.cms-col`): rychlé varianty 2 / 3 / 4 stejné, 1/3 + 2/3, 2/3 + 1/3; v nastavení vlastní šířky, mezera, svislé zarovnání a chování na mobilu (styly webu: `.cms-cols` v global/pages),
  - video z YouTube, vodorovná čára, HTML blok.
- **Ovládání bloků:** vlevo u bloku `+` (vložit pod) a úchyt. Přetažením blok přesuneš, kliknutím otevřeš menu (převést na jiný typ, posunout, duplikovat, upravit, smazat). Dvojklik na obrázek nebo tlačítko otevře nastavení.
- **Toolbar a bublina:** pevný toolbar nahoře, bublina nad označeným textem.
- **Rychlé zápisy:** `## ` nadpis, `- ` odrážky, `1. ` číslování, `> ` citace, `---` čára.
- **Vkládání obrázků:** obrázek ze schránky (Ctrl+V) nebo přetažený soubor se nahraje přes správce souborů.
- **Zdrojový režim:** HTML v CodeMirror. Výstup i odtud prochází schématem. Otevře se na bloku, kde byl kurzor, a po zavření vrátí kurzor na blok ze zdroje. Nápověda tagů a atributů (Ctrl+Mezera), automatické uzavírání tagů a uvozovek, hledání a nahrazení (Ctrl+F), sbalování bloků, zvýraznění párového tagu, formátování (Alt+Shift+F - bloky na řádky, obsah odstavců beze změny). Stejný editor má dialog HTML bloku.
- **Proměnné webu** (`{$specialist}`, `{$ig_post:"kod"}` ...): v textu jako čip, vkládání z nabídky, úprava parametru dvojklikem. Přepínač „Proměnné jako na webu“ místo čipu ukáže, co z proměnné udělá web (HTML od serveru ve stylech webu, izolované v Shadow DOM). Neznámá proměnná je červeně - web ji smaže.
- **Vzhled webu:** obsah se v editoru vysází styly webu (písmo, nadpisy, seznamy, tabulky) v obalech jako na webu. Styly webu se omezí jen na obsah editoru (selektory dostanou předponu `.ce-web`).
- **Náhled jak na webu:** okno s obsahem ve stylech webu a šířkou počítač / tablet / mobil. Obsah náhledu je bez skriptů a obsluh událostí; Instagram se zobrazí přes oficiální vložený iframe.
- **Barva textu a zvýraznění, nezlomitelná mezera** (Ctrl+Shift+Mezera).
- **Vzhled editoru:** téma podle administrace / světlé / tmavé, výška editoru tažením (pamatuje se pod `storageKey`; při pevné výšce tlačítko Automaticky na liště pod editorem vrátí výšku podle obsahu, stejně jako dvojklik na lištu), celá obrazovka.

## Věrnost obsahu

| Co editor udělá | Kdy |
|---|---|
| zachová beze změny | vše, co schéma zná, včetně tříd tlačítek a obrázků, `alt=""`, zarovnání, odsazení a záměrných barev / zvýraznění / velikostí písma; třídy seznamů, položek a nadpisů (`ul.blue-dots`, `li.small-title`, `h3.big-title`), `span` s třídou webu (`span.big-text`), obtékání a okraje obrázků (`float`, `margin`), šířky a výšky buněk tabulek |
| zachová a zobrazí jako **kontejner** (obsah uvnitř se upravuje normálně) | `div` s bloky uvnitř (s třídou i bez - layout webu); `div` jen s textem zůstane `div` s textem (bez vloženého `<p>`) |
| zachová přesně jako **HTML blok** | neznámé prvky (skripty, formuláře, jiné iframy), upravit se dají jen ve zdroji |
| zahodí | balast z Wordu a Google Docs (`paraeid`, `aria-*`, `data-*`, fonty, výchozí černá a bílá, 11–12pt, `page-break`), prázdné seznamy |
| ze schránky nepustí | HTML bloky, kontejnery, skripty, formuláře, iframy, třídy a styly zdrojového webu (seznamy, nadpisy, `span`, obtékání) |

Odkazy smí mít jen `http(s)`, `mailto:`, `tel:`, relativní adresu nebo povolené akce webu (`ALLOWED_JS_ACTIONS` v `src/core/urls.ts`, další přes `markup.jsActions`).

Ověřuje se testem tam a zpět nad obsahem z DB:

```
php tools/export_content.php
npm run roundtrip
```

Jiný projekt: export do JSON (`[{table, column, id, html}]`) a `node tools/roundtrip.mjs --data=export.json --markup='{"video":{...}}'`.

Stav k 30. 9. 2026: 1 452 textů, žádná změna viditelného textu, žádný nestabilní výsledek.
Stav k 4. 10. 2026 (anoda + cestadocloudu, admin na jádru EasyAdmin): 1 492 textů, žádná změna viditelného textu, žádný nestabilní výsledek; zahazuje se jen balast z Wordu (mimo pole s měřicími skripty, ta editor obsahu nepoužívají). Lokalizační texty (`_front_lang_texts_lang_data`) jsou fragmenty bez `<p>` a s `id` pro skripty, na ty editor zatím určený není.

## Použití

```html
<link rel="stylesheet" href="/packages/content-editor/dist/content-editor.css">
<script src="/packages/content-editor/dist/content-editor.js"></script>
<script>
    // 1) nahrada textarey - rozhrani jako CKEDITOR.replace (getData, setData, on("change"), destroy ...)
    const ed = ContentEditor.replace(document.getElementById("text"), {
        pickImage: () => MediaLibrary.pick(config, { accept: "image" }).then((f) => f && { src: f.url }),
        uploadImage: (file) => /* nahrat, vratit { src, reused? } */,
        importImage: (url, { name }) => /* stahnout obrazek z Google Docs, vratit { src } */,
        imageLibraryName: "správce souborů", // "Ukládám obrázky do ..." (vychozi "Souborů a obrázků")
    });

    // 2) primo do prvku
    const ed2 = ContentEditor.create(element, "<p>Ahoj</p>", { placeholder: "Pište..." });
    ed2.getHTML(); ed2.setHTML(html); ed2.on("change", fn); ed2.destroy();

    // 3) jen HTML editor (napr. sablona kodu do textu) a nahled ve stylech webu
    const src = ContentEditor.sourceEditor(element, "<div>...</div>", { onChange: (html) => {} });
    iframe.srcdoc = ContentEditor.previewDocument(html, webLook, { padding: "16px" });
</script>
```

**Bezpečnost obsahu.** Obsah pole je HTML z databáze, tedy i od jiného uživatele. Editor ho
parsuje a skládá v inertním dokumentu (`document.implementation.createHTMLDocument`), takže
`<img onerror>`, `<svg onload>` apod. se v administraci nespustí. Hostitel ale musí obsah
do `<textarea>` vypsat **escapovaný** - `htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE)`,
v JS escapovat `& < > " '`. Pozor na Latte 3: `{$value}` v textu mění `{{` na `{<!-- -->{`
a v textarea by komentář zůstal v obsahu doslova. Escapovat proto v PHP funkcí a vypsat
s `|noescape` (`|` uvnitř výrazu bere Latte 3 jako filtr, i v závorkách). Neescapovaný text s `</textarea>` ukončí pole a zbytek se vykoná jako HTML
stránky dřív, než se editor vůbec spustí.

### Samostatny editor kodu

Pole, kam se vkladaji skripty a HTML (Nastaveni webu -> Merici a konverzni kody), nepotrebuje cely editor obsahu. `dist/code-editor.js` (bez ProseMirroru) pusti nad `<textarea>` jen CodeMirror - obarveni, napovedu tagu, hledani a formatovani. Textarea zustava v DOM a drzi hodnotu, takze ukladani formulare funguje beze zmeny. Vysku editoru lze pretahnout za pravy dolni roh; `height` / `onResize` necha hostitele, aby si ji ulozil (v administraci k uctu uzivatele).

```html
<link rel="stylesheet" href="/packages/content-editor/dist/content-editor.css">
<script src="/packages/content-editor/dist/code-editor.js"></script>
<script>
    const ed = CodeEditor.replace(document.getElementById("google_analytics"), {
        minHeight: 170,
        format: false,                        // skryje Formatovat (prepsalo by entity)
        height: 420,                          // drive ulozena vyska
        onResize: (px) => save(px),           // uzivatel ji pretahl
        onSave: () => form.requestSubmit(),   // Ctrl+S
    });
    ed.value;  ed.focus();  ed.destroy();
</script>
```

### Nastavení pole

| Volba | Význam |
|---|---|
| `preset` | `full` (vše), `article` (vše kromě HTML bloku), `basic` (text, odkazy, seznamy, nadpisy), `minimal` (tučně, kurzíva, odkaz) |
| `features` / `enable` / `disable` | přesný výčet funkcí / přidat / ubrat (`ALL_FEATURES` v `src/editor/features.ts`) |
| `headings` | povolené úrovně nadpisů, např. `[2, 3]` |
| `variables` | proměnné: `{ name, label, description?, group?, offer?, params?: [{ label, placeholder?, hint?, quoted?, pattern?, options? }] }` - `group` = skupina v nabídce, `offer: false` = editor proměnnou zná (čip), ale nenabízí ji, `options: [{ value, label }]` = parametr se vybírá ze seznamu a čip ukazuje popisek |
| `renderVariables(codes)` | `Promise<{ kód: html }>` - co z proměnných udělá web (náhled čipů) |
| `renderPreview(html)` | `Promise<html>` - celý obsah, jak ho zobrazí web (okno náhledu) |
| `previewPage(html)` | `Promise<url \| null>` - adresa celé stránky webu s neuloženým obsahem (náhled i se skripty webu - galerie, slidery); `null` = jen obsah. Přepínač „Stránka / Jen obsah“ v okně náhledu |
| `web` | `{ css: [url], wrappers: ["třídy obalu", ...], contentClass, width, extraCss, bodyClass, baseUrl }` |
| `colors` | paleta barev textu `[{ label, value }]` |
| `markup` | markup podle webu (platí pro celou stránku, viz `ContentEditor.configureMarkup`): `{ video: { wrapperClass, iframeClass }, jsActions: ["scrollToSelector"] }` - obal YouTube videa (rozpozná se výchozí i nastavený, uloží se nastavený) a funkce webu povolené v odkazech `javascript:nazev('argument')` |

Omezení funkcí platí jen pro nabídku (toolbar, menu, zkratky). Existující obsah zůstane a jde upravit i smazat.

Styly pro vzhled webu se stahují přes `fetch` a přepisují, takže musí být ze stejného původu nebo s CORS (v této aplikaci je podává proxy `admin/content_editor/api.php?action=css`).

Napojení v této aplikaci: `admin/framework/content_editor.php` (nastavení polí `PAGES`, proměnné, vzhled webu, vykreslení proměnných stejně jako web), `admin/content_editor/api.php` + `host.js` a šablona `admin/templates/formdata/input/old_ckeditor`. Prototyp běží jen v editaci blogu a přepínač „Nový editor / CKEditor“ si volbu pamatuje v cookie.

## Vývoj

```
npm install
npm run build        # dist/content-editor.js + dist/code-editor.js + .css (commituje se - server node nepotřebuje)
npm run watch        # průběžný build
npm run typecheck
npm run roundtrip    # test tam a zpět (nejdřív php tools/export_content.php)
```

`dist/dev.html` (není v gitu) je lokální zkušební stránka.

| Složka | Obsah |
|---|---|
| `src/core/` | schéma, převod HTML, bezpečnost URL (bez UI - běží i v Node) |
| `src/editor/` | editor, příkazy, klávesy, úchyt bloků, zobrazení bloků, zdrojový režim, funkce (`features.ts`), proměnné (`variables.ts`), vzhled webu (`web.ts`) |
| `src/ui/` | toolbar, bublina, dialogy, ikony |

Nový typ bloku se přidá takto:
1. uzel v `src/core/schema.ts` (`parseDOM` a `toDOM`),
2. volitelně zobrazení v `nodeviews.ts`, dialog v `dialogs.ts` a položka v toolbaru nebo v menu u `+`,
3. spustit test tam a zpět.

## Použití v projektu (composer)

Balíček je samostatný repozitář `inferius/content-editor` (composer `michalosoft/content-editor`), vyčleněný z mytimi2. Sestavený `dist/` je v repozitáři, cílový projekt Node nepotřebuje.

```json
"repositories": [{ "type": "vcs", "url": "https://github.com/inferius/content-editor.git", "no-api": true }],
"require": { "michalosoft/content-editor": "^0.1" }
```

`vendor/` není veřejný, proto si projekt `dist/` zkopíruje do veřejné složky (v mytimi2 `packages/content-editor/dist`, skript `tools/publish_packages.php` po `composer install/update`).

Vývoj: změny se dělají tady, `npm run build`, commit včetně `dist/`, nový tag, v projektu `composer update michalosoft/content-editor`.

### Co je zatím specifické pro mytimi (k zobecnění při napojení dalšího projektu)

- tlačítko `div.flex.f-jc-center > a.btn` a akce kontaktního formuláře (`core/schema.ts`, `core/urls.ts`, `ui/dialogs.ts`),
- sloupce `.cms-cols` (`core/schema.ts`) - web musí mít odpovídající CSS,
- třída obrázků/tabulek `img-responsive`,
- `lang="cs"`, české texty UI bez i18n,
- hostitelská vrstva (napojení na správce souborů, proměnné, náhled) je zatím v projektu (mytimi2 `admin/content_editor/`, `admin/framework/content_editor.php`).

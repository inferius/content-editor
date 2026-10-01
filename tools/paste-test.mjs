// Test vkladani z Office: ukazky schranky (Word, Word online, Excel, Google Docs) projdou
// cisticem (core/office.ts) a parserem vkladani editoru, vypise se vysledne HTML a kontroly.
//
//   node build.mjs && node tools/paste-test.mjs [--verbose]
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;

const { cleanOfficeHTML, pasteParser, serializeHTML } = await import("../dist-node/core.mjs");

const PALETTE = ["#d0312d", "#e67e22", "#27ae60", "#1d67e7", "#7b3fb8", "#6b7280"];
const verbose = process.argv.includes("--verbose");

/** Barva ve vystupu (serializer ji zapise jako #hex nebo rgb()). */
function hasColor(html, hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return html.includes("color: " + hex) || html.includes(`color: rgb(${r}, ${g}, ${b})`);
}

const WORD = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta name=ProgId content=Word.Document><meta name=Generator content="Microsoft Word 15">
<style><!-- p.MsoNormal, li.MsoNormal, div.MsoNormal {margin:0cm;font-size:11.0pt;font-family:"Calibri",sans-serif;}
h1 {mso-style-link:"Nadpis 1 Char";color:#2F5496;}
span.SilnChar {mso-style-name:"Siln\\00FD Char";font-weight:bold;}
p.MsoQuote, li.MsoQuote {font-style:italic;color:#404040;} --></style></head>
<body lang=CS style='tab-interval:35.4pt'>
<!--StartFragment-->
<h1><span style='font-family:"Calibri Light";color:#2F5496'>Kde má navrch kandidát<o:p></o:p></span></h1>
<p class=MsoNormal>Vyjednávací síla se <b>neustále</b> přelévá a <span style='color:#C00000'>liší obor</span> od&nbsp; oboru.<o:p></o:p></p>
<p class=MsoNormal><o:p>&nbsp;</o:p></p>
<h2>Podnadpis</h2>
<p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]><b>Pozice s nízkou</b> - právník<o:p></o:p></p>
<p class=MsoListParagraphCxSpMiddle style='margin-left:72.0pt;text-indent:-18.0pt;mso-list:l0 level2 lfo1'><![if !supportLists]><span style='font-family:"Courier New"'><span style='mso-list:Ignore'>o<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span></span><![endif]>vnořená<o:p></o:p></p>
<p class=MsoListParagraphCxSpLast style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>·<span>&nbsp; </span></span><![endif]>Druhá<o:p></o:p></p>
<p class=MsoListParagraphCxSpFirst style='mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>1.<span>&nbsp;</span></span><![endif]>Jedna<o:p></o:p></p>
<p class=MsoListParagraphCxSpLast style='mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>2.<span>&nbsp;</span></span><![endif]>Dvě<o:p></o:p></p>
<p class=MsoNormal align=center style='text-align:center'><span class=SilnChar>Silný styl</span> a <a href="https://mytimi.cz/">odkaz</a> a <a href="#_Toc1">obsah</a><o:p></o:p></p>
<p class=MsoQuote>Citát<o:p></o:p></p>
<p class=MsoNormal><span style='mso-no-proof:yes'><v:shape><v:imagedata src="file:///C:/x.png"/></v:shape><![if !vml]><img width=100 src="file:///C:/Users/x/clip_image002.png"><![endif]></span><o:p></o:p></p>
<p class=MsoNormal style='text-align:justify'><span style='color:#404040'>šedý text</span> a <span style='color:#00B050'>zelený</span> a <span style='background:yellow;mso-highlight:yellow'>zvýraznění</span><o:p></o:p></p>
<table class=MsoTableGrid border=1 cellspacing=0 style='border-collapse:collapse'><tr><td width=200 valign=top style='width:150pt;border:solid windowtext 1.0pt'><p class=MsoNormal><b>A</b><o:p></o:p></p></td><td><p class=MsoNormal>B<o:p></o:p></p></td></tr></table>
<!--EndFragment-->
</body></html>`;

const EXCEL = `<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta name=ProgId content=Excel.Sheet><meta name=Generator content="Microsoft Excel 15">
<style><!--table {mso-displayed-decimal-separator:"\\,";}
td {padding-top:1px;color:black;font-size:11.0pt;font-weight:400;}
.xl65 {mso-style-parent:style0;font-weight:700;}
.xl66 {mso-style-parent:style0;color:#C00000;text-align:center;}
.xl67 {font-style:italic;background:#FFFF00;}
--></style></head><body link="#0563C1">
<table border=0 cellpadding=0 cellspacing=0 width=300 style='border-collapse:collapse;width:225pt'>
<!--StartFragment-->
 <col width=100 span=3 style='width:75pt'>
 <tr height=20 style='height:15.0pt'>
  <td height=20 class=xl65 width=100>Název</td>
  <td class=xl65 width=100>Cena</td>
  <td class=xl65>Pozn.</td>
 </tr>
 <tr height=20><td height=20>Konzultace</td><td class=xl66 align=right>1 500 Kč</td><td class=xl67>akce</td></tr>
 <tr height=0 style='display:none'><td>skryto</td><td>x</td><td>y</td></tr>
 <tr><td colspan=2 class=xl66>Sloučené</td><td></td></tr>
<!--EndFragment-->
</table></body></html>`;

const GDOCS = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-abc"><h1 dir="ltr" style="line-height:1.38;margin-top:20pt"><span style="font-size:20pt;font-family:Arial;color:#000000;font-weight:400;">Titulek</span></h1><p dir="ltr" style="line-height:1.38;"><span style="font-size:11pt;font-family:Arial;color:#000000;font-weight:700;">tučně</span><span style="font-size:11pt;color:#ff0000;font-weight:400;font-style:italic;"> červená kurzíva</span></p><br><ul style="margin-top:0;margin-bottom:0;"><li dir="ltr" aria-level="1" style="list-style-type:disc;"><p dir="ltr" role="presentation"><span>a</span></p></li><li dir="ltr" aria-level="2" style="list-style-type:circle;"><p dir="ltr" role="presentation"><span>b</span></p></li></ul></b><br class="Apple-interchange-newline">`;

const GSHEETS = `<meta charset="utf-8"><google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}br {mso-data-placement:same-cell;}--></style><table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" style="table-layout:fixed;font-size:10pt;font-family:Arial;width:0px;border-collapse:collapse;border:none"><colgroup><col width="100"/><col width="100"/></colgroup><tbody><tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;font-weight:bold;">Hlava</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;color:#1155cc;" data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:12}">12</td></tr></tbody></table>`;

const WORD_ONLINE = `<div class="OutlineElement Ltr SCXW1"><p class="Paragraph SCXW1" role="heading" aria-level="2" paraid="1"><span class="TextRun SCXW1" data-contrast="none"><span class="NormalTextRun SCXW1">Online nadpis</span></span><span class="EOP SCXW1">&nbsp;</span></p></div>
<div class="ListContainerWrapper SCXW1"><ul class="BulletListStyle1 SCXW1"><li data-leveltext="" data-aria-level="1" class="OutlineElement"><p class="Paragraph"><span class="TextRun" style="font-weight:bold">Bod</span><span class="EOP">&nbsp;</span></p></li></ul></div>
<div class="ListContainerWrapper SCXW1"><ul class="BulletListStyle1 SCXW1"><li data-aria-level="2" class="OutlineElement"><p class="Paragraph"><span class="TextRun">Pod</span></p></li></ul></div>
<div class="ListContainerWrapper SCXW1"><ul class="BulletListStyle1 SCXW1"><li data-aria-level="1" class="OutlineElement"><p class="Paragraph"><span class="TextRun">Bod 2</span></p></li></ul></div>`;

const WEB = `<p>Obyčejný <span style="color:#8ab8ff">web</span></p>`;

function paste(html, opts = {}) {
    const res = cleanOfficeHTML(html, { palette: PALETTE, headings: [2, 3, 4], doc: document, ...opts });
    const d = document.createElement("div");
    d.innerHTML = res ? res.html : html;
    const doc = pasteParser.parse(d);
    return { res, out: serializeHTML(doc) };
}

let failed = 0;
function check(name, cond, info) {
    if (!cond) failed++;
    console.log((cond ? "  ok    " : "  CHYBA ") + name + (cond || !info ? "" : "\n          " + info));
}

function run(label, html, checks, opts) {
    const { res, out } = paste(html, opts);
    console.log(`\n== ${label} (${res ? res.source : "neni z Office"}${res?.droppedImages ? ", obrazky: " + res.droppedImages : ""})`);
    if (verbose) console.log(out);
    for (const [name, fn] of checks) check(name, fn(out, res), out);
}

run("Word", WORD, [
    ["Nadpis 1 -> h2 bez barvy a fontu", (o) => /<h2>Kde má navrch kandidát<\/h2>/.test(o)],
    ["Nadpis 2 -> h3", (o) => /<h3>Podnadpis<\/h3>/.test(o)],
    ["tucne", (o) => /<strong>neustále<\/strong>/.test(o)],
    ["tmave cervena -> cervena z palety", (o) => hasColor(o, "#d0312d") && o.includes("liší obor</span>")],
    ["dve mezery (&nbsp; ) -> jedna", (o) => /od oboru/.test(o)],
    ["prazdny odstavec pryc", (o) => !/<p>(\s|&nbsp;)*<\/p>/.test(o)],
    ["odrazky -> ul se 2 polozkami + vnorena", (o) => /<ul>\s*<li><strong>Pozice s nízkou<\/strong> - právník\s*<ul>\s*<li>vnořená<\/li>\s*<\/ul>\s*<\/li>\s*<li>Druhá<\/li>\s*<\/ul>/.test(o)],
    ["cislovani -> ol", (o) => /<ol>\s*<li>Jedna<\/li>\s*<li>Dvě<\/li>\s*<\/ol>/.test(o)],
    ["znacka odrazky (·, o) pryc", (o) => !/·|>o</.test(o)],
    ["styl znaku Silny (trida) -> strong", (o) => /<strong>Silný styl<\/strong>/.test(o)],
    ["zarovnani na stred", (o) => /<p style="text-align: ?center;?">/.test(o)],
    ["odkaz http zustane, #_Toc rozbaleny", (o) => /<a href="https:\/\/mytimi\.cz\/">odkaz<\/a> a obsah/.test(o)],
    ["citace -> blockquote", (o) => /<blockquote>\s*<p>Citát<\/p>\s*<\/blockquote>/.test(o)],
    ["obrazek file:// vynechan a spocitan", (o, r) => !/<img/.test(o) && r.droppedImages === 1],
    ["seda barva pryc, zelena -> paleta, zvyrazneni pryc", (o) => !/404040|yellow|background/.test(o) && hasColor(o, "#27ae60")],
    ["do bloku (justify) se nedrzi", (o) => !/justify/.test(o)],
    ["tabulka bez stylu", (o) => /<table>/.test(o) && !/width|border|MsoTableGrid/.test(o) && /<td><strong>A<\/strong><\/td>/.test(o)],
    ["zadne mso / tridy / fonty", (o) => !/mso|class=|font-family|font-size|o:p/i.test(o)],
]);

run("Excel", EXCEL, [
    ["tabulka", (o) => /<table>/.test(o)],
    ["tucna hlavicka z tridy .xl65", (o) => /<td><strong>Název<\/strong><\/td>/.test(o)],
    ["barva z tridy -> paleta + zarovnani", (o) => /text-align: ?center/.test(o) && hasColor(o, "#d0312d")],
    ["kurziva z tridy, zluta vyplne pryc", (o) => /<em>akce<\/em>/.test(o) && !/FFFF00|ffff00/i.test(o)],
    ["skryty radek vynechan", (o) => !/skryto/.test(o)],
    ["colspan", (o) => /colspan="2"/.test(o)],
    ["bez sirek a col", (o) => !/width|<col/.test(o)],
]);

run("Google Docs", GDOCS, [
    ["obal <b font-weight:normal> netucni vse", (o) => !o.includes("<strong>Titulek") && !/<strong>[^<]*červená/.test(o)],
    ["h1 -> h2", (o) => /<h2>Titulek<\/h2>/.test(o)],
    ["font-weight:700 -> strong", (o) => /<strong>tučně<\/strong>/.test(o)],
    ["cervena kurziva -> paleta + em", (o) => hasColor(o, "#d0312d") && o.includes("<em>")],
    ["aria-level -> vnoreny seznam", (o) => /<ul>\s*<li>a\s*<ul>\s*<li>b<\/li>/.test(o)],
]);

run("Google Sheets", GSHEETS, [
    ["tabulka + tucne + modra", (o) => o.includes("<table>") && o.includes("<strong>Hlava</strong>") && hasColor(o, "#1d67e7")],
]);

run("Word online", WORD_ONLINE, [
    ["role=heading aria-level=2 -> h3", (o) => /<h3>Online nadpis<\/h3>/.test(o)],
    ["seznamy z oddelenych wrapperu -> jeden vnoreny", (o) => /<ul>\s*<li><strong>Bod<\/strong>\s*<ul>\s*<li>Pod<\/li>\s*<\/ul>\s*<\/li>\s*<li>Bod 2<\/li>\s*<\/ul>/.test(o)],
]);

run("Word bez barev a nadpisu (zakladni pole)", WORD, [
    ["nadpisy -> odstavce", (o) => !/<h\d/.test(o)],
    ["bez barev", (o) => !/color/.test(o)],
], { palette: [], headings: [] });

run("Web (ne Office) - beze zmeny", WEB, [
    ["nerozpoznano jako Office", (o, r) => r === null],
    ["barva z webu se nevlozi (jako drive)", (o) => !/color/.test(o)],
]);

// ---------------------------------------------------------------- obrazky z Wordu (RTF)

{
    const { extractRtfImages } = await import("../dist-node/core.mjs");
    // PNG 1x1 (cerveny bod) jako hex - Word ho v RTF zalamuje po radcich
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
    const hex = png.toString("hex").replace(/(.{64})/g, "$1\r\n");
    const BS = String.fromCharCode(92);
    const pict = (blip, data) => `{${BS}pict{${BS}*${BS}picprop${BS}shplid1025{${BS}sp{${BS}sn shapeType}{${BS}sv 75}}}${BS}picscalex100${BS}picw26${BS}pich26${BS}${blip}${BS}bliptag255312533{${BS}*${BS}blipuid 0f378c75a1}\r\n${data}}`;
    const rtf = `{${BS}rtf1${BS}ansi {${BS}*${BS}shppict${pict("pngblip", hex)}}{${BS}nonshppict${pict("wmetafile8", "0100090000")}}${BS}par Text {${BS}*${BS}shppict${pict("jpegblip", "ffd8ffe000104a464946")}}}`;
    const imgs = extractRtfImages(rtf);
    console.log("\n== RTF obrazky");
    check("2 obrazky (PNG + JPEG), WMF nahradni verze preskocena", imgs.length === 2, JSON.stringify(imgs.map((i) => i.slice(0, 30))));
    check("PNG data beze zmeny (bliptag se neslepi s daty)", imgs[0] === "data:image/png;base64," + png.toString("base64"), imgs[0]?.slice(0, 80));
    check("JPEG typ", imgs[1]?.startsWith("data:image/jpeg;base64,/9j/"), imgs[1]?.slice(0, 40));

    const word = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><body><p class=MsoNormal>Před<o:p></o:p></p><p class=MsoNormal><img width=602 height=300 src="file:///C:/Users/x/AppData/Local/Temp/msohtmlclip1/01/clip_image001.png" alt="Graf tržeb"><o:p></o:p></p><p class=MsoNormal>Mezi <img src="file:///C:/x/clip_image003.jpg"></p></body></html>`;
    const ok = cleanOfficeHTML(word, { palette: PALETTE, headings: [2, 3, 4], doc: document, localImages: imgs });
    check("obrazky z RTF dosazene ve stejnem poradi", ok.images.length === 2 && ok.images[0].src === imgs[0] && ok.images[1].src === imgs[1] && ok.droppedImages === 0, JSON.stringify(ok.images.map((i) => i.src.slice(0, 25))));
    check("alt, img-responsive a sirka bez vysky", /<img src="data:image\/png[^"]*" alt="Graf tržeb" class="img-responsive" style="width: 602px">/.test(ok.html), ok.html.slice(0, 300));
    const d = document.createElement("div");
    d.innerHTML = ok.html;
    const out = serializeHTML(pasteParser.parse(d));
    check("obrazek projde parserem editoru", (out.match(/<img /g) || []).length === 2, out.slice(0, 300));

    const bad = cleanOfficeHTML(word, { palette: PALETTE, headings: [2, 3, 4], doc: document, localImages: imgs.slice(0, 1) });
    check("pocet nesedi -> obrazky vynechany (neprehazet)", bad.unmatchedLocal && bad.images.length === 0 && !/<img/.test(bad.html));

    const gd = cleanOfficeHTML(`<b id="docs-internal-guid-1"><p><img src="https://lh7-rt.googleusercontent.com/docsz/AD_4nX?key=abc" width="300"></p></b>`, { palette: PALETTE, headings: [2], doc: document, remoteImages: true });
    check("Google Docs obrazek k importu", gd.images.length === 1 && gd.images[0].kind === "remote", JSON.stringify(gd.images));
    const gdOff = cleanOfficeHTML(`<b id="docs-internal-guid-1"><p><img src="https://lh7-rt.googleusercontent.com/x"></p></b>`, { palette: PALETTE, headings: [2], doc: document });
    check("bez importu -> vynechan", gdOff.images.length === 0 && gdOff.droppedImages === 1);
}

// ---------------------------------------------------------------- nalezy code review (regrese)

{
    const W = (body) => `<html xmlns:w="urn:schemas-microsoft-com:office:word"><body>${body}</body></html>`;
    const run2 = (html, opts = {}) => {
        const r = cleanOfficeHTML(html, { palette: PALETTE, headings: [2, 3, 4], doc: document, ...opts });
        if (!r) return { r, o: null };
        const d = document.createElement("div");
        d.innerHTML = r.html;
        return { r, o: serializeHTML(pasteParser.parse(d)) };
    };
    console.log("\n== Nalezy code review");
    let x = run2(`<b id="docs-internal-guid-x"><ul><li aria-level="1"><p>item</p></li></ul><span>tail text</span></b>`);
    check("radkovy text za seznamem zustane za nim", /<\/ul>\s*<p>tail text<\/p>/.test(x.o), x.o);
    x = run2(W(`<p class=MsoListParagraphCxSpFirst style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>·</span>item</p><span>tail</span><p>next</p>`));
    check("Word: text za odrazkou za seznamem", /<\/ul>\s*<p>tail<\/p>/.test(x.o), x.o);
    x = run2(`<b id="docs-internal-guid-x"><ul><li aria-level="1"><p>a</p></li><ol><li aria-level="2"><p>b</p></li></ol></ul></b>`);
    check("Google Docs: vnoreny seznam primo v ul se neztrati", /<li>a<ol><li>b<\/li><\/ol><\/li>/.test(x.o), x.o);
    x = run2(`<b id="docs-internal-guid-x"><p><a href="https://example.com" style="text-decoration:none"><span style="color:#1155cc;text-decoration:underline">the link</span></a></p></b>`);
    check("odkaz bez <u> a barvy", /<a href="https:\/\/example\.com">the link<\/a>/.test(x.o), x.o);
    x = run2(W(`<p class=MsoListParagraphCxSpFirst style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>1.</span>one</p><p class=MsoListParagraphCxSpMiddle>pokracovani</p><p class=MsoListParagraphCxSpLast style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>2.</span>two</p>`));
    check("Word: pokracovani polozky v polozce (cislovani nepreruseno)", /<ol><li><p>one<\/p><p>pokracovani<\/p><\/li><li>two<\/li><\/ol>/.test(x.o), x.o);
    x = run2(`<p>Use <code>mso-list: l0</code></p>`);
    check("text s 'mso-' neni Word", x.r === null);
    x = run2(`<p data-pm-slice="1 1 []" class="MsoNormal" style="mso-x:1">copy</p>`);
    check("kopie uvnitr editoru neni Office", x.r === null);
    x = run2(`<html xmlns:x="urn:schemas-microsoft-com:office:excel"><body><table><tr><td colspan=3 style='mso-ignore:colspan'>dlouhy text</td><td>b</td></tr></table></body></html>`);
    check("Excel: preteceni textu neni slouceni", !/colspan/.test(x.o), x.o);
    x = run2(W(`<p><img src="file:///C:/a.emf"></p><p><img src="file:///C:/b.png"></p>`), { localImages: [null, "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="] });
    check("RTF: EMF (null) drzi poradi - PNG dostane spravny obrazek", x.r.images.length === 1 && x.r.droppedImages === 1 && !x.r.unmatchedLocal, JSON.stringify({ i: x.r.images.length, d: x.r.droppedImages, u: x.r.unmatchedLocal }));
    x = run2(W(`<p>a<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="></p>`), { keepImages: false });
    check("pole bez obrazku: obrazek vynechan", !/<img/.test(x.o) && x.r.droppedImages === 1);
    const deep = "<span>".repeat(3000) + "x" + "</span>".repeat(3000);
    const t0 = Date.now();
    run2(W(`<p>${deep}</p>`));
    check("hluboko vnorene obaly bez kvadraticke casove slozitosti", Date.now() - t0 < 3000, (Date.now() - t0) + " ms");
    const t1 = Date.now();
    run2(`<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><style>${"p.MsoX{color:red".repeat(1) + "a".repeat(200000)}</style></head><body><p class=MsoNormal>x</p></body></html>`);
    check("neuzavrene pravidlo ve <style> bez zamrznuti", Date.now() - t1 < 2000, (Date.now() - t1) + " ms");
}

// ---------------------------------------------------------------- skutecna schranka Wordu (fixtures/word-test.*)

{
    const { readFileSync, existsSync } = await import("node:fs");
    const { extractRtfImages } = await import("../dist-node/core.mjs");
    const dir = new URL("./fixtures/", import.meta.url);
    if (existsSync(new URL("word-test.html", dir))) {
        const html = readFileSync(new URL("word-test.html", dir), "utf8");
        const rtf = readFileSync(new URL("word-test.rtf", dir), "utf8");
        const imgs = extractRtfImages(rtf);
        const res = cleanOfficeHTML(html, { palette: PALETTE, headings: [2, 3, 4], doc: document, localImages: imgs, remoteImages: true });
        const d = document.createElement("div");
        d.innerHTML = res.html;
        const o = serializeHTML(pasteParser.parse(d));
        console.log("\n== Word - skutecna schranka (make-word-fixture.ps1)");
        if (verbose) console.log(o.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]{40,}/g, "data:..."));
        check("vsech 5 obrazku z RTF sparovanych (i obtekany file://)", imgs.length === 5 && res.images.length === 5 && !res.unmatchedLocal && res.droppedImages === 0, `${imgs.length} ${res.images.length} ${res.unmatchedLocal}`);
        check("sirka obrazku z atributu v px (ne pt ze stylu)", o.includes('style="width: 172px;"') && o.includes('style="width: 354px;"'));
        check("Nazev -> h2, Podtitul -> h3, Nadpis 1 -> h2", /^<h2>Testovací dokument pro vkládání<\/h2>\s*<h3>Podtitul dokumentu<\/h3>\s*<h2>1\. Formátování textu<\/h2>/.test(o));
        check("odsazene odrazky (jen vetsi okraj) -> vnoreny seznam", /<li>Odrážka 2 s <strong>tučným<\/strong> textem<ul><li>Vnořená 2\.1<ul><li>Vnořená 2\.1\.1<\/li><\/ul><\/li><\/ul><\/li>/.test(o));
        check("cislovany seznam s vnorenim", /<ol><li>Číslovaná 1<\/li><li>Číslovaná 2<ol><li>Vnořená a<\/li><li>Vnořená b<\/li><\/ol><\/li><\/ol>/.test(o));
        check("zarovnani + odsazeni 2 cm (80 px)", o.includes('<p style="text-align: center;">Zarovnáno na střed.</p>') && o.includes('<p style="margin-left: 80px;">Odsazeno zleva o 2 cm.</p>'));
        check("citace -> blockquote", /<blockquote><p[^>]*>Citát ve stylu Citace\.<\/p>/.test(o));
        check("tabulka: tucne zahlavi, zarovnani bunky, slouceni", o.includes("<td><strong>Služba</strong></td>") && o.includes('<p style="text-align: right;">1 500 Kč</p>') && o.includes('colspan="2"'));
        check("VELKA PISMENA stylem -> text", o.includes("VELKÁ PÍSMENA STYLEM"));
        check("skryty text a komentar pryc", !o.includes("skrytý text") && !o.includes("Komentář recenzenta"));
        check("revize bez podtrzeni", o.includes("<p>Vložený text v revizi.</p>"));
        check("textove pole jako odstavec (ne tabulka v tabulce)", o.includes("<p>Text v textovém poli</p>") && !/<table><tbody><tr><td><table>/.test(o));
        check("poznamka pod carou jako horni index", o.includes("<sup>[1]</sup> Text poznámky pod čarou."));
        check("zadne mso / o:p / tridy", !/mso|o:p|class="Mso|font-family/i.test(o));
    }
}

console.log(failed ? `\n${failed} chyb` : "\nvse v poradku");
process.exit(failed ? 1 : 0);

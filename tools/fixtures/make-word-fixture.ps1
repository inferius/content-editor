# Testovaci dokument Wordu pro vkladani do editoru (packages/content-editor/tools/paste-test.mjs).
#
# Vytvori word-test.docx se vsim, co se v dokumentech bezne objevuje, nech Word obsah zkopirovat
# a ulozi skutecna data schranky: word-test.html (HTML Format), word-test.rtf, word-test.txt.
#
#   powershell.exe -STA -ExecutionPolicy Bypass -File make-word-fixture.ps1
#
# Potrebuje nainstalovany Word (COM). Puvodni text schranky se po kopirovani vrati.

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$img = Join-Path $dir "img"
New-Item -ItemType Directory -Force $img | Out-Null

# ------------------------------------------------------------------ obrazky (generovane plochy)

function New-TestImage([string]$path, [int]$w, [int]$h, [string]$label, [System.Drawing.Color]$color, [string]$format) {
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = "AntiAlias"
    $g.Clear($color)
    $g.FillEllipse([System.Drawing.Brushes]::White, [int]($w * 0.3), [int]($h * 0.15), [int]($w * 0.4), [int]($w * 0.4))
    $font = New-Object System.Drawing.Font "Arial", ([Math]::Max(10, [int]($w / 12)))
    $g.DrawString($label, $font, [System.Drawing.Brushes]::White, 10, [int]($h * 0.8))
    $g.Dispose()
    if ($format -eq "png") { $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png) }
    else { $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Jpeg) }
    $bmp.Dispose()
}

$photo1 = Join-Path $img "portrait-1.jpg"
$photo2 = Join-Path $img "landscape-2.jpg"
$photo3 = Join-Path $img "landscape-3.jpg"
$icon = Join-Path $img "icon.png"
$float = Join-Path $img "float.png"
New-TestImage $photo1 150 220 "Foto 1" ([System.Drawing.Color]::FromArgb(70, 110, 60)) "jpg"
New-TestImage $photo2 310 230 "Foto 2" ([System.Drawing.Color]::FromArgb(60, 120, 190)) "jpg"
New-TestImage $photo3 310 230 "Foto 3" ([System.Drawing.Color]::FromArgb(40, 40, 50)) "jpg"
New-TestImage $icon 96 96 "ikona" ([System.Drawing.Color]::FromArgb(208, 49, 45)) "png"
New-TestImage $float 160 120 "obtekany" ([System.Drawing.Color]::FromArgb(123, 63, 184)) "png"

# ------------------------------------------------------------------ dokument

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$doc = $word.Documents.Add()
$sel = $word.Selection

function Rgb([int]$r, [int]$g, [int]$b) { return $r + $g * 256 + $b * 65536 }

# styl odstavce (vestavene styly cislem - nezavisle na jazyku Wordu)
function Style([int]$id) { $sel.Style = $doc.Styles.Item($id) }
$wdNormal = -1; $wdH1 = -2; $wdH2 = -3; $wdH3 = -4; $wdTitle = -63; $wdSubtitle = -75; $wdQuote = -181; $wdIntenseQuote = -182

# text s formatovanim: $fmt dostane rozsah napsaneho textu
function Run([string]$text, [scriptblock]$fmt = $null) {
    $start = $sel.Start
    $sel.TypeText($text)
    if ($fmt) {
        $r = $doc.Range($start, $sel.Start)
        & $fmt $r
        $sel.Font.Reset()
    }
}
function Para() { $sel.TypeParagraph() }
function ResetPara() {
    Style $wdNormal
    $sel.ParagraphFormat.Alignment = 0
    $sel.ParagraphFormat.LeftIndent = 0
    $sel.ParagraphFormat.FirstLineIndent = 0
    $sel.Range.ListFormat.RemoveNumbers()
    $sel.Font.Reset()
}

# --- nadpisy
Style $wdTitle; Run "Testovací dokument pro vkládání"; Para
Style $wdSubtitle; Run "Podtitul dokumentu"; Para
Style $wdH1; Run "1. Formátování textu"; Para
ResetPara
Run "Běžný text s "; Run "tučným" { param($r) $r.Font.Bold = 1 }; Run ", "; Run "kurzívou" { param($r) $r.Font.Italic = 1 }
Run ", "; Run "podtržením" { param($r) $r.Font.Underline = 1 }; Run ", "; Run "přeškrtnutím" { param($r) $r.Font.StrikeThrough = 1 }
Run ", m"; Run "2" { param($r) $r.Font.Superscript = 1 }; Run " a H"; Run "2" { param($r) $r.Font.Subscript = 1 }; Run "O."; Para
Run "Barvy: "; Run "tmavě červená" { param($r) $r.Font.Color = (Rgb 192 0 0) }; Run ", "
Run "modrá" { param($r) $r.Font.Color = (Rgb 0 112 192) }; Run ", "; Run "zelená" { param($r) $r.Font.Color = (Rgb 0 176 80) }; Run ", "
Run "oranžová" { param($r) $r.Font.Color = (Rgb 237 125 49) }; Run ", "; Run "šedá" { param($r) $r.Font.Color = (Rgb 118 113 113) }; Run ", "
Run "zvýrazněná žlutě" { param($r) $r.HighlightColorIndex = 7 }; Run ", "; Run "tučná červená" { param($r) $r.Font.Bold = 1; $r.Font.Color = (Rgb 255 0 0) }; Run "."; Para
Run "Písmo: "; Run "Times New Roman 14" { param($r) $r.Font.Name = "Times New Roman"; $r.Font.Size = 14 }; Run ", "
Run "VELKÁ PÍSMENA STYLEM" { param($r) $r.Font.AllCaps = 1 }; Run ", "; Run "kapitálky" { param($r) $r.Font.SmallCaps = 1 }; Run ", "
Run "skrytý text" { param($r) $r.Font.Hidden = 1 }; Run "konec."; Para
Run "Falešný nadpis (tučně 16 pt, bez stylu)" { param($r) $r.Font.Bold = 1; $r.Font.Size = 16 }; Para
Run "Odkaz na "; $s = $sel.Start; $sel.TypeText("web myTimi"); $doc.Hyperlinks.Add($doc.Range($s, $sel.Start), "https://www.mytimi.cz/") | Out-Null
Run " a e-mail "; $s = $sel.Start; $sel.TypeText("info@mytimi.cz"); $doc.Hyperlinks.Add($doc.Range($s, $sel.Start), "mailto:info@mytimi.cz") | Out-Null
Run "."; Para
# ceske uvozovky skladat z kodu - PowerShell je bere jako oddelovace retezce
Run ("Znaky: " + [char]0x201E + "české uvozovky" + [char]0x201C + ", " + [char]0x201A + "jednoduché" + [char]0x2018 + ", pomlčka " + [char]0x2013 + " a " + [char]0x2014 + ", výpustka" + [char]0x2026 + ", nezlomitelná" + [char]0xA0 + "mezera, " + [char]0xD7 + ", " + [char]0xA9 + ", " + [char]0x20AC + ", 10" + [char]0xA0 + "%."); Para
Run ("Řádek před zalomením" + [char]11 + "řádek po zalomení (Shift+Enter)."); Para
Run "Poznámka pod čarou"; $doc.Footnotes.Add($sel.Range, [Type]::Missing, "Text poznámky pod čarou.") | Out-Null; Run " v textu."; Para
$s = $sel.Start; Run "Text s komentářem."; $doc.Comments.Add($doc.Range($s, $sel.Start), "Komentář recenzenta") | Out-Null; Para

# --- zarovnani a odsazeni
Style $wdH1; Run "2. Odstavce"; Para
ResetPara
$sel.ParagraphFormat.Alignment = 1; Run "Zarovnáno na střed."; Para
$sel.ParagraphFormat.Alignment = 2; Run "Zarovnáno vpravo."; Para
$sel.ParagraphFormat.Alignment = 3; Run "Zarovnáno do bloku - delší text, aby bylo zarovnání vidět na více řádcích. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua."; Para
$sel.ParagraphFormat.Alignment = 0
$sel.ParagraphFormat.LeftIndent = 56.7; Run "Odsazeno zleva o 2 cm."; Para
$sel.ParagraphFormat.LeftIndent = 0; $sel.ParagraphFormat.FirstLineIndent = 28.35; Run "Odsazený první řádek odstavce, pokračování textu na další řádky, aby bylo odsazení vidět."; Para
$sel.ParagraphFormat.FirstLineIndent = 0
Para
Para
Run "Po dvou prázdných odstavcích."; Para
Style $wdQuote; Run "Citát ve stylu Citace."; Para
Style $wdIntenseQuote; Run "Výrazný citát."; Para
ResetPara

# --- seznamy
Style $wdH2; Run "2.1 Seznamy"; Para
ResetPara
$sel.Range.ListFormat.ApplyBulletDefault()
Run "Odrážka 1"; Para
Run "Odrážka 2 s "; Run "tučným" { param($r) $r.Font.Bold = 1 }; Run " textem"; Para
$sel.Range.ListFormat.ListIndent(); Run "Vnořená 2.1"; Para
$sel.Range.ListFormat.ListIndent(); Run "Vnořená 2.1.1"; Para
$sel.Range.ListFormat.ListOutdent(); $sel.Range.ListFormat.ListOutdent(); Run "Odrážka 3"; Para
$sel.Range.ListFormat.RemoveNumbers()
Run "Text mezi seznamy."; Para
$sel.Range.ListFormat.ApplyNumberDefault()
Run "Číslovaná 1"; Para
Run "Číslovaná 2"; Para
$sel.Range.ListFormat.ListIndent(); Run "Vnořená a"; Para
Run "Vnořená b"; Para
$sel.Range.ListFormat.ListOutdent(); Run "Číslovaná 3"; Para
$sel.Range.ListFormat.RemoveNumbers()

# --- tabulka
Style $wdH2; Run "2.2 Tabulka"; Para
ResetPara
$t = $doc.Tables.Add($sel.Range, 4, 3)
$t.Borders.Enable = 1
$data = @(@("Služba", "Cena", "Poznámka"), @("Konzultace", "1 500 Kč", "za hodinu"), @("Audit", "12 000 Kč", "jednorázově"), @("Celkem", "", "13 500 Kč"))
for ($r = 1; $r -le 4; $r++) { for ($c = 1; $c -le 3; $c++) { $t.Cell($r, $c).Range.Text = $data[$r - 1][$c - 1] } }
$t.Rows.Item(1).Range.Font.Bold = 1
$t.Rows.Item(1).Shading.BackgroundPatternColor = (Rgb 222 234 246)
$t.Cell(2, 2).Range.ParagraphFormat.Alignment = 2
$t.Cell(3, 2).Range.ParagraphFormat.Alignment = 2
$t.Cell(2, 3).Range.Font.Color = (Rgb 192 0 0)
$t.Cell(4, 1).Merge($t.Cell(4, 2))
$sel.EndKey(6) | Out-Null
Para

# --- obrazky (jako v dokumentu se jmeny: text, tabulatory, obrazek v radku)
Style $wdH1; Run "3. Obrázky"; Para
ResetPara
Run "Jana Nováková`t`t"; $p = $sel.InlineShapes.AddPicture($photo1); $p.Width = 129; $p.Height = 189; $p.AlternativeText = "Portrét 1"; Para
Run "Petra Svobodová`t`t`t"; $p = $sel.InlineShapes.AddPicture($photo2); $p.Width = 265.5; $p.Height = 197; $p.AlternativeText = "Foto 2"; Para
Run "Eva Dvořáková`t`t`t`t"; $p = $sel.InlineShapes.AddPicture($photo3); $p.Width = 267; $p.Height = 198; Para
$sel.ParagraphFormat.Alignment = 1; $p = $sel.InlineShapes.AddPicture($icon); $p.Width = 36; $p.Height = 36; Run " Ikona na středu s textem"; Para
$sel.ParagraphFormat.Alignment = 0
Run "Obtékaný obrázek vpravo: Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation."
$shape = $doc.Shapes.AddPicture($float, $false, $true, 300, 0, 120, 90, $sel.Range)
$shape.WrapFormat.Type = 0
Para
$tb = $doc.Shapes.AddTextbox(1, 0, 0, 200, 50, $sel.Range)
$tb.TextFrame.TextRange.Text = "Text v textovém poli"
Run "Odstavec s textovým polem."; Para

# --- revize
Style $wdH1; Run "4. Revize"; Para
ResetPara
$doc.TrackRevisions = $true
Run "Vložený text v revizi."; Para
$doc.TrackRevisions = $false
Run "Konec dokumentu."

$docx = Join-Path $dir "word-test.docx"
$doc.SaveAs2([string]$docx, 16)

# ------------------------------------------------------------------ zkopirovat a ulozit schranku

$old = $null
try { if ([System.Windows.Forms.Clipboard]::ContainsText()) { $old = [System.Windows.Forms.Clipboard]::GetText() } } catch { }

$doc.Content.Copy()
Start-Sleep -Milliseconds 500
$data = [System.Windows.Forms.Clipboard]::GetDataObject()
$html = $data.GetData("HTML Format")
$rtf = $data.GetData("Rich Text Format")
$txt = $data.GetData("UnicodeText")

# CF_HTML je UTF-8, ale .NET ho vrati dekodovany jako ANSI - vratit bajty a dekodovat znovu.
# Hlavicka "Version:...StartHTML:000123..." - prohlizec dava obsah od StartHTML (offset v bajtech).
if ($html -match "StartHTML:(\d+)") {
    $bytes = [System.Text.Encoding]::Default.GetBytes($html)
    $start = [int]$Matches[1]
    $html = [System.Text.Encoding]::UTF8.GetString($bytes, $start, $bytes.Length - $start)
}
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText((Join-Path $dir "word-test.html"), $html, $utf8)
[System.IO.File]::WriteAllText((Join-Path $dir "word-test.rtf"), $rtf, $utf8)
[System.IO.File]::WriteAllText((Join-Path $dir "word-test.txt"), $txt, $utf8)

$doc.Close([ref]0)
$word.Quit()

if ($old -ne $null) { [System.Windows.Forms.Clipboard]::SetText($old) } else { [System.Windows.Forms.Clipboard]::Clear() }

"docx: $docx"
"html: " + $html.Length + " znaku, rtf: " + $rtf.Length + " znaku"

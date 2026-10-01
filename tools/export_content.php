<?php
/**
 * Export HTML obsahu z DB pro test tam a zpet (tools/roundtrip.mjs).
 * Vsechny textove sloupce tabulek _front_* s HTML (jen SHOW TABLES / SHOW COLUMNS).
 *
 *   php tools/export_content.php [vystup.json]
 */

$root = dirname(__DIR__, 3);
require $root . "/admin/config.inc.php";
$db = $config["db"];
$pdo = new PDO(
    "mysql:host={$db["host"]};port=" . (int)($db["port"] ?? 3306) . ";dbname={$db["dbname"]};charset=utf8mb4",
    $db["user"], $db["password"], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION],
);

$out = [];
foreach ($pdo->query("SHOW TABLES LIKE '\\_front\\_%'")->fetchAll(PDO::FETCH_COLUMN) as $table) {
    // data mimo editor (JSON z YouTube API)
    if ($table === "_front_youtube_videos") continue;
    $cols = [];
    foreach ($pdo->query("SHOW COLUMNS FROM `$table`") as $c) {
        if (preg_match('~^(text|mediumtext|longtext)$~i', $c["Type"])) $cols[] = $c["Field"];
    }
    $hasId = in_array("id", array_column($pdo->query("SHOW COLUMNS FROM `$table`")->fetchAll(), "Field"), true);
    foreach ($cols as $col) {
        $rows = $pdo->query("SELECT " . ($hasId ? "id" : "NULL AS id") . ", `$col` AS html FROM `$table` WHERE `$col` LIKE '%<%'");
        foreach ($rows as $r) $out[] = ["table" => $table, "column" => $col, "id" => $r["id"], "html" => $r["html"]];
    }
}

$file = $argv[1] ?? __DIR__ . "/.data/content.json";
@mkdir(dirname($file), 0755, true);
file_put_contents($file, json_encode($out, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE));
echo count($out) . " polozek -> $file\n";

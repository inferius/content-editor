/** Pluginy editoru: klavesy, rychle zapisy, historie, tabulky, placeholder. */
import { keymap } from "prosemirror-keymap";
import { history, undo, redo } from "prosemirror-history";
import { baseKeymap, chainCommands, exitCode } from "prosemirror-commands";
import { inputRules, wrappingInputRule, InputRule } from "prosemirror-inputrules";
import { splitListItem } from "prosemirror-schema-list";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import { tableEditing, goToNextCell } from "prosemirror-tables";
import { Plugin, TextSelection, type Command } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { schema } from "../core/schema";
import { isEmptyDoc } from "../core/html";
import * as cmd from "./commands";
import type { Features } from "./features";
import { VAR_PATTERN } from "../core/vartext";

const n = schema.nodes;

const hardBreak: Command = chainCommands(exitCode, (state, dispatch) => {
    if (dispatch) dispatch(state.tr.replaceSelectionWith(n.hard_break.create()).scrollIntoView());
    return true;
});

function rules(f: Features): Plugin {
    const list: InputRule[] = [];
    // "## " -> nadpis 2, "### " -> 3, "#### " -> 4 (jen povolene urovne)
    if (f.has("headings")) {
        list.push(new InputRule(/^(#{1,6})\s$/, (state, m, start, end) => {
            const level = m[1].length;
            if (!f.heading(level)) return null;
            const $s = state.doc.resolve(start);
            if (!$s.node(-1).canReplaceWith($s.index(-1), $s.indexAfter(-1), n.heading)) return null;
            return state.tr.delete(start, end).setBlockType(start, start, n.heading, { level });
        }));
    }
    if (f.has("lists")) {
        list.push(
            wrappingInputRule(/^\s*([-+*])\s$/, n.bullet_list),
            wrappingInputRule(/^(\d+)\.\s$/, n.ordered_list, (m) => ({ order: +m[1] }), (m, node) => node.childCount + node.attrs.order === +m[1]),
        );
    }
    if (f.has("quote")) list.push(wrappingInputRule(/^\s*>\s$/, n.blockquote));
    if (f.has("hr")) {
        // "---" jako cely odstavec -> vodorovna cara a za ni novy odstavec
        list.push(new InputRule(/^---$/, (state, _m, start) => {
            const $s = state.doc.resolve(start);
            if ($s.parent.type !== n.paragraph || $s.depth !== 1) return null;
            const before = $s.before();
            const tr = state.tr.replaceWith(before, $s.after(), [n.horizontal_rule.create(), n.paragraph.create()]);
            return tr.setSelection(TextSelection.create(tr.doc, before + 2));
        }));
    }
    // dopsany zapis {$nazev} / {$nazev:"x"} -> promenna (cip)
    list.push(new InputRule(new RegExp(VAR_PATTERN + "$"), (state, m, start, end) => {
        const $s = state.doc.resolve(start);
        if (!$s.parent.type.contentMatch.matchType(n.variable) || $s.parent.type.spec.code) return null;
        // bez formatovani - promenna se uklada jako cisty kod
        const node = n.variable.create({ name: m[1], args: m[2] === undefined ? null : m[2] });
        return state.tr.replaceWith(start, end, node);
    }));
    return inputRules({ rules: list });
}

export interface KeyHandlers {
    openLink(): void;
}

export function buildPlugins(keys: KeyHandlers, placeholder: string, f: Features): Plugin[] {
    const headingKeys: Record<string, Command> = {};
    for (const level of [2, 3, 4]) if (f.heading(level)) headingKeys["Mod-Alt-" + level] = cmd.setHeading(level);
    return [
        rules(f),
        keymap({
            "Mod-z": undo,
            "Mod-y": redo,
            "Shift-Mod-z": redo,
            ...(f.has("bold") ? { "Mod-b": cmd.toggleBold } : { "Mod-b": () => true }),
            ...(f.has("italic") ? { "Mod-i": cmd.toggleItalic } : { "Mod-i": () => true }),
            ...(f.has("underline") ? { "Mod-u": cmd.toggleUnderline } : { "Mod-u": () => true }),
            "Mod-k": () => { if (f.has("link")) keys.openLink(); return true; },
            "Shift-Enter": hardBreak,
            "Enter": splitListItem(n.list_item),
            "Tab": chainCommands(goToNextCell(1), cmd.indent(1)),
            "Shift-Tab": chainCommands(goToNextCell(-1), cmd.indent(-1)),
            "Mod-Alt-0": cmd.setParagraph,
            ...headingKeys,
            // nezlomitelna mezera (predlozky, cisla s jednotkami)
            ...(f.has("nbsp") ? { "Mod-Shift-Space": cmd.insertText("\u00a0") } : {}),
        }),
        keymap(baseKeymap),
        dropCursor({ color: "var(--ce-accent)", width: 3 }),
        gapCursor(),
        history({ depth: 200 }),
        // uchyt tabulky (ui/tabletools.ts) oznaci celou tabulku jako uzel - jde smazat, kopirovat, presunout
        tableEditing({ allowTableNodeSelection: true }),
        placeholderPlugin(placeholder),
    ];
}

function placeholderPlugin(text: string): Plugin {
    return new Plugin({
        props: {
            decorations(state) {
                if (!isEmptyDoc(state.doc)) return null;
                return DecorationSet.create(state.doc, [
                    Decoration.node(0, state.doc.firstChild!.nodeSize, { class: "ce-placeholder", "data-placeholder": text }),
                ]);
            },
        },
    });
}

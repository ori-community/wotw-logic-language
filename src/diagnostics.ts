import * as vscode from 'vscode';

import { ParseFailure, Token } from "./parser";

function name(thing: string | Token): string {
    if (typeof thing === "string") {
        return `"${thing}"`;
    }
    return Token[thing];
}
function errorMessage(parseFailure: ParseFailure): string {
    const expected = parseFailure.expected;
    if (Array.isArray(expected)) {
        return `expected either ${expected.map(thing => name(thing)).join(" or ")}`;
    }
    return `expected ${name(expected)}`;
}

export function diagnose(document: vscode.TextDocument, parseFailure: ParseFailure): vscode.Diagnostic {
    let range;
    const status = parseFailure.status;
    const offset = status.offset;
    const errorOffset = status.errorOffset;
    if (errorOffset !== undefined) {
        const start = document.positionAt(offset - errorOffset);
        const end = document.positionAt(offset);
        range = new vscode.Range(start, end);
    } else {
        const position = document.positionAt(offset);
        range = document.getWordRangeAtPosition(position) || new vscode.Range(position, position.translate(undefined, 1));
    }

    const message = errorMessage(parseFailure);

    return new vscode.Diagnostic(range, message);
}

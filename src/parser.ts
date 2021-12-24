import * as vscode from 'vscode';

import { AmountRequirement, Enemy, Requirement } from "./requirement";

export class ParseStatus {
    remaining: string;
    offset: number;
    errorOffset: number | undefined;
    indentStack: number[];
    unknownRequirements: [string, number][];
    states: string[];

    constructor(input: string) {
        this.remaining = input;
        this.offset = 0;
        this.errorOffset = undefined;
        this.indentStack = [0];
        this.unknownRequirements = [];
        this.states = [];
    }

    progress(offset: number) {
        this.remaining = this.remaining.slice(offset);
        this.offset += offset;
    }
}

export enum Token {
    lineBreak,
    indent,
    dedent,
    word,
    identifier,
    integer,
    float,
    requirement,
    amountRequirement,
    requirementSeparator,
    enemy,
}

interface ParseSuccess<Result> {
    success: true,
    result: Result,
}
function succeed<Result>(result: Result): ParseSuccess<Result> {
    return {
        success: true,
        result,
    };
}
export interface ParseFailure {
    success: false,
    expected: Token[] | Token | string[] | string,
    status: ParseStatus,
}
function fail(expected: Token[] | Token | string[] | string, status: ParseStatus): ParseFailure {
    return {
        success: false,
        expected,
        status,
    };
}
type ParseResult<Result> = ParseSuccess<Result> | ParseFailure;

function eat(status: ParseStatus, eat: string): boolean {
    const remaining = status.remaining;

    if (remaining.startsWith(eat)) {
        status.progress(eat.length);
        return true;
    } else {
        return false;
    }
}

function parseNumber(status: ParseStatus, regex: RegExp): number | null {
    const remaining = status.remaining;

    const match = remaining.match(regex);
    if (match === null) { return null; }

    status.progress(match[0].length);
    return +match[0];
}
function parseInteger(status: ParseStatus, signed: boolean = false): number | null {
    let regex;
    if (signed) {
        regex = /^-?\d+/;
    } else {
        regex = /^\d+/;
    }

    return parseNumber(status, regex);
}
function parseFloat(status: ParseStatus): number | null {
    return parseNumber(status, /^-?\d+(?:\.\d+)?/);
}
function parseString(status: ParseStatus, regex: RegExp): string | null {
    const match = status.remaining.match(regex);
    if (match === null) { return null; }

    status.progress(match[0].length);
    return match[0];
}
function parseWord(status: ParseStatus): string | null {
    return parseString(status, /^\w+/);
}
function parseLogicIdentifier(status: ParseStatus): string | null {
    return parseString(status, /^\w+(\.\w+)?/);
}
function parseComment(status: ParseStatus): string | null {
    return parseString(status, /^(\s*?#.*)+/);
}
function parseLineBreak(status: ParseStatus): string | null {
    parseComment(status);
    return parseString(status, /^(\s*?(\r\n|\r|\n|\z))+/);
}
function parseSpaces(status: ParseStatus): string | null {
    return parseString(status, /^ */);
}
function parseFree(status: ParseStatus): string | null {
    return parseString(status, /^\s*free/);
}
function checkSpaces(status: ParseStatus): number {
    const match = status.remaining.match(/ */);
    if (match === null) { return 0; }
    return match[0].length;
}

function parseIndent(status: ParseStatus): ParseResult<number> {
    if (parseLineBreak(status) === null) { return fail(Token.lineBreak, status); }

    const indent = parseSpaces(status)?.length;
    if (indent === undefined) { return fail(Token.indent, status); }

    const indentStack = status.indentStack;
    const lastIndent = indentStack[indentStack.length - 1] || 0;
    if (indent <= lastIndent) { return fail(Token.indent, status); }
    indentStack.push(indent);

    return succeed(indent);
}

function parseCombat(status: ParseStatus): ParseResult<undefined> {
    do {
        const amount = parseInteger(status);
        if (amount !== null) {
            if (!eat(status, "x")) { return fail("x", status); }
        }

        const enemy = parseWord(status);
        if (enemy === null || !(enemy in Enemy)) { return fail(Token.enemy, status); }
    } while (eat(status, "+"));

    return succeed(undefined);
}

function parseRequirementLine(status: ParseStatus): ParseResult<undefined> {
    while (true) {
        const offset = status.offset;

        const match = status.remaining.match(/^(?:(Combat=)|(\w+?)=|(\w+(?:\.\w+)?))/);
        if (match === null) { return fail(Token.requirement, status); }
        const length = match[0].length;
        status.progress(length);

        const combat = match[1];
        if (combat !== undefined) {
            const combat = parseCombat(status);
            if (!combat.success) { return combat; }
        } else {
            const amountRequirement = match[2];
            if (amountRequirement !== undefined) {
                if (!(amountRequirement in AmountRequirement)) {
                    status.errorOffset = length;
                    return fail(Token.amountRequirement, status);
                }
                if (parseInteger(status) === null) { return fail(Token.integer, status); }
            } else {
                const requirement = match[3];
                if (requirement === undefined) { return fail(Token.requirement, status); }
                if (!(requirement in Requirement)) { status.unknownRequirements.push([requirement, offset]); }
            }
        }

        if (status.remaining.match(/^:\s*?(#.*)?(\r\n|\r|\n)/) !== null) {
            return parseRequirementGroup(status);
        }

        if (eat(status, ":") || eat(status, ",")) {
           eat(status, " ");
        } else if (!eat(status, " OR ")) {
            if (parseLineBreak(status) === null) { return fail(Token.requirementSeparator, status); }
            return succeed(undefined);
        }
    }
}
function parseRequirementGroup(status: ParseStatus): ParseResult<undefined> {
    if (!eat(status, ":")) { return fail(":", status); }

    if (parseFree(status) !== null) {
        if (parseLineBreak(status) === null) { return fail(Token.lineBreak, status); }
        return succeed(undefined);
    }

    const indentResult = parseIndent(status);
    if (!indentResult.success) { return indentResult; }
    const indent = indentResult.result;

    while (true) {
        const line = parseRequirementLine(status);
        if (!line.success) { return line; }

        const nextIndent = checkSpaces(status);
        if (nextIndent > indent) { return fail([Token.lineBreak, Token.dedent], status); }
        if (nextIndent < indent) {
            let priorIndent;
            do {
                priorIndent = status.indentStack.pop() || 0;
                if (priorIndent < indent) { return fail([Token.lineBreak, Token.dedent], status); }
            } while (priorIndent > indent);
            return succeed(undefined);
        }
        status.progress(indent);
    }
}

function parseDefinition(status: ParseStatus): ParseResult<undefined> {
    if (!eat(status, " ")) { return fail(" ", status); }

    const identifier = parseWord(status);
    if (identifier === null) { return fail(Token.word, status); }

    status.states.push(identifier);

    return parseRequirementGroup(status);
}

function parseRegion(status: ParseStatus): ParseResult<undefined> {
    if (!eat(status, " ")) { return fail(" ", status); }

    const identifier = parseWord(status);
    if (identifier === null) { return fail(Token.word, status); }

    return parseRequirementGroup(status);
}

function parseRefill(status: ParseStatus): ParseResult<undefined> {
    if (!eat(status, " ")) { return fail(" ", status); }

    const keyword = parseWord(status);
    if (keyword === null) { return fail(["Full", "Checkpoint", "Health", "Energy"], status); }

    switch(keyword) {
        case "Full":
        case "Checkpoint":
            break;
        case "Health":
        case "Energy":
            if (!eat(status, "=")) { return fail("=", status); }
            if (parseInteger(status) === null) { return fail(Token.integer, status); }
            break;
        default: return fail(["Full", "Checkpoint", "Health", "Energy"], status);
    }

    if (status.remaining.startsWith(":")) {
        const requirement = parseRequirementGroup(status);
        if (!requirement.success) { return requirement; }
        return succeed(undefined);
    }

    if (parseLineBreak(status) === null) { return fail(Token.lineBreak, status); }
    return succeed(undefined);
}
function parseConnection(status: ParseStatus, state: boolean = false): ParseResult<undefined> {
    if (!eat(status, " ")) { return fail(" ", status); }

    const identifier = parseLogicIdentifier(status);
    if (identifier === null) { return fail(Token.word, status); }

    if (state) {
        status.states.push(identifier);
    }

    return parseRequirementGroup(status);
}
function parseAnchor(status: ParseStatus): ParseResult<undefined> {
    if (!eat(status, " ")) { return fail(" ", status); }

    const identifier = parseLogicIdentifier(status);
    if (identifier === null) { return fail(Token.word, status); }

    if (eat(status, " ")) {
        if (!eat(status, "at")) { return fail("at", status); }
        if (!eat(status, " ")) { return fail(" ", status); }
        if (parseFloat(status) === null) { return fail(Token.float, status); }
        if (!eat(status, ",")) { return fail(",", status); }
        eat(status, " ");
        if (parseFloat(status) === null) { return fail(Token.float, status); }
    }

    if (!eat(status, ":")) { return fail(":", status); }

    const indentResult = parseIndent(status);
    if (!indentResult.success) { return indentResult; }
    const indent = indentResult.result;

    while (true) {
        const keyword = parseWord(status);
        if (keyword === null) { return fail(["refill", "state", "quest", "pickup", "conn"], status); }

        switch(keyword) {
            case "refill":
                const refill = parseRefill(status);
                if (!refill.success) { return refill; }
                break;
            case "state":
            case "quest": {
                const connection = parseConnection(status, true);
                if (!connection.success) { return connection; }
                break;
            } case "pickup":
            case "conn": {
                const connection = parseConnection(status);
                if (!connection.success) { return connection; }
                break;
            } default: return fail(["refill", "state", "quest", "pickup", "conn"], status);
        }

        const nextIndent = checkSpaces(status);
        if (nextIndent > indent) { return fail([Token.lineBreak, Token.dedent], status); }
        if (nextIndent < indent) {
            status.indentStack.pop();
            return succeed(undefined);
        }
        status.progress(indent);
    }
}

function parseExpression(status: ParseStatus): ParseResult<undefined> {
    const keyword = parseWord(status);
    if (keyword === null) { return fail(["requirement", "anchor"], status); }

    switch(keyword) {
        case "requirement": return parseDefinition(status);
        case "region": return parseRegion(status);
        case "anchor": return parseAnchor(status);
        default: return fail(["requirement", "anchor"], status);
    }
}

export function parseLogic(status: ParseStatus): ParseResult<undefined> {
    while (true) {
        if (parseLineBreak(status) !== null) { continue; }
        if (status.remaining.length === 0) { break; }

        const expression = parseExpression(status);
        if (!expression.success) { return expression; }
    }

    const states = status.states;
    for (const [unknownRequirement, offset] of status.unknownRequirements) {
        if (!states.includes(unknownRequirement)) {
            status.offset = offset;
            return fail(Token.requirement, status);
        }
    }

    return succeed(undefined);
}

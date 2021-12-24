import * as vscode from 'vscode';
import { diagnose } from './diagnostics';
import { parseLogic, ParseStatus } from './parser';

const definitionRegEx = /\n(anchor|region|requirement|  state|  quest)\s+(\w+(\.\w+)?)/;

const filePattern = "**/*.wotw";

class LogicDefinitionProvider implements vscode.DefinitionProvider {
    provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
        const wordRange = document.getWordRangeAtPosition(position);
        if (wordRange === undefined) { return undefined; }
        const word = document.getText(wordRange);

        let text = document.getText();
        let totalOffset = 0;

        while (true) {
            const potentialDefinition = text.match(definitionRegEx);
            if (potentialDefinition?.index === undefined) { return undefined; }

            if (potentialDefinition[2] === word) {
                const position = document.positionAt(potentialDefinition.index + potentialDefinition[1].length + 2 + totalOffset);

                return new vscode.Location(document.uri, position);
            }

            const offset = potentialDefinition.index + potentialDefinition[0].length;
            totalOffset += offset;
            text = text.slice(offset);
        }
    }
}

async function provideDiagnostics(collection: vscode.DiagnosticCollection) {
    const files = await vscode.workspace.findFiles(filePattern);
    for (const uri of files) {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            updateDiagnostics(document, collection);
        } catch (e) {
            console.warn(e);
        }
    }
}
function updateDiagnostics(document: vscode.TextDocument, collection: vscode.DiagnosticCollection) {
    let diagnostics: vscode.Diagnostic[] = [];

    const status: ParseStatus = new ParseStatus(document.getText());

    while (true) {
        const logicResult = parseLogic(status);
        if (logicResult.success) { break; }

        diagnostics.push(diagnose(document, logicResult));

        const newEntry = status.remaining.match(/(\r\n|\r|\n)(anchor|requirement|region)/);
        const index = newEntry?.index;
        if (index === undefined) { break; }

        status.progress(index);
        status.errorOffset = undefined;
        status.indentStack = [];
    }

    collection.set(document.uri, diagnostics);
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.languages.registerDefinitionProvider("ori-wotw-logic", new LogicDefinitionProvider));

    const diagnosticsCollection = vscode.languages.createDiagnosticCollection("ori-wotw-logic");
    context.subscriptions.push(diagnosticsCollection);

    provideDiagnostics(diagnosticsCollection);

    vscode.workspace.onDidOpenTextDocument(event => {
        if (vscode.languages.match({ language: "ori-wotw-logic" }, event) > 0) {
            updateDiagnostics(event, diagnosticsCollection);
        }
    });
    vscode.workspace.onDidChangeTextDocument(event => {
        const document = event.document;
        if (vscode.languages.match({ language: "ori-wotw-logic" }, document) > 0) {
            updateDiagnostics(event.document, diagnosticsCollection);
        }
    });
    vscode.workspace.onDidDeleteFiles(event => {
        for (const file of event.files) {
            diagnosticsCollection.delete(file);
        }
    });
}

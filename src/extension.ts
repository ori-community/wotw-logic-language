import * as vscode from 'vscode';

const definitionRegEx = /\n(anchor|region|requirement|  state|  quest)\s+(\w+(\.\w+)?)/;

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

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.languages.registerDefinitionProvider("ori-wotw-logic", new LogicDefinitionProvider));
}

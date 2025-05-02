import * as vscode from "vscode";
import { SidebarProvider } from "./sidebar/SidebarProvider"; // Import the provider

export function activate(context: vscode.ExtensionContext) {
	// context is provided here
	console.log(
		'Congratulations, your extension "minovative-mind-vscode" is now active!'
	);

	// Create a new instance of the SidebarProvider, passing the context
	const sidebarProvider = new SidebarProvider(context.extensionUri, context); // Pass context

	// Register the SidebarProvider with the view
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			SidebarProvider.viewType, // Use static property for consistency
			sidebarProvider
		)
	);

	// Example: Register a placeholder command (we'll implement later)
	// let disposable = vscode.commands.registerCommand('minovative-mind-vscode.helloWorld', () => {
	//  vscode.window.showInformationMessage('Hello World from Minovative Mind!');
	// });
	// context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}

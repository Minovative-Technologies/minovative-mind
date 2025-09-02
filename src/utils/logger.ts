export class Logger {
	private source: string;

	constructor(source: string) {
		this.source = source;
	}

	private getPrefix(modelName: string | undefined): string {
		return modelName ? `${this.source} (${modelName}):` : `${this.source}:`;
	}

	log(modelName: string | undefined, message: string, ...args: any[]): void {
		console.log(this.getPrefix(modelName), message, ...args);
	}

	warn(modelName: string | undefined, message: string, ...args: any[]): void {
		console.warn(this.getPrefix(modelName), message, ...args);
	}

	error(modelName: string | undefined, message: string, ...args: any[]): void {
		console.error(this.getPrefix(modelName), message, ...args);
	}
}

export const geminiLogger = new Logger("Gemini");

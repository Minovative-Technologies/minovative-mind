export function cleanCodeOutput(codeString: string): string {
	if (!codeString) {
		return "";
	}
	return codeString
		.replace(/^```(?:\w+)?\n*/, "")
		.replace(/\n*```$/, "")
		.trim();
}

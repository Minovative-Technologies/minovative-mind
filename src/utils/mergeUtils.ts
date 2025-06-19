export function hasMergeConflicts(fileContent: string): boolean {
	const conflictMarkers = [
		/<{7} /g,
		/=+/g,
		/>{7} /g,
		/\|{7} /g, // For common ancestor marker
	];
	return conflictMarkers.some((regex) => regex.test(fileContent));
}

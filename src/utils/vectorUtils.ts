export function calculateCosineSimilarity(
	vec1: number[],
	vec2: number[]
): number {
	// Input validation: Check for null/undefined or empty vectors
	if (!vec1 || !vec2 || vec1.length === 0 || vec2.length === 0) {
		console.warn(
			"[VectorUtils] calculateCosineSimilarity: One or both vectors are empty or null. Returning 0."
		);
		return 0;
	}

	// Input validation: Check if vectors have the same length
	if (vec1.length !== vec2.length) {
		console.warn(
			"[VectorUtils] calculateCosineSimilarity: Vectors have different lengths. Returning 0."
		);
		return 0;
	}

	let dotProduct = 0;
	let magnitude1 = 0;
	let magnitude2 = 0;

	// Calculate dot product and squared magnitudes in a single loop for efficiency
	for (let i = 0; i < vec1.length; i++) {
		dotProduct += vec1[i] * vec2[i];
		magnitude1 += vec1[i] * vec1[i]; // sum of squares for vec1
		magnitude2 += vec2[i] * vec2[i]; // sum of squares for vec2
	}

	// Calculate actual magnitudes (Euclidean norm)
	magnitude1 = Math.sqrt(magnitude1);
	magnitude2 = Math.sqrt(magnitude2);

	// Handle division by zero: If either magnitude is zero, cosine similarity is undefined.
	// In this context, it effectively means the vectors are "zero vectors" and have no direction.
	// Returning 0 is a common graceful handling for such cases.
	if (magnitude1 === 0 || magnitude2 === 0) {
		console.warn(
			"[VectorUtils] calculateCosineSimilarity: One or both vector magnitudes are zero. Returning 0."
		);
		return 0;
	}

	// Calculate cosine similarity
	return dotProduct / (magnitude1 * magnitude2);
}

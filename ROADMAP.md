# Minovative Mind Project Roadmap (Created by Minovative Mind)

This document outlines ideas to implement for future development for Minovative Mind. It's designed to be a living document, allowing for granular updates and contributions.

## #1 Feature that will make Minovative Mind a even better and top performing AI Agent in the market

Minovative Mind already performs at high levels without surgical edits like GitHub Copilt and Cursor AI, but with surgical edits, Minovative Mind will be even more powerful as ever if implmented correctly.

### Precision Over Power: How Minovative Mind can Master Surgical Code Modifications instead of full file rewrites

#### The Challenge of Full File Rewrites

In AI-assisted code generation, a common approach for modification is to have the AI regenerate the entire file content. While conceptually simple for the AI, this "full file rewrite" strategy presents significant drawbacks:

1. **Increased Risk of Regression:** Regenerating an entire file introduces a higher probability of unintended side effects, breaking existing functionality, or altering parts of the code unrelated to the intended change.
2. **Loss of Context and Fidelity:** AI models, even advanced ones, may struggle to perfectly replicate existing code's subtle nuances, comments, formatting, or unique coding style during a full rewrite. This can lead to a loss of valuable human-added context or a deviation from established project conventions.
3. **Difficult Code Review:** Reviewing a full file rewrite, especially for a minor change, becomes cumbersome. Developers must meticulously compare the entire old and new versions, making it hard to pinpoint the exact AI-introduced modifications.
4. **Performance Overhead:** Generating and processing entire file contents, especially for large files, can be computationally intensive for both the AI model and the local system.
5. **User Interruption:** Frequent, large-scale changes can disrupt a developer's workflow, leading to merge conflicts, unnecessary reformatting, or the need for manual cleanup.

#### The Solution: Surgical Edits via Diff Generation

A "surgical insertion" or "surgical edit" involves applying highly precise, granular changes to the codebase. Instead of replacing the entire file, the AI would be instructed to generate only the necessary additions, deletions, or modifications at specific locations. This can be achieved by having the AI output a structured format like a unified diff or a series of JSON-encoded edit commands.

**Benefits of AI-Generated Surgical Edits:**

1. **Enhanced Safety and Stability:** By focusing only on the specific lines or blocks relevant to the task, the risk of introducing unintended bugs or regressions in unaffected parts of the file is drastically reduced.
2. **Preservation of Existing Code:** Comments, formatting, and other non-functional aspects of the code are better preserved, ensuring the developer's original intent and style are respected.
3. **Streamlined Code Review:** Reviewers can easily see the exact changes proposed by the AI, making the review process faster, more focused, and less error-prone.
4. **Improved Performance:** Transmitting and processing smaller diffs or edit commands is more efficient than handling entire file contents, leading to faster response times.
5. **Reduced Merge Conflicts:** With more targeted changes, the likelihood of encountering merge conflicts when integrating AI-generated code into concurrent development workflows is minimized.

---

#### High-Level Implementation Strategy To Help You Out (Optional)

To shift the AI's output from full file rewrites to surgical edits, the core changes would primarily involve prompt engineering and the AI response parsing logic.

**1. AI Model Interaction & Prompt Engineering:**

- **Instruction to AI:** The most crucial step is to modify the prompts sent to the AI. Instead of asking for "the complete updated content of the file," the prompt would request "a unified diff (or a JSON array of line-based edits) to apply to the existing file."
- **Format Specification:** The prompt must clearly specify the desired output format (e.g., standard Git-style unified diff format).
  - _Example Prompt Snippet:_ "Given the following `original_content` and the `user_instruction`, provide _only_ a unified diff that applies the necessary changes. Do not include any conversational text or explanations. Wrap the diff within `BEGIN_DIFF` and `END_DIFF` markers."
- **Contextual Information:** The AI still needs the full original file content (`currentContent`) as context to understand the current state and generate accurate relative changes.
- **Refinement Prompts:** The `createRefinementPrompt` and `createRefineModificationPrompt` functions would need to adapt. If the AI outputs an invalid diff, the correction prompt should specifically highlight the diff parsing error and reiterate the requirement for a valid diff format.

**2. Modification of `EnhancedCodeGenerator` (`src/ai/enhancedCodeGeneration.ts`):**

- **`_generateModification` Method:** This method (currently responsible for generating the full `modifiedContent` string) would be updated to:
  1. Call the AI with the new diff-generating prompt.
  2. Expect the AI's raw response to be a diff string (e.g., wrapped in `BEGIN_DIFF`/`END_DIFF`).
  3. Extract the raw diff string.
  4. _Crucially_, it would _not_ return `modifiedContent` (the full string) directly, but rather a structure that represents the diff. This could be the raw diff string itself, or parsed `vscode.TextEdit` objects if parsing happens within this method.
- **Internal Diff Application (Implicit):** The `_validateAndRefineModification` method currently uses `generateFileChangeSummary` to compare `originalContent` and `modifiedContent`. If the AI _directly_ generates a diff, this step might become `_validateAndApplyDiff` which parses the AI's diff output, validates it, and attempts to apply it.
- **`_checkPureCodeFormat`:** This method currently checks for `BEGIN_CODE`/`END_CODE`. A new similar method (`_checkPureDiffFormat` or extend this one) would be needed to validate `BEGIN_DIFF`/`END_DIFF` delimiters and the general structure of the diff output.
- **Return Type:** The `modifyFileContent` public method's return type `content: string` might need to be re-evaluated if it's strictly about returning the _final modified content_ after application, or if it should also expose the generated diff.

**3. Leveraging `diffingUtils.ts`:**

- **`generatePreciseTextEdits`:** This function is already perfectly suited for calculating `vscode.TextEdit` objects from an old and new content string. If the AI outputs a full new file, this is what `applyAITextEdits` (likely in `planExecutionService.ts`) would use.
- **`parseDiffHunkToTextEdits`:** If the AI is trained to output standard unified diffs, this existing function could be directly used within `EnhancedCodeGenerator` or `PlanService` to parse the AI's output into `vscode.TextEdit` objects. This would be a more direct "surgical" approach from the AI's output.
- **`applyDiffHunkToDocument`:** This helper could be used to apply the parsed edits.

**4. Integration with `PlanService` (`src/services/planService.ts`):**

- **`_executePlanSteps` (`isModifyFileStep`):** When executing a `ModifyFile` step, the `planService` currently calls `this.enhancedCodeGenerator.modifyFileContent`. The `modifyFileContent` would now conceptually be "diff-aware."
- **`applyAITextEdits`:** This function (which is called in `_executePlanSteps` after `modifyFileContent`) is the key execution point. It would ideally be updated to:
  1. Receive the raw diff string directly from `enhancedCodeGenerator`.
  2. Use `parseDiffHunkToTextEdits` to convert the raw diff into `vscode.TextEdit` objects.
  3. Apply these `TextEdit` objects to the `vscode.TextEditor` using `editor.edit`.

**Challenges and Considerations:**

- **AI Diff Generation Accuracy:** Training the AI to reliably produce perfectly formatted and contextually correct diffs (especially for complex changes) is a non-trivial prompt engineering challenge.
- **Context Window for Diffing:** For large files, the AI still needs the full file content to generate an accurate diff. This means the overall context window size remains important.
- **Partial Diff Application:** What if the AI generates a diff that partially conflicts with the current file state (e.g., if the user made changes locally after the AI's context was captured)? The application logic needs robust conflict resolution or clear error reporting.
- **Debugging AI-Generated Diffs:** Debugging issues with a diff output can be more complex than debugging a full code block. Visual diff tools within VS Code would be essential.

By implementing this feature, your Minovative Mind AI will become a more precise, reliable, and developer-friendly assistant, making its code modifications safer and easier to integrate into existing projects.

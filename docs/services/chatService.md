# ChatService Documentation

## Overview
The `chatService.ts` file is the core of the chatbot's workflow. It handles user questions, classifies them, and coordinates responses using RAG, direct LLM calls, or special commands.

### Workflow
1. **Load/Create Conversation**: Retrieves or starts a new conversation using `storageService`.
2. **Classify Question**: Determines the question type (specific document, legal analysis, general, continuation, special command).
3. **Process Question**:
   - Specific Document: Direct lookup via `retrievalService`.
   - Legal Analysis: RAG-based with subtypes (explanation, comparison, hypothesis).
   - General: Direct LLM response.
   - Continuation: Context-aware response with optional RAG.
   - Special Command: Summarization or export.
4. **Handle Corrections**: Loops back if the user corrects the question.
5. **Save and Return**: Stores the interaction and sends the response.

### Best Practices
1. **Modularity**:
   - Keep classification logic separate (`classifyQuestion`, `classifyLegalSubType`) for easy updates.
   - Delegate RAG and storage tasks to respective services (`retrievalService`, `storageService`).

2. **Extensibility**:
   - Add new question types by extending the `classifyQuestion` switch-case.
   - Use regex-based classification for simplicity; consider ML for complex cases later.

3. **Robustness**:
   - Always validate inputs in `chatController.ts` before passing to `chatService`.
   - Handle errors gracefully with try-catch in production.

4. **Documentation**:
   - Use JSDoc comments for all methods (e.g., `@param`, `@returns`).
   - Update this file with new features or changes.

5. **Performance**:
   - Cache frequent document lookups in `retrievalService`.
   - Limit history size (e.g., last 10 messages) to avoid overloading LLM.

6. **Testing**:
   - Write unit tests for `classifyQuestion` and subtypes in `tests/services/chatService.test.ts`.
   - Mock `retrievalService` and `storageService` for isolated testing.

### Usage Examples
- **Specific Document**: "Show me Law No. 300/2005" → Direct lookup.
- **Legal Analysis**: "What are divorce conditions in Slovakia?" → RAG response.
- **Continuation**: "What if there's domestic violence?" → Context + RAG.
- **Special Command**: "Summarize Law No. 301/2005" → Summary response.

### Adding New Features
1. Define a new question type in `classifyQuestion`.
2. Add a corresponding handler in the `switch` block.
3. Update this doc with the new functionality.
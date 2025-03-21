import { retrievalService } from './retrievalService';
import { storageService } from './storageService';
import { ChatMessage, Conversation } from '../types/chat';

class ChatService {
    /**
     * Handles the main chat workflow: processes user questions, classifies them, and generates responses.
     * @param userId - The ID of the user initiating the chat.
     * @param question - The user's question.
     * @param conversationId - Optional ID of an existing conversation.
     * @returns The generated response.
     */
    async handleChat(userId: string, question: string, conversationId?: string): Promise<string> {
        // Load or create a conversation
        let conversation: Conversation = conversationId
            ? await storageService.getConversation(conversationId)
            : await storageService.createConversation(userId);

        let finalAnswer: string;

        // Loop to handle corrections
        while (true) {
            // Classify the question based on content and history
            const questionType = this.classifyQuestion(question, conversation.history);

            // Process the question based on its type
            switch (questionType) {
                case 'specific_document':
                    finalAnswer = await retrievalService.getSpecificDocument(question);
                    break;
                case 'legal_analysis':
                    finalAnswer = await this.handleLegalAnalysis(question, conversation.history);
                    break;
                case 'general':
                    finalAnswer = await this.generateDirectAnswer(question, conversation.history);
                    break;
                case 'continuation':
                    finalAnswer = await this.handleContinuation(question, conversation.history);
                    break;
                case 'special_command':
                    finalAnswer = await this.handleSpecialCommand(question, conversation.history);
                    break;
                default:
                    throw new Error('Unknown question type');
            }

            // Save the question and answer to the conversation history
            await storageService.saveMessage(conversation.id, {
                role: 'user',
                content: question
            });
            await storageService.saveMessage(conversation.id, {
                role: 'assistant',
                content: finalAnswer
            });

            // Check if the user is correcting a previous question
            if (this.isCorrection(question)) {
                question = this.extractCorrectedQuestion(question);
                continue; // Reclassify the corrected question
            }
            break; // Exit if no correction is needed
        }

        // Return the final answer to the user
        return finalAnswer;
    }

    /**
     * Classifies the user's question into a specific type.
     * @param question - The user's input.
     * @param history - Previous messages in the conversation.
     * @returns The classified question type.
     */
    private classifyQuestion(question: string, history: ChatMessage[]): string {
        if (this.isSpecificDocumentRequest(question)) return 'specific_document';
        if (this.isSpecialCommand(question)) return 'special_command';
        if (this.isGeneralQuestion(question)) return 'general';
        if (this.isContinuation(question, history)) return 'continuation';
        return 'legal_analysis'; // Default to legal analysis with RAG
    }

    /**
     * Checks if the question requests a specific document (e.g., law or ruling).
     */
    private isSpecificDocumentRequest(question: string): boolean {
        return /law no\.|ruling no\.|§/i.test(question);
    }

    /**
     * Handles legal analysis questions with subtypes (explanation, comparison, hypothesis).
     */
    private async handleLegalAnalysis(question: string, history: ChatMessage[]): Promise<string> {
        const subType = this.classifyLegalSubType(question);
        switch (subType) {
            case 'explanation':
                return await retrievalService.explainDocument(question, history);
            case 'comparison':
                return await retrievalService.compareLaws(question, history);
            case 'hypothesis':
                return await retrievalService.handleHypothetical(question, history);
            default:
                return await retrievalService.handleRagQuestion(question, history);
        }
    }

    /**
     * Classifies subtypes of legal analysis questions.
     */
    private classifyLegalSubType(question: string): string {
        if (/explain|what does it mean/i.test(question)) return 'explanation';
        if (/compare|difference between/i.test(question)) return 'comparison';
        if (/what if|suppose/i.test(question)) return 'hypothesis';
        return 'standard';
    }

    /**
     * Generates a direct answer for general questions without RAG.
     */
    private async generateDirectAnswer(question: string, history: ChatMessage[]): Promise<string> {
        const prompt = `History: ${JSON.stringify(history)}\nQuestion: ${question}`;
        return await this.callLLM(prompt);
    }

    /**
     * Handles follow-up questions by considering the conversation context.
     */
    private async handleContinuation(question: string, history: ChatMessage[]): Promise<string> {
        if (this.needsRagForContinuation(history)) {
            return await retrievalService.handleRagQuestion(question, history);
        }
        return await this.generateDirectAnswer(question, history);
    }

    /**
     * Processes special commands like summarization or export.
     */
    private async handleSpecialCommand(question: string, history: ChatMessage[]): Promise<string> {
        if (/summarize|sum up/i.test(question)) {
            return await retrievalService.summarizeDocument(question, history);
        }
        if (/save|export/i.test(question)) {
            await storageService.exportConversation(history, 'pdf');
            return 'Conversation saved as PDF.';
        }
        return 'Command not understood.';
    }

    /**
     * Detects if the question is a correction of a previous input.
     */
    private isCorrection(question: string): boolean {
        return /no, I meant|correct/i.test(question);
    }

    /**
     * Extracts the corrected question from the user's input.
     */
    private extractCorrectedQuestion(question: string): string {
        const match = question.match(/I meant (.+)$/i);
        return match ? match[1] : question;
    }

    /**
     * Checks if the question is general (non-legal).
     */
    private isGeneralQuestion(question: string): boolean {
        return !/law|ruling|legal|crime|court|explain|compare/i.test(question);
    }

    /**
     * Determines if the question is a continuation based on context.
     */
    private isContinuation(question: string, history: ChatMessage[]): boolean {
        return history.length > 0 && /further|continue|regarding/i.test(question);
    }

    /**
     * Decides if RAG is needed for a continuation based on history.
     */
    private needsRagForContinuation(history: ChatMessage[]): boolean {
        return history.some(msg => /law|ruling|legal/i.test(msg.content));
    }

    /**
     * Placeholder for calling the Language Model (e.g., LangChain LLM).
     */
    private async callLLM(prompt: string): Promise<string> {
        // TODO: Implement LangChain LLM call
        return 'Mock response';
    }

    /**
     * Checks if the question is a special command (e.g., summarize, export).
     */
    private isSpecialCommand(question: string): boolean {
        return /summarize|sum up|save|export/i.test(question);
    }

    /**
     * Creates a user message for the chat history.
     */
    private createUserMessage(content: string): ChatMessage {
        return {
            role: 'user',
            content: content
        };
    }

    /**
     * Creates an assistant message for the chat history.
     */
    private createAssistantMessage(content: string): ChatMessage {
        return {
            role: 'assistant',
            content: content
        };
    }
}

export const chatService = new ChatService();
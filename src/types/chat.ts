/**
 * Represents a single message in a conversation (question and answer).
 */
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/**
 * Represents a conversation with a user, including its history.
 */
export interface Conversation {
    id: string;
    userId: string;
    history: ChatMessage[];
}

export interface ChatCompletionResponse {
    content: string;
    role: string;
}

export interface StreamChunk {
    choices: Array<{
        delta: {
            content?: string;
            role?: string;
        };
    }>;
}

export interface WebSocketMessage {
    type: 'question' | 'start' | 'chunk' | 'complete' | 'error' | 'search_results';
    content?: string;
    error?: string;
    data?: any;
}
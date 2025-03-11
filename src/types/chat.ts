/**
 * Represents a single message in a conversation (question and answer).
 */
export interface ChatMessage {
    question: string;
    answer: string;
}

/**
 * Represents a conversation with a user, including its history.
 */
export interface Conversation {
    id: string;
    userId: string;
    history: ChatMessage[];
}
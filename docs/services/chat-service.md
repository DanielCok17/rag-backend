# ChatService Documentation

## Overview

The ChatService is the core component responsible for managing conversations, handling user interactions, and coordinating between different services in the system.

## Core Functionality

### 1. Conversation Management

#### State Management
```typescript
interface ConversationState {
    history: ChatMessage[];
    previousQuestions: string[];
    lastResponse?: string;
    openAIContext: {
        messages: ChatMessage[];
        lastTokenCount: number;
        lastUpdateTime: number;
        summary: string;
        keyPoints: string[];
        lastAnalysis?: {
            mainTopics: string[];
            keyLegalConcepts: string[];
            importantDecisions: string[];
            relevantLaws: string[];
            conversationFlow: string;
            timestamp: number;
        };
    };
}
```

#### Key Methods
- `getOrCreateState(userId: string): ConversationState`
- `updateState(userId: string, updates: Partial<ConversationState>): void`
- `cleanupRateLimits(): Promise<void>`
- `updateConversationSummary(state: ConversationState, recentHistory: ChatMessage[]): Promise<void>`

### 2. Request Processing

#### Flow
1. Request validation
2. Rate limit checking
3. Context optimization
4. Response generation
5. History update

#### Key Methods
- `handleChat(userId: string, question: string, conversationId?: string): Promise<string>`
- `validateRequest(userId: string, question: string): Promise<ValidationResult>`
- `checkRateLimit(userId: string): Promise<boolean>`
- `optimizeOpenAIContext(state: ConversationState): Promise<ChatMessage[]>`

### 3. Context Management

#### Features
- Token limit management
- Context window optimization
- Message summarization
- History maintenance

#### Key Methods
- `optimizeOpenAIContext(state: ConversationState): Promise<ChatMessage[]>`
- `updateConversationSummary(state: ConversationState, recentHistory: ChatMessage[]): Promise<void>`
- `estimateTokenCount(messages: ChatMessage[]): number`

## Implementation Details

### 1. Rate Limiting

```typescript
interface RateLimitData {
    count: number;
    timestamp: number;
    activeRequests: number;
}

const rateLimitConfig = {
    maxRequestsPerMinute: 60,
    maxTokensPerRequest: 4000,
    maxConcurrentRequests: 10
};
```

#### Implementation
- Tracks request counts per user
- Enforces time-based limits
- Manages concurrent requests
- Handles cleanup of old data

### 2. Context Optimization

#### Process
1. Get current state
2. Check context expiry
3. Optimize message list
4. Update token count
5. Generate summary if needed

#### Key Features
- Maintains system message
- Preserves recent messages
- Handles token limits
- Updates summaries

### 3. Error Handling

#### Types of Errors
- Rate limit errors
- Validation errors
- Context errors
- API errors

#### Handling Strategy
- Retry with backoff
- Fallback responses
- Error logging
- State recovery

## Best Practices

### 1. State Management
- Keep state immutable
- Update atomically
- Clean up old data
- Validate state

### 2. Context Handling
- Optimize token usage
- Maintain conversation flow
- Update summaries regularly
- Handle context expiry

### 3. Error Handling
- Implement retries
- Provide fallbacks
- Log errors
- Recover gracefully

### 4. Performance
- Cache responses
- Optimize context
- Clean up resources
- Monitor usage

## API Reference

### Public Methods

#### handleChat
```typescript
handleChat(userId: string, question: string, conversationId?: string): Promise<string>
```
Processes a chat message and returns a response.

#### getConversationHistory
```typescript
getConversationHistory(userId: string): Promise<ChatMessage[]>
```
Retrieves the conversation history for a user.

#### updateConversationHistory
```typescript
updateConversationHistory(userId: string, history: ChatMessage[]): Promise<void>
```
Updates the conversation history for a user.

### Private Methods

#### validateRequest
```typescript
private validateRequest(userId: string, question: string): Promise<ValidationResult>
```
Validates a chat request.

#### checkRateLimit
```typescript
private checkRateLimit(userId: string): Promise<boolean>
```
Checks if a request is within rate limits.

#### optimizeOpenAIContext
```typescript
private optimizeOpenAIContext(state: ConversationState): Promise<ChatMessage[]>
```
Optimizes the OpenAI context for a conversation.

## Usage Examples

### 1. Basic Chat
```typescript
const response = await chatService.handleChat(userId, question);
```

### 2. Get History
```typescript
const history = await chatService.getConversationHistory(userId);
```

### 3. Update History
```typescript
await chatService.updateConversationHistory(userId, newHistory);
```

## Error Handling

### 1. Rate Limit Errors
```typescript
try {
    await chatService.handleChat(userId, question);
} catch (error) {
    if (error.message.includes('Rate limit exceeded')) {
        // Handle rate limit error
    }
}
```

### 2. Validation Errors
```typescript
try {
    await chatService.handleChat(userId, question);
} catch (error) {
    if (error.message.includes('Invalid request')) {
        // Handle validation error
    }
}
```

### 3. Context Errors
```typescript
try {
    await chatService.handleChat(userId, question);
} catch (error) {
    if (error.message.includes('Context error')) {
        // Handle context error
    }
}
```

## Monitoring and Logging

### 1. Performance Metrics
- Request processing time
- Context optimization time
- Token usage
- Error rates

### 2. State Metrics
- Active conversations
- Context sizes
- History lengths
- Rate limit status

### 3. Error Tracking
- Error types
- Error frequencies
- Error patterns
- Recovery attempts

## Testing

### 1. Unit Tests
- State management
- Request validation
- Rate limiting
- Context optimization

### 2. Integration Tests
- Chat flow
- History management
- Error handling
- Performance

### 3. Load Tests
- Concurrent requests
- Rate limiting
- Resource usage
- Response times 
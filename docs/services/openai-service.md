# OpenAIService Documentation

## Overview

The OpenAIService manages all interactions with OpenAI's API, handling token management, context window optimization, and response generation with proper prompting.

## Core Functionality

### 1. API Communication

#### Configuration
```typescript
const OPENAI_CONFIG = {
    model: "gpt-4-turbo-preview",
    maxTokens: 4000,
    temperature: 0.7,
    topP: 1,
    frequencyPenalty: 0,
    presencePenalty: 0
};
```

#### Key Methods
```typescript
async generateResponse(prompt: string, systemPrompt: string, conversationId: string): Promise<string>
async classifyQuestionWithOpenAI(question: string, history: ChatMessage[]): Promise<QuestionClassification>
```

### 2. Token Management

#### Features
- Token counting
- Context window optimization
- Token limit enforcement
- Cost optimization

#### Key Methods
```typescript
private estimateTokenCount(messages: ChatMessage[]): number
private optimizeContextWindow(messages: ChatMessage[]): ChatMessage[]
```

### 3. Response Generation

#### Process
1. Prompt preparation
2. Context optimization
3. API call
4. Response processing

#### Features
- System prompt management
- Context window optimization
- Error handling
- Response formatting

## Implementation Details

### 1. API Integration

#### Configuration
```typescript
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 3,
    timeout: 30000
});
```

#### Error Handling
```typescript
try {
    const response = await openai.chat.completions.create({
        model: OPENAI_CONFIG.model,
        messages: messages,
        max_tokens: OPENAI_CONFIG.maxTokens,
        temperature: OPENAI_CONFIG.temperature,
        top_p: OPENAI_CONFIG.topP,
        frequency_penalty: OPENAI_CONFIG.frequencyPenalty,
        presence_penalty: OPENAI_CONFIG.presencePenalty
    });
} catch (error) {
    // Handle API errors
}
```

### 2. Context Management

#### Process
1. Get current context
2. Optimize window
3. Update tokens
4. Generate response

#### Features
- Context window optimization
- Token limit management
- Message prioritization
- Context preservation

### 3. Prompt Management

#### System Prompts
```typescript
const SYSTEM_PROMPTS = {
    LEGAL: "You are a legal AI assistant...",
    CLASSIFICATION: "Classify the following question...",
    ANALYSIS: "Analyze the following legal document..."
};
```

#### Prompt Templates
```typescript
const PROMPT_TEMPLATES = {
    QUESTION: "Question: {question}\nContext: {context}",
    ANALYSIS: "Analyze: {content}\nFocus: {focus}",
    SUMMARY: "Summarize: {content}\nLength: {length}"
};
```

## Best Practices

### 1. API Usage
- Implement retries
- Handle rate limits
- Optimize requests
- Monitor costs

### 2. Context Management
- Optimize window size
- Handle token limits
- Preserve important context
- Update regularly

### 3. Error Handling
- Implement fallbacks
- Log errors
- Monitor failures
- Recover gracefully

## API Reference

### Public Methods

#### generateResponse
```typescript
async generateResponse(prompt: string, systemPrompt: string, conversationId: string): Promise<string>
```
Generates a response using OpenAI's API.

#### classifyQuestionWithOpenAI
```typescript
async classifyQuestionWithOpenAI(question: string, history: ChatMessage[]): Promise<QuestionClassification>
```
Classifies a question using OpenAI's API.

### Private Methods

#### estimateTokenCount
```typescript
private estimateTokenCount(messages: ChatMessage[]): number
```
Estimates token count for messages.

#### optimizeContextWindow
```typescript
private optimizeContextWindow(messages: ChatMessage[]): ChatMessage[]
```
Optimizes the context window for API calls.

## Usage Examples

### 1. Basic Response Generation
```typescript
const response = await openAIService.generateResponse(prompt, systemPrompt, conversationId);
```

### 2. Question Classification
```typescript
const classification = await openAIService.classifyQuestionWithOpenAI(question, history);
```

### 3. Context Optimization
```typescript
const optimizedContext = await openAIService.optimizeContextWindow(messages);
```

## Error Handling

### 1. API Errors
```typescript
try {
    const response = await openAIService.generateResponse(prompt, systemPrompt, conversationId);
} catch (error) {
    if (error.message.includes('API error')) {
        // Handle API error
    }
}
```

### 2. Token Errors
```typescript
try {
    const response = await openAIService.generateResponse(prompt, systemPrompt, conversationId);
} catch (error) {
    if (error.message.includes('Token limit')) {
        // Handle token error
    }
}
```

### 3. Rate Limit Errors
```typescript
try {
    const response = await openAIService.generateResponse(prompt, systemPrompt, conversationId);
} catch (error) {
    if (error.message.includes('Rate limit')) {
        // Handle rate limit error
    }
}
```

## Monitoring and Logging

### 1. Performance Metrics
- API response time
- Token usage
- Cost tracking
- Error rates

### 2. Usage Metrics
- Request counts
- Token counts
- Context sizes
- Error types

### 3. Cost Tracking
- Token costs
- API costs
- Usage patterns
- Cost optimization

## Testing

### 1. Unit Tests
- API integration
- Token management
- Context optimization
- Error handling

### 2. Integration Tests
- Response generation
- Question classification
- Context management
- Performance

### 3. Load Tests
- Concurrent requests
- Rate limiting
- Token limits
- Response times

## Configuration

### 1. API Configuration
```typescript
const apiConfig = {
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 3,
    timeout: 30000,
    organization: process.env.OPENAI_ORG_ID
};
```

### 2. Model Configuration
```typescript
const modelConfig = {
    model: "gpt-4-turbo-preview",
    maxTokens: 4000,
    temperature: 0.7,
    topP: 1,
    frequencyPenalty: 0,
    presencePenalty: 0
};
```

### 3. Context Configuration
```typescript
const contextConfig = {
    maxTokens: 8000,
    maxMessages: 10,
    systemPrompt: SYSTEM_PROMPTS.LEGAL,
    contextExpiry: 5 * 60 * 1000 // 5 minutes
};
``` 
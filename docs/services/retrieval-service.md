# RetrievalService Documentation

## Overview

The RetrievalService is responsible for handling document retrieval, implementing the RAG (Retrieval Augmented Generation) pipeline, and managing document processing and search operations.

## Core Functionality

### 1. Document Retrieval

#### Search Process
1. Query expansion
2. Initial document search
3. Case identification
4. Chunk retrieval
5. Context formatting

#### Key Methods
```typescript
async searchRelevantDocuments(query: string, conversationId: string): Promise<SearchResult[]>
async handleRagQuestion(question: string, history: ChatMessage[], conversationId: string): Promise<string>
async getSpecificDocument(query: string, conversationId: string): Promise<string>
```

### 2. Document Processing

#### Features
- Document chunking
- Metadata extraction
- Content formatting
- Relevance scoring

#### Key Methods
```typescript
private async safeSimilaritySearch(query: string, k: number = 5, filter?: any): Promise<Document[]>
private async fetchCaseChunks(caseId: string): Promise<{ chunks?: Document[], conclusion?: Document }>
private combineKnowledge(allDocs: Document[], conclusions: Document[]): string
```

### 3. Context Management

#### Features
- Conversation context tracking
- Document context maintenance
- Query expansion
- Context formatting

#### Key Methods
```typescript
private getOrCreateContext(conversationId: string): ConversationContext
private updateContext(conversationId: string, updates: Partial<ConversationContext>)
private async expandQuery(query: string, conversationId: string): Promise<string>
```

## Implementation Details

### 1. Vector Search

#### Configuration
```typescript
const EMBEDDING_MODEL = "text-embedding-3-large";
const MAX_CHARS = 10000;
const COLLECTION_NAME = process.env.QDRANT_COLLECTION || '500_chunk_size_10_overlap_court_judgements';
```

#### Process
1. Query embedding
2. Vector similarity search
3. Result ranking
4. Context extraction

### 2. Document Processing

#### Chunking Strategy
- Fixed size chunks
- Overlap handling
- Metadata preservation
- Content formatting

#### Features
- Smart chunking
- Metadata extraction
- Content cleaning
- Format standardization

### 3. Context Generation

#### Process
1. Document retrieval
2. Context extraction
3. Query expansion
4. Response generation

#### Features
- Context optimization
- Query enhancement
- Result ranking
- Format standardization

## Best Practices

### 1. Document Processing
- Maintain document integrity
- Preserve metadata
- Handle special characters
- Format consistently

### 2. Search Optimization
- Use appropriate embeddings
- Implement caching
- Optimize queries
- Handle edge cases

### 3. Context Management
- Track conversation flow
- Maintain document context
- Optimize context size
- Handle context expiry

## API Reference

### Public Methods

#### handleRagQuestion
```typescript
async handleRagQuestion(question: string, history: ChatMessage[], conversationId: string): Promise<string>
```
Processes a RAG-based question and returns a response.

#### searchRelevantDocuments
```typescript
async searchRelevantDocuments(query: string, conversationId: string): Promise<SearchResult[]>
```
Searches for relevant documents based on a query.

#### getSpecificDocument
```typescript
async getSpecificDocument(query: string, conversationId: string): Promise<string>
```
Retrieves a specific document by query.

### Private Methods

#### safeSimilaritySearch
```typescript
private async safeSimilaritySearch(query: string, k: number = 5, filter?: any): Promise<Document[]>
```
Performs a safe similarity search with error handling.

#### fetchCaseChunks
```typescript
private async fetchCaseChunks(caseId: string): Promise<{ chunks?: Document[], conclusion?: Document }>
```
Retrieves chunks for a specific case.

#### expandQuery
```typescript
private async expandQuery(query: string, conversationId: string): Promise<string>
```
Expands a query for better search results.

## Usage Examples

### 1. Basic RAG Question
```typescript
const response = await retrievalService.handleRagQuestion(question, history, conversationId);
```

### 2. Document Search
```typescript
const results = await retrievalService.searchRelevantDocuments(query, conversationId);
```

### 3. Specific Document
```typescript
const document = await retrievalService.getSpecificDocument(query, conversationId);
```

## Error Handling

### 1. Search Errors
```typescript
try {
    const results = await retrievalService.searchRelevantDocuments(query, conversationId);
} catch (error) {
    if (error.message.includes('No relevant documents')) {
        // Handle no results
    }
}
```

### 2. Processing Errors
```typescript
try {
    const response = await retrievalService.handleRagQuestion(question, history, conversationId);
} catch (error) {
    if (error.message.includes('Processing error')) {
        // Handle processing error
    }
}
```

### 3. Context Errors
```typescript
try {
    const response = await retrievalService.handleRagQuestion(question, history, conversationId);
} catch (error) {
    if (error.message.includes('Context error')) {
        // Handle context error
    }
}
```

## Monitoring and Logging

### 1. Performance Metrics
- Search response time
- Document processing time
- Context generation time
- Error rates

### 2. Search Metrics
- Query expansion stats
- Result relevance scores
- Document retrieval counts
- Cache hit rates

### 3. Error Tracking
- Search errors
- Processing errors
- Context errors
- Recovery attempts

## Testing

### 1. Unit Tests
- Document processing
- Search functionality
- Context management
- Error handling

### 2. Integration Tests
- RAG pipeline
- Document retrieval
- Context generation
- Performance

### 3. Load Tests
- Concurrent searches
- Large document sets
- Memory usage
- Response times

## Configuration

### 1. Vector Store
```typescript
const vectorStoreConfig = {
    url: process.env.QDRANT_HOST || 'localhost',
    port: process.env.QDRANT_PORT || '6333',
    collectionName: process.env.QDRANT_COLLECTION,
    collectionConfig: {
        vectors: {
            size: 3072,
            distance: 'Cosine'
        }
    }
};
```

### 2. Embeddings
```typescript
const embeddingConfig = {
    modelName: "text-embedding-3-large",
    maxTokens: 8000,
    temperature: 0.7
};
```

### 3. Processing
```typescript
const processingConfig = {
    maxChunkSize: 500,
    chunkOverlap: 10,
    maxChars: 10000,
    contextExpiry: 30 * 60 * 1000 // 30 minutes
};
``` 
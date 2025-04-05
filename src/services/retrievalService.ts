/**
 * Service for handling retrieval operations, including RAG pipeline and specific document lookups.
 */
import { OpenAIEmbeddings } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/qdrant';
import { Document } from '@langchain/core/documents';
import { ChatMessage } from '../types/chat';
import { RETRIEVAL_PROMPTS, SYSTEM_PROMPTS, ERROR_MESSAGES } from '../config/prompts';
import OpenAIService from './openaiService';
import QdrantClientSingleton from '../db/qdrantClient';
import { loggerService } from './loggerService';
import { TranslatedQdrantRecord } from '../types/qdrant';
import { traceable } from '../utils/langsmith';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';

const EMBEDDING_MODEL = "text-embedding-3-large";
const MAX_CHARS = 10000;

interface SearchResult {
    pageContent: string;
    metadata: {
        caseId?: string;
        caseNumber?: string;
        court?: string;
        decisionDate?: string;
        judge?: string;
        url?: string;
        relevanceScore?: number;
        chunkIndex?: number;
        type?: string;
    };
    score: number;
}

interface ConversationContext {
    history: ChatMessage[];
    previousDocuments: SearchResult[];
    previousDomain: string;
    previousQuery: string;
    timestamp: number;
}

class RetrievalService {
    private static instance: RetrievalService;
    private vectorStore: QdrantVectorStore | null = null;
    private embeddings: OpenAIEmbeddings;
    private openAIService: OpenAIService;
    private readonly COLLECTION_NAME = process.env.QDRANT_COLLECTION || '500_chunk_size_10_overlap_court_judgements';
    private readonly BASE_URL: string;
    private conversationContexts: Map<string, ConversationContext>;
    private readonly MAX_HISTORY_LENGTH = 10;
    private readonly CONTEXT_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

    constructor() {
        const host = process.env.QDRANT_HOST || 'caplak.sk';
        const port = process.env.QDRANT_PORT || '6333';
        this.BASE_URL = `http://${host}:${port}`;

        loggerService.info('Initializing Qdrant client', {
            baseUrl: this.BASE_URL,
            collection: this.COLLECTION_NAME
        });

        this.embeddings = new OpenAIEmbeddings({
            modelName: EMBEDDING_MODEL
        });

        // Use QdrantClientSingleton instead of creating new client
        const qdrantClient = QdrantClientSingleton.getInstance();
        if (qdrantClient) {
            this.vectorStore = new QdrantVectorStore(
                this.embeddings,
                {
                    client: qdrantClient,
                    collectionName: this.COLLECTION_NAME,
                    collectionConfig: {
                        vectors: {
                            size: 3072,
                            distance: 'Cosine'
                        }
                    }
                }
            );
        } else {
            loggerService.warn('Qdrant client not initialized, vector store will not be available');
        }

        this.openAIService = OpenAIService.getInstance();
        this.conversationContexts = new Map();

        // Test connection only if vector store is initialized
        if (this.vectorStore) {
            this.testConnection().catch(error => {
                loggerService.error('Failed to connect to Qdrant', {
                    error: error.message,
                    baseUrl: this.BASE_URL
                });
            });
        }
    }

    private async testConnection(): Promise<void> {
        if (!this.vectorStore) {
            loggerService.warn('Cannot test connection: vector store not initialized');
            return;
        }

        try {
            const client = this.vectorStore.client;
            await client.getCollections();
            loggerService.info('Successfully connected to Qdrant', {
                baseUrl: this.BASE_URL
            });
        } catch (err: unknown) {
            const error = err as Error;
            throw new Error(`Failed to connect to Qdrant at ${this.BASE_URL}: ${error.message}`);
        }
    }

    public static getInstance(): RetrievalService {
        if (!RetrievalService.instance) {
            RetrievalService.instance = new RetrievalService();
        }
        return RetrievalService.instance;
    }

    /**
     * Retrieves a specific document (e.g., law or ruling) by its identifier.
     * @param query - The query to find the document.
     * @param conversationId - The conversation ID associated with the request.
     * @returns The document content as a string.
     */
    public async getSpecificDocument(query: string, conversationId: string): Promise<string> {
        return traceable(async () => {
            try {
                const searchResults = await this.searchRelevantDocuments(query, conversationId);
                if (!searchResults.length) {
                    throw new Error(ERROR_MESSAGES.NO_RELEVANT_DOCS);
                }

                const context = this.formatSearchResults(searchResults);
                const prompt = `Na základe nasledujúcich súdnych rozhodnutí o neoprávnenom držaní omamných a psychotropných látok poskytnite jasný prehľad v právnickom jazyku. Zamerajte sa na tresty a právne dôsledky.

Retrieved documents:

${context}

Prosím poskytnite prehľad zameraný na:
1. Aké tresty môžu byť uložené za neoprávnené držanie
2. Rozdiely medzi rôznymi látkami a množstvami
3. Kľúčové právne odkazy
4. Dôležité aspekty z týchto prípadov

Prosím vysvetlite v právnickom jazyku.`;

                console.log('\n🤖 Generujem Slovak legal summary...');
                const summary = await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, conversationId);
                console.log('\n📝 Vygenerované zhrnutie:');
                console.log(summary);
                console.log('\n✅ Zhrnutie vygenerované\n');

                return summary;
            } catch (error) {
                console.error('Chyba pri získavaní konkrétneho dokumentu:', error);
                throw error;
            }
        }, 'getSpecificDocument')();
    }

    /**
     * Handles a RAG-based question by retrieving relevant documents and generating an answer.
     * @param question - The user's question.
     * @param history - The conversation history.
     * @param conversationId - The conversation ID associated with the request.
     * @returns The generated answer.
     */
    async handleRagQuestion(question: string, history: ChatMessage[], conversationId: string): Promise<string> {
        const startTime = Date.now();
        try {
            loggerService.logWorkflowStep('Starting RAG Question Handling', {
                conversationId,
                questionLength: question.length,
                historyLength: history.length
            });

            // Format history for better context
            const formattedHistory = history.map((msg, index) => {
                const prefix = index === 0 ? 'Hlavná otázka' :
                    index === history.length - 1 ? 'Posledná otázka' :
                        `Doplnujúca otázka ${index}`;
                return `${prefix}:\n${msg.role}: ${msg.content}\n`;
            }).join('\n');

            loggerService.debug('Conversation History', { formattedHistory });

            // Get relevant documents
            const searchStartTime = Date.now();
            const searchResults = await this.searchRelevantDocuments(question, conversationId);
            loggerService.logPerformance('Document Search', Date.now() - searchStartTime, {
                resultsCount: searchResults.length
            });

            if (!searchResults.length) {
                loggerService.warn('No relevant documents found', { conversationId });
                throw new Error(ERROR_MESSAGES.NO_RELEVANT_DOCS);
            }

            // Format context from search results
            const formatStartTime = Date.now();
            const context = this.formatSearchResults(searchResults);
            loggerService.logPerformance('Context Formatting', Date.now() - formatStartTime, {
                contextLength: context.length
            });

            // Generate response using the context
            const responseStartTime = Date.now();
            const response = await this.generateResponseWithContext(question, context, history, conversationId);
            loggerService.logPerformance('Response Generation', Date.now() - responseStartTime, {
                responseLength: response.length
            });

            // Add conversation progress indicator
            const progressIndicator = history.length > 1 ?
                `\n\n=== Progres konverzácie ===\n` +
                `Otázka ${history.length} z ${history.length}\n` +
                `Téma: ${this.extractMainTopic(question)}\n` +
                `=======================\n` : '';

            loggerService.logWorkflowStep('RAG Question Handling Complete', {
                conversationId,
                totalDuration: Date.now() - startTime,
                questionNumber: history.length
            });

            return response + progressIndicator;
        } catch (error) {
            loggerService.logError(error as Error, 'RAG Question Handling');
            throw error;
        }
    }

    private extractMainTopic(question: string): string {
        // Extract main topic from question
        const topicMatch = question.match(/za\s+(\d+\s*(?:kilo|kg|gramov|g)?\s*[a-zA-ZáéíóúýčďĺľňŕšťžÁÉÍÓÚÝČĎĹĽŇŔŠŤŽ]+)/i);
        if (topicMatch) {
            return topicMatch[1].trim();
        }
        return 'Nešpecifikovaná téma';
    }

    /**
     * Explains a specific document or section (e.g., a paragraph of a law).
     * @param question - The user's question.
     * @param history - The conversation history.
     * @param conversationId - The conversation ID associated with the request.
     * @returns The explanation.
     */
    async explainDocument(question: string, history: ChatMessage[], conversationId: string): Promise<string> {
        try {
            console.log('\n=== Začínam vysvetlenie dokumentu ===');
            console.log('Otázka:', question);

            const searchResults = await this.searchRelevantDocuments(question, conversationId);
            const context = this.formatSearchResults(searchResults);

            const prompt = RETRIEVAL_PROMPTS.EXPLAIN.replace('{context}', context);
            console.log('\nExplanation Prompt:');
            console.log(prompt);

            const response = await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, conversationId);

            console.log('\n=== Vygenerované vysvetlenie ===');
            console.log(response);
            console.log('\n=== Koniec vysvetlenia ===\n');

            return response;
        } catch (error) {
            console.error('Chyba pri vysvetlení dokumentu:', error);
            throw error;
        }
    }

    /**
     * Compares two or more laws or rulings.
     * @param question - The user's question.
     * @param history - The conversation history.
     * @param conversationId - The conversation ID associated with the request.
     * @returns The comparison result.
     */
    async compareLaws(question: string, history: ChatMessage[], conversationId: string): Promise<string> {
        try {
            console.log('\n=== Začínam porovnanie zákonov ===');
            console.log('Otázka:', question);

            const searchResults = await this.searchRelevantDocuments(question, conversationId);
            const context = this.formatSearchResults(searchResults);

            const prompt = RETRIEVAL_PROMPTS.COMPARE.replace('{context}', context);
            console.log('\nComparison Prompt:');
            console.log(prompt);

            const response = await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, conversationId);

            console.log('\n=== Vygenerované porovnanie ===');
            console.log(response);
            console.log('\n=== Koniec porovnania ===\n');

            return response;
        } catch (error) {
            console.error('Chyba pri porovnávaní zákonov:', error);
            throw error;
        }
    }

    /**
     * Handles hypothetical legal scenarios.
     * @param question - The user's question.
     * @param history - The conversation history.
     * @param conversationId - The conversation ID associated with the request.
     * @returns The hypothetical analysis.
     */
    async handleHypothetical(question: string, history: ChatMessage[], conversationId: string): Promise<string> {
        try {
            console.log('\n=== Začínam Hypothetical Analysis ===');
            console.log('Otázka:', question);

            const searchResults = await this.searchRelevantDocuments(question, conversationId);
            const context = this.formatSearchResults(searchResults);

            const prompt = `Na základe nasledujúceho právneho kontextu analyzujte túto hypotetickú situáciu:
Kontext: ${context}

Situácia: ${question}

Prosím poskytnite:
1. Relevantné právne zásady
2. Aplikovateľné zákony a predpisy
3. Potenciálne výsledky
4. Dôležité úvahy
5. Súvisiace precedenty alebo prípady`;

            console.log('\nHypothetical Analysis Prompt:');
            console.log(prompt);

            const response = await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, conversationId);

            console.log('\n=== Vygenerované Hypothetical Analysis ===');
            console.log(response);
            console.log('\n=== Koniec Hypothetical Analysis ===\n');

            return response;
        } catch (error) {
            console.error('Chyba pri zpracovaní hypotetického scenára:', error);
            throw error;
        }
    }

    /**
     * Summarizes a document or a set of documents.
     * @param question - The user's question.
     * @param history - The conversation history.
     * @param conversationId - The conversation ID associated with the request.
     * @returns The summary.
     */
    async summarizeDocument(question: string, history: ChatMessage[], conversationId: string): Promise<string> {
        try {
            console.log('\n=== Začínam zhrnutie dokumentu ===');
            console.log('Otázka:', question);

            const searchResults = await this.searchRelevantDocuments(question, conversationId);
            const context = this.formatSearchResults(searchResults);

            const prompt = `Prosím poskytnite komplexné zhrnutie nasledujúceho právneho dokumentu:
${context}

Prosím zahrňte:
1. Hlavné body a kľúčové koncepty
2. Dôležité sekcie a ich účel
3. Právne dôsledky a aplikácie
4. Súvisiace predpisy a zákony
5. Praktické príklady alebo prípady`;

            console.log('\nSummary Prompt:');
            console.log(prompt);

            const response = await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, conversationId);

            console.log('\n=== Vygenerované zhrnutie ===');
            console.log(response);
            console.log('\n=== Koniec zhrnutia ===\n');

            return response;
        } catch (error) {
            console.error('Chyba pri zhrnutí dokumentu:', error);
            throw error;
        }
    }

    private async expandQuery(query: string, conversationId: string): Promise<string> {
        try {
            const prompt = RETRIEVAL_PROMPTS.QUERY_EXPANSION.replace('{query}', query);
            const expandedQuery = await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, conversationId);
            return expandedQuery.trim();
        } catch (error) {
            console.error('Chyba pri rozširovaní otázky:', error);
            return query;
        }
    }

    private async safeSimilaritySearch(query: string, k: number = 5, filter?: any): Promise<Document[]> {
        return traceable(async () => {
            try {
                if (!this.vectorStore) {
                    loggerService.warn('Vector store not initialized, returning empty results');
                    return [];
                }

                console.log(`\n🔍 Performing similarity search with query: ${query.substring(0, 200)}...`);
                console.log('Filter:', JSON.stringify(filter, null, 2));

                // Get raw results from Qdrant client
                const client = this.vectorStore.client;
                const searchResults = await client.search(this.COLLECTION_NAME, {
                    vector: await this.embeddings.embedQuery(query),
                    limit: k,
                    filter: filter,
                    with_payload: true
                });

                if (!searchResults) {
                    loggerService.warn('No search results returned from Qdrant');
                    return [];
                }

                console.log(`✅ Successfully retrieved ${searchResults.length} documents`);

                // Convert Qdrant results to LangChain documents
                const documents = searchResults.map(result => {
                    const payload = result.payload as Record<string, any>;
                    let content = '';
                    let metadata = { ...payload };

                    // Extract content from payload
                    if (payload.text) {
                        content = payload.text;
                    } else if (payload.content) {
                        content = payload.content;
                    }

                    // Remove content from metadata to avoid duplication
                    delete metadata.text;
                    delete metadata.content;

                    return new Document({
                        pageContent: content,
                        metadata: {
                            ...metadata,
                            score: result.score
                        }
                    });
                });

                return documents;
            } catch (error) {
                loggerService.error('Error in similarity search', {
                    error: error instanceof Error ? error.message : 'Unknown error',
                    query: query.substring(0, 200)
                });
                return [];
            }
        }, 'safeSimilaritySearch')();
    }

    private async safeRetrieverInvoke(query: string): Promise<Document[]> {
        try {
            console.log('Invoking retriever for initial documents');
            const results = await this.safeSimilaritySearch(query, 5);
            console.log(`Retrieved ${results.length} initial documents`);
            return results;
        } catch (error) {
            console.error('Error in retriever invoke:', error);
            throw error;
        }
    }

    private truncateKnowledge(knowledge: string): string {
        if (knowledge.length > MAX_CHARS) {
            console.warn(`Knowledge section too long (${knowledge.length} chars), truncating to ${MAX_CHARS} chars`);
            return knowledge.substring(0, MAX_CHARS) + "... [skrátené]";
        }
        return knowledge;
    }

    private getOrCreateContext(conversationId: string): ConversationContext {
        let context = this.conversationContexts.get(conversationId);

        if (!context) {
            context = {
                history: [],
                previousDocuments: [],
                previousDomain: '',
                previousQuery: '',
                timestamp: Date.now()
            };
            this.conversationContexts.set(conversationId, context);
        }

        // Clean up expired contexts
        if (Date.now() - context.timestamp > this.CONTEXT_EXPIRY_MS) {
            context = {
                history: [],
                previousDocuments: [],
                previousDomain: '',
                previousQuery: '',
                timestamp: Date.now()
            };
            this.conversationContexts.set(conversationId, context);
        }

        return context;
    }

    private updateContext(conversationId: string, updates: Partial<ConversationContext>) {
        const context = this.getOrCreateContext(conversationId);

        if (updates.history) {
            context.history = updates.history.slice(-this.MAX_HISTORY_LENGTH);
        }
        if (updates.previousDocuments) {
            context.previousDocuments = updates.previousDocuments;
        }
        if (updates.previousDomain) {
            context.previousDomain = updates.previousDomain;
        }
        if (updates.previousQuery) {
            context.previousQuery = updates.previousQuery;
        }

        context.timestamp = Date.now();
    }

    public async searchRelevantDocuments(query: string, conversationId: string): Promise<SearchResult[]> {
        const startTime = Date.now();
        try {
            loggerService.logWorkflowStep('Starting Document Search', {
                conversationId,
                queryLength: query.length
            });

            // Combine current query with relevant context
            let searchQuery = query;
            const context = this.getOrCreateContext(conversationId);
            if (context.previousDocuments.length > 0) {
                const relevantContext = context.previousDocuments
                    .slice(0, 2) // Only use the 2 most recent documents
                    .map(doc => doc.pageContent)
                    .join('\n')
                    .slice(0, 300); // Reduce context size
                searchQuery = `${query}\n\nContext: ${relevantContext}`;
            }

            // First search in summaries with higher limit to get more relevant cases
            const searchStart = Date.now();
            const summaryResults = await this.safeSimilaritySearch(searchQuery, 3, {
                must: [
                    {
                        key: 'type',
                        match: { value: 'Zhrnutie' }
                    }
                ]
            });

            loggerService.logPerformance('Summary Search', Date.now() - searchStart, {
                summaryResultsCount: summaryResults.length
            });

            // Get case IDs and organize summaries
            const caseIds = new Set<string>();
            const summaryMap = new Map<string, Document>();
            summaryResults.forEach(doc => {
                const caseId = doc.metadata.caseId;
                if (caseId) {
                    caseIds.add(caseId);
                    summaryMap.set(caseId, doc);
                }
            });

            // If no summaries found, do a quick general search
            if (caseIds.size === 0) {
                loggerService.debug('No summaries found, performing general search');
                const generalResults = await this.safeSimilaritySearch(searchQuery, 3);
                generalResults.forEach(doc => {
                    const caseId = doc.metadata.caseId;
                    if (caseId) caseIds.add(caseId);
                });
            }

            // Fetch content chunks in parallel for all cases
            const chunksStart = Date.now();
            const chunkPromises = Array.from(caseIds).map(async caseId => {
                const chunksFilter = {
                    must: [
                        {
                            key: "caseId",
                            match: { value: caseId }
                        },
                        {
                            key: "type",
                            match: { value: "content" }
                        }
                    ]
                };
                const chunks = await this.safeSimilaritySearch("", 5, chunksFilter); // Reduced from 10 to 5 chunks
                return { caseId, chunks };
            });

            const chunkResults = await Promise.all(chunkPromises);
            loggerService.logPerformance('Content Chunks Fetch', Date.now() - chunksStart, {
                casesProcessed: caseIds.size
            });

            // Combine and process results
            const allDocs: Document[] = [];
            const summaries: Document[] = [];

            chunkResults.forEach(({ caseId, chunks }) => {
                const summary = summaryMap.get(caseId);
                if (summary) {
                    summaries.push(summary);
                }
                if (chunks) {
                    allDocs.push(...chunks);
                }
            });

            // Sort documents efficiently
            allDocs.sort((a, b) => (a.metadata.chunkIndex || 0) - (b.metadata.chunkIndex || 0));

            // Combine results, prioritizing summaries
            const combinedDocs = [...summaries, ...allDocs];

            // Convert to SearchResult type efficiently
            const searchResults: SearchResult[] = combinedDocs
                .slice(0, 5)
                .map((doc, index) => ({
                    pageContent: doc.pageContent || doc.metadata.text || '',
                    metadata: {
                        caseId: doc.metadata.caseId,
                        caseNumber: doc.metadata.caseNumber,
                        court: doc.metadata.court,
                        decisionDate: doc.metadata.decisionDate,
                        judge: doc.metadata.judge,
                        url: doc.metadata.url,
                        relevanceScore: doc.metadata.score || 1 - (index / combinedDocs.length),
                        chunkIndex: doc.metadata.chunkIndex,
                        type: doc.metadata.type
                    },
                    score: doc.metadata.score || 1 - (index / combinedDocs.length)
                }));

            // Update context with new results
            this.updateContext(conversationId, {
                previousDocuments: searchResults.slice(0, 2), // Only keep 2 most recent documents
                previousQuery: query
            });

            loggerService.logWorkflowStep('Document Search Complete', {
                conversationId,
                totalDuration: Date.now() - startTime,
                resultsCount: searchResults.length,
                summariesCount: summaries.length,
                chunksCount: allDocs.length
            });

            return searchResults;
        } catch (error) {
            loggerService.logError(error as Error, 'Document Search');
            throw error;
        }
    }

    private async fetchCaseChunks(caseId: string, summaryScore?: number): Promise<{ chunks?: Document[], summary?: Document }> {
        try {
            // First get the summary
            const summaryFilter = {
                must: [
                    {
                        key: "caseId",
                        match: { value: caseId }
                    },
                    {
                        key: "type",
                        match: { value: "Zhrnutie" }
                    }
                ]
            };
            const summaryDocs = await this.safeSimilaritySearch("", 1, summaryFilter);

            // Add the summary score from the initial search if available
            if (summaryDocs[0] && summaryScore !== undefined) {
                summaryDocs[0].metadata.score = summaryScore;
            }

            // Then get the content chunks
            const chunksFilter = {
                must: [
                    {
                        key: "caseId",
                        match: { value: caseId }
                    },
                    {
                        key: "type",
                        match: { value: "content" }
                    }
                ]
            };
            const chunkDocs = await this.safeSimilaritySearch("", 10, chunksFilter);

            // Add the summary score to chunks as well, but slightly lower to prioritize summary
            if (summaryScore !== undefined) {
                chunkDocs.forEach(doc => {
                    doc.metadata.score = summaryScore * 0.9;
                });
            }

            return {
                chunks: chunkDocs,
                summary: summaryDocs[0]
            };
        } catch (error) {
            console.error(`Error fetching chunks for case ${caseId}:`, error);
            return {};
        }
    }

    private combineKnowledge(allDocs: Document[], conclusions: Document[]): string {
        const knowledgeChunks = allDocs.map(doc => doc.pageContent || doc.metadata.obsah).join('\n\n');
        const knowledgeConclusions = conclusions.map(doc => doc.pageContent || doc.metadata.obsah).join('\n\n');

        return conclusions.length
            ? `### Conclusions\n${knowledgeConclusions}\n\n### Chunks\n${knowledgeChunks}`
            : knowledgeChunks;
    }

    private async generateSummary(results: SearchResult[], conversationId: string): Promise<string> {
        try {
            const prompt = `Na základe nasledujúcich právnych dokumentov vygenerujte stručné zhrnutie:
${results.map(r => r.pageContent).join('\n\n')}

Prosím poskytnite:
1. Hlavné body
2. Kľúčové zistenia
3. Právne dôsledky
4. Dôležité precedenty`;

            const summary = await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, conversationId);
            return summary.trim();
        } catch (error) {
            console.error('Chyba pri generovaní zhrnutia:', error);
            return '';
        }
    }

    /**
     * Formats search results into a readable string.
     * @param results - Array of search results.
     * @returns Formatted string of search results.
     */
    public formatSearchResults(results: SearchResult[]): string {
        try {
            console.log('\n=== Formátovanie výsledkov vyhľadávania ===');
            console.log(`Počet výsledkov: ${results.length}`);

            // Group results by case
            const cases = new Map<string, SearchResult[]>();
            results.forEach(result => {
                const caseId = result.metadata.caseId || 'unknown';
                if (!cases.has(caseId)) {
                    cases.set(caseId, []);
                }
                cases.get(caseId)!.push(result);
            });

            // Format each case with summary first, then content
            const formattedCases = Array.from(cases.entries()).map(([caseId, caseResults]) => {
                const firstResult = caseResults[0];
                const metadata = firstResult.metadata;

                // Separate summaries and content chunks
                const summaries = caseResults.filter(r => r.metadata.type === 'Zhrnutie');
                const contentChunks = caseResults.filter(r => r.metadata.type === 'content');

                // Sort content chunks by index to maintain order
                contentChunks.sort((a, b) => (a.metadata.chunkIndex || 0) - (b.metadata.chunkIndex || 0));

                // Format the case header
                let formattedCase = `=== Rozsudok ${metadata.caseNumber || 'N/A'} ===
Súd: ${metadata.court || 'N/A'}
Dátum: ${metadata.decisionDate || 'N/A'}
Sudca: ${metadata.judge || 'N/A'}
URL: ${metadata.url || 'N/A'}\n`;

                // Always add summary first if available
                if (summaries.length > 0) {
                    formattedCase += `\nZhrnutie:
${summaries.map(s => s.pageContent).join('\n\n')}\n`;
                }

                // Add content chunks if available
                if (contentChunks.length > 0) {
                    formattedCase += `\nObsah:
${contentChunks.map(c => c.pageContent).join('\n\n')}\n`;
                }

                formattedCase += `\nRelevance Score: ${firstResult.score.toFixed(4)}
-------------------`;

                // Log both case metadata and content
                console.log('\n=== Case Metadata ===');
                console.log(`Rozsudok: ${metadata.caseNumber}`);
                console.log(`Súd: ${metadata.court}`);
                console.log(`Dátum: ${metadata.decisionDate}`);
                console.log(`Sudca: ${metadata.judge}`);
                console.log(`URL: ${metadata.url}`);
                console.log(`Relevance Score: ${firstResult.score.toFixed(4)}`);

                if (summaries.length > 0) {
                    console.log('\n=== Zhrnutie ===');
                    summaries.forEach((summary, index) => {
                        console.log(`\nZhrnutie ${index + 1}:`);
                        console.log(summary.pageContent);
                    });
                }

                if (contentChunks.length > 0) {
                    console.log('\n=== Obsah ===');
                    contentChunks.forEach((chunk, index) => {
                        console.log(`\nČasť ${index + 1}:`);
                        console.log(chunk.pageContent);
                    });
                }
                console.log('\n-------------------');

                return formattedCase;
            }).join('\n\n');

            console.log('Formátované výsledky:', formattedCases.length, 'znakov');
            return formattedCases;
        } catch (error) {
            console.error('Chyba pri formátovaní výsledkov:', error);
            throw error;
        }
    }

    private extractFromContent(content: string, key: string): string {
        const lines = content.split('\n');
        for (const line of lines) {
            if (line.startsWith(key)) {
                return line.substring(key.length).trim();
            }
        }
        return 'N/A';
    }

    /**
     * Generates a response using the provided context and conversation history.
     * @param question - The user's question.
     * @param context - The formatted search results context.
     * @param history - The conversation history.
     * @param conversationId - The conversation ID.
     * @returns The generated response.
     */
    public async generateResponseWithContext(
        question: string,
        context: string,
        history: ChatMessage[],
        conversationId: string
    ): Promise<string> {
        return traceable(async () => {
            const startTime = Date.now();
            try {
                loggerService.logWorkflowStep('Starting Response Generation', {
                    conversationId,
                    questionLength: question.length,
                    contextLength: context.length
                });

                // Format conversation history in a more visible way
                const formattedHistory = history.map((msg, idx) => {
                    if (idx === history.length - 1) {
                        return `📝 Current Question:\n${msg.role}: ${msg.content}`;
                    }
                    return `${msg.role}: ${msg.content}`;
                }).join('\n');

                // Extract case information from context
                const caseMatches = context.match(/=== Rozsudok (.*?) ===\nSúd: (.*?)\nDátum: (.*?)\nSudca: (.*?)\nURL: (.*?)\n\nZhrnutie:\n(.*?)\n/g);

                // Build search results header with case information
                let searchResultsHeader = 'Na základe vyhľadávania v nasledujúcich rozsudkoch:\n\n';

                if (caseMatches) {
                    caseMatches.forEach(match => {
                        const [_, caseNumber, court, date, judge, url, summary] = match.match(/=== Rozsudok (.*?) ===\nSúd: (.*?)\nDátum: (.*?)\nSudca: (.*?)\nURL: (.*?)\n\nZhrnutie:\n(.*?)\n/) || [];
                        if (caseNumber && date && url) {
                            searchResultsHeader += `• Rozsudok ${caseNumber} (${date})\n`;
                            searchResultsHeader += `  ${url}\n`;
                            searchResultsHeader += `  Zhrnutie: ${summary.trim().substring(0, 200)}...\n\n`;
                        }
                    });
                }

                // Extract metadata from context
                const metadata = caseMatches ? caseMatches.map(match => {
                    const [_, caseNumber, court, date, judge, url] = match.match(/=== Rozsudok (.*?) ===\nSúd: (.*?)\nDátum: (.*?)\nSudca: (.*?)\nURL: (.*?)\n/) || [];
                    return {
                        caseNumber,
                        court,
                        date,
                        judge,
                        url
                    };
                }) : [];

                const prompt = `Si AI právny asistent špecializovaný na slovenské právo. 
Tvoj cieľ je odpovedať používateľovi zrozumiteľne, prakticky a čo najviac na základe reálnych súdnych rozhodnutí. 
Tvoja odpoveď má pôsobiť ako konzultácia s dobrým právnikom, nie ako právna analýza pre akademický časopis.

=== 📝 Konverzačná História ===
${formattedHistory}

=== 🔍 Vyhľadané Dokumenty ===
${searchResultsHeader}

=== 📚 Znalosti ===
${context}

=== 📋 Metadáta ===
${JSON.stringify(metadata, null, 2)}

🎯 Pri odpovedi:
1. **Odpovedaj priamo a konkrétne** – napr. „Za 1 kg marihuany hrozí 3 až 10 rokov väzenia podľa § 171 ods. 4 písm. b) Trestného zákona.“
2. **Rozober aspoň 2 reálne prípady**:
   - stručne opíš skutok (čo, kde, kedy),
   - uveď dátum rozhodnutia, súd, sudcu,
   - pripoj URL na rozsudok,
   - spomeň poľahčujúce/prit’ažujúce okolnosti a ich dopad na trest.
3. **Uveď, čo sa v danom prípade stalo (spolupráca, priznanie, recidíva...) a ako to ovplyvnilo rozhodnutie.**
4. **Zákonné ustanovenia uveď len vtedy, keď to pomáha vysvetliť rozhodnutie. Nezahlcuj paragrafmi.**
5. **Na konci urob praktické zhrnutie** – stručne povedz, čo z toho plynie pre používateľa: *„Ak budete spolupracovať, môžete dostať podmienku, inak hrozí 3 až 10 rokov natvrdo.“*
6. **Nezabudni pridať URL na použité rozsudky.**

💡 Cieľ: Používateľ má mať po prečítaní tvojej odpovede jasnú predstavu o tom:
- aký trest mu hrozí,
- čo mu môže pomôcť (napr. spolupráca),
- ako vyzerajú podobné reálne prípady a čo z nich vyplýva.

⚠️ Ak niektoré informácie v rozsudkoch chýbajú (napr. nie sú uvedené dôvody rozhodnutia), uveď to a nesnaž sa ich doplniť z vlastnej fantázie.`;


                // Log the final prompt with clear formatting
                console.log('\n\n');
                console.log('='.repeat(80));
                console.log('FINAL PROMPT FOR OPENAI');
                console.log('='.repeat(80));
                console.log('\nSYSTEM PROMPT:');
                console.log(SYSTEM_PROMPTS.LEGAL);
                console.log('\nUSER PROMPT:');
                console.log(prompt);
                console.log('='.repeat(80));
                console.log('\n');

                // Log token estimate
                const promptTokens = prompt.length / 4;
                loggerService.debug('Prompt Token Estimate', {
                    promptTokens,
                    promptLength: prompt.length
                });

                const response = await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, conversationId);

                loggerService.logWorkflowStep('Response Generation Complete', {
                    conversationId,
                    totalDuration: Date.now() - startTime,
                    responseLength: response.length
                });

                return response;
            } catch (error) {
                loggerService.logError(error as Error, 'Response Generation');
                throw error;
            }
        }, 'generateResponseWithContext')();
    }

    public async createCollection(): Promise<void> {
        try {
            // We only connect to existing collection, no creation needed
            console.log(`Connecting to existing collection: ${this.COLLECTION_NAME}`);
            await QdrantClientSingleton.waitForCollection(this.COLLECTION_NAME);
        } catch (error) {
            console.error('Error connecting to collection:', error);
            throw error;
        }
    }

    public async addDocuments(documents: Array<{ content: string; metadata: any }>): Promise<void> {
        return traceable(async () => {
            try {
                if (!this.vectorStore) {
                    loggerService.warn('Vector store not initialized, cannot add documents');
                    return;
                }

                console.log('\n📚 ===== STARTING DOCUMENT ADDITION =====');
                console.log(`Number of documents to add: ${documents.length}`);

                // Convert documents to LangChain Document format
                const langchainDocs = documents.map(doc => ({
                    pageContent: doc.content,
                    metadata: doc.metadata
                }));

                // Add documents using LangChain's QdrantVectorStore
                await this.vectorStore.addDocuments(langchainDocs);

                // Get total count using the client directly
                const client = this.vectorStore.client;
                const count = await client.count(this.COLLECTION_NAME);
                console.log(`\n📊 Total documents in collection: ${count.count}`);
                console.log('✅ ===== DOCUMENT ADDITION COMPLETE =====\n');
            } catch (error) {
                console.error('❌ Error adding documents:', error);
                throw error;
            }
        }, 'addDocuments')();
    }

    private stripAccents(text: string): string {
        return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    private async isLegalQuestion(question: string, conversationId: string): Promise<boolean> {
        try {
            const prompt = RETRIEVAL_PROMPTS.LEGAL_QUESTION_CHECK.replace('{question}', question);
            const response = await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, conversationId);
            return response.trim().toLowerCase() === 'áno';
        } catch (error) {
            console.error('Chyba pri kontrole právnej otázky:', error);
            return false;
        }
    }

    private async classifyLegalDomain(question: string, conversationId: string): Promise<string> {
        try {
            const prompt = RETRIEVAL_PROMPTS.DOMAIN_CLASSIFICATION.replace('{question}', question);
            const domain = await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, conversationId);
            return domain.trim().toLowerCase();
        } catch (error) {
            console.error('Chyba pri klasifikácii právnej domény:', error);
            return 'iné';
        }
    }

    private async decideIfRagNeeded(question: string, conversationId: string): Promise<boolean> {
        try {
            const prompt = RETRIEVAL_PROMPTS.RAG_NEEDED_CHECK.replace('{question}', question);
            const response = await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, conversationId);
            return response.trim().toLowerCase() === 'áno';
        } catch (error) {
            console.error('Chyba pri rozhodovaní o RAG:', error);
            return false;
        }
    }

    private interpretFormatAnswer(userText: string): string | null {
        console.log('\n🔍 ===== INTERPRETING FORMAT ANSWER =====');
        console.log('User text:', userText);

        const textLower = this.stripAccents(userText.toLowerCase());
        let result: string | null = null;

        if (textLower.includes('zakon') && textLower.includes('rozsudok')) {
            result = 'oboje';
        } else if (textLower.includes('oboje')) {
            result = 'oboje';
        } else if (textLower.includes('zakon')) {
            result = 'zakon';
        } else if (textLower.includes('rozsudok')) {
            result = 'rozsudok';
        }

        console.log('Interpreted format:', result);
        console.log('✅ ===== FORMAT INTERPRETATION COMPLETE =====\n');
        return result;
    }

    private normalizeMetadataKey(key: string): string {
        return key
            .replace(/č/g, 'c')
            .replace(/š/g, 's')
            .replace(/ť/g, 't')
            .replace(/ž/g, 'z')
            .replace(/ /g, '_')
            .toLowerCase();
    }

    private async generateConclusion(fullCaseText: string, caseId: string, conversationId: string): Promise<{ content: string; metadata: any } | null> {
        try {
            const prompt = RETRIEVAL_PROMPTS.CONCLUSION_GENERATION.replace('{case_text}', fullCaseText);
            const conclusion = await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, conversationId);

            return {
                content: conclusion,
                metadata: {
                    case_id: caseId,
                    type: 'conclusion',
                    generated_at: new Date().toISOString()
                }
            };
        } catch (error) {
            console.error('Chyba pri generovaní záveru:', error);
            return null;
        }
    }

    /**
     * Fetches and translates a Qdrant record by ID
     * @param recordId - The UUID of the record to fetch
     * @returns Translated Qdrant record
     */
    public async getQdrantRecord(recordId: string): Promise<TranslatedQdrantRecord> {
        if (!this.vectorStore) {
            throw new Error('Qdrant vector store not initialized');
        }

        try {
            const client = this.vectorStore.client;
            const record = await client.retrieve(this.COLLECTION_NAME, {
                ids: [recordId],
                with_payload: true,
                with_vector: false  // Don't fetch vectors unless needed
            });

            if (!record || record.length === 0) {
                throw new Error(`Record with ID ${recordId} not found`);
            }

            const qdrantRecord = record[0];
            if (!qdrantRecord.payload) {
                throw new Error(`Record with ID ${recordId} has no payload`);
            }

            const payload = qdrantRecord.payload;
            const metadata = payload as Record<string, any>;

            // Build the translated metadata efficiently
            const translatedMetadata = {
                title: String(metadata.title || ''),
                url: String(metadata.url || ''),
                pdfUrl: String(metadata.pdfUrl || ''),
                caseId: String(metadata.caseId || ''),
                caseNumber: String(metadata.caseNumber || ''),
                court: String(metadata.court || ''),
                decisionDate: String(metadata.decisionDate || ''),
                judge: String(metadata.judge || ''),
                ecli: String(metadata.ecli || ''),
                decisionForm: String(metadata.decisionForm || ''),
                legalArea: String(metadata.legalArea || ''),
                legalSubArea: String(metadata.legalSubArea || ''),
                decisionNature: String(metadata.decisionNature || ''),
                legalReferences: metadata.legalReferences || {},
                content: String(metadata.content || ''),
                summary: String(metadata.summary || ''),
                text: String(metadata.text || ''),
                type: String(metadata.type || ''),
                chunkIndex: Number(metadata.chunkIndex) || undefined,
                totalChunks: Number(metadata.totalChunks) || undefined,
                originalId: String(metadata.originalId || '')
            };

            return {
                id: String(qdrantRecord.id),
                score: 0,
                metadata: translatedMetadata,
                vector: [],  // Don't include vector data
                vectorInterpretation: ''  // Skip vector interpretation
            };
        } catch (error) {
            loggerService.logError(error as Error, 'Qdrant Record Retrieval');
            throw error;
        }
    }

    /**
     * Fetches all records for a given case ID
     * @param caseId - The case ID to search for
     * @returns Array of translated Qdrant records
     */
    public async getRecordsByCaseId(caseId: string): Promise<TranslatedQdrantRecord[]> {
        try {
            const response = await this.vectorStore?.client.scroll(
                this.COLLECTION_NAME,
                {
                    filter: {
                        must: [
                            {
                                key: 'caseId',
                                match: { value: caseId }
                            }
                        ]
                    },
                    limit: 100,
                    with_payload: true,
                    with_vector: false  // Don't fetch vectors
                }
            );

            if (!response || response.points.length === 0) {
                throw new Error(`No records found for case ID: ${caseId}`);
            }

            // Process records efficiently
            return response.points.map(point => {
                const payload = point.payload as Record<string, any>;

                const translatedMetadata = {
                    title: String(payload.title || ''),
                    url: String(payload.url || ''),
                    pdfUrl: String(payload.pdfUrl || ''),
                    caseId: String(payload.caseId || ''),
                    caseNumber: String(payload.caseNumber || ''),
                    court: String(payload.court || ''),
                    decisionDate: String(payload.decisionDate || ''),
                    judge: String(payload.judge || ''),
                    ecli: String(payload.ecli || ''),
                    decisionForm: String(payload.decisionForm || ''),
                    legalArea: String(payload.legalArea || ''),
                    legalSubArea: String(payload.legalSubArea || ''),
                    decisionNature: String(payload.decisionNature || ''),
                    legalReferences: payload.legalReferences || {},
                    content: String(payload.content || ''),
                    summary: String(payload.summary || ''),
                    text: String(payload.text || ''),
                    type: String(payload.type || ''),
                    chunkIndex: Number(payload.chunkIndex) || undefined,
                    totalChunks: Number(payload.totalChunks) || undefined,
                    originalId: String(payload.originalId || '')
                };

                return {
                    id: String(point.id),
                    score: 0,
                    metadata: translatedMetadata,
                    vector: [],  // Don't include vector data
                    vectorInterpretation: ''  // Skip vector interpretation
                };
            });
        } catch (error) {
            loggerService.logError(error as Error, 'Case Records Retrieval');
            throw error;
        }
    }

    /**
     * Helper method to get vector interpretation using OpenAI
     */
    private async getVectorInterpretation(vector: number[]): Promise<string> {
        return traceable(async () => {
            try {
                const embeddingResponse = await this.openAIService.generateResponse(
                    `Please analyze these vector components and explain what legal concept or text they might represent: ${vector.slice(0, 10).join(', ')}...`,
                    'You are a helpful assistant that understands vector embeddings and can explain what they might represent in legal text.',
                    'vector_interpretation'
                );
                return embeddingResponse;
            } catch (error) {
                loggerService.warn('Failed to decode vector', { error });
                return 'Vector interpretation not available';
            }
        }, 'getVectorInterpretation')();
    }

    private async summarizeDocuments(documents: Document[], promptType: keyof typeof SYSTEM_PROMPTS = 'DEFAULT'): Promise<string> {
        // Limit tokens per document to improve latency
        const MAX_TOKENS_PER_DOC = 1000;
        const filteredDocs = documents.map(doc => {
            const content = doc.pageContent;
            // Rough estimate: 1 token ≈ 4 chars
            if (content.length > MAX_TOKENS_PER_DOC * 4) {
                return new Document({
                    pageContent: content.substring(0, MAX_TOKENS_PER_DOC * 4),
                    metadata: { ...doc.metadata, truncated: true }
                });
            }
            return doc;
        });

        const model = new ChatOpenAI({
            modelName: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            temperature: 0,
            maxTokens: 1000, // Limit response length
            streaming: false // Disable streaming for faster response
        });

        const systemMessage = new SystemMessage(SYSTEM_PROMPTS[promptType]);
        const humanMessage = new HumanMessage(`
${filteredDocs.map(doc => doc.pageContent).join('\n\n')}

Prosím poskytnite:
1. Hlavné body
2. Kľúčové zistenia
3. Právne dôsledky
4. Dôležité precedenty`);

        const response = await model.invoke([systemMessage, humanMessage]);
        return response.content.toString();
    }
}

export const retrievalService = RetrievalService.getInstance();
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

const EMBEDDING_MODEL = "text-embedding-3-large";
const MAX_CHARS = 10000;

interface SearchResult {
    id: string;
    score: number;
    payload: {
        text: string;
        metadata: Record<string, any>;
    };
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
    private vectorStore: QdrantVectorStore;
    private embeddings: OpenAIEmbeddings;
    private openAIService: OpenAIService;
    private readonly COLLECTION_NAME = process.env.QDRANT_COLLECTION || '500_chunk_size_10_overlap_court_judgements';
    private readonly BASE_URL: string;
    private conversationContexts: Map<string, ConversationContext>;
    private readonly MAX_HISTORY_LENGTH = 10;
    private readonly CONTEXT_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

    constructor() {
        const host = process.env.QDRANT_HOST || 'localhost';
        const port = process.env.QDRANT_PORT || '6333';
        this.BASE_URL = `http://${host}:${port}`;

        this.embeddings = new OpenAIEmbeddings({
            modelName: EMBEDDING_MODEL
        });

        this.vectorStore = new QdrantVectorStore(
            this.embeddings,
            {
                url: this.BASE_URL,
                collectionName: this.COLLECTION_NAME,
                collectionConfig: {
                    vectors: {
                        size: 3072,
                        distance: 'Cosine'
                    }
                }
            }
        );

        this.openAIService = OpenAIService.getInstance();
        console.log('Using Qdrant collection:', this.COLLECTION_NAME);
        this.conversationContexts = new Map();
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
    async getSpecificDocument(query: string, conversationId: string): Promise<string> {
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
    }

    /**
     * Handles a RAG-based question by retrieving relevant documents and generating an answer.
     * @param question - The user's question.
     * @param history - The conversation history.
     * @param conversationId - The conversation ID associated with the request.
     * @returns The generated answer.
     */
    async handleRagQuestion(question: string, history: ChatMessage[], conversationId: string): Promise<string> {
        try {
            console.log('\n=== Začínam RAG Question Handling ===');
            console.log('Otázka:', question);
            console.log('Dĺžka histórie:', history.length);

            // Get relevant documents
            const searchResults = await this.searchRelevantDocuments(question, conversationId);

            if (!searchResults.length) {
                console.log('Nenašli sa žiadne relevantné dokumenty');
                throw new Error(ERROR_MESSAGES.NO_RELEVANT_DOCS);
            }

            // Format context from search results
            const context = this.formatSearchResults(searchResults);

            // Generate response using the context
            const response = await this.generateResponseWithContext(question, context, history, conversationId);

            console.log('\n=== RAG Question Handling Complete ===\n');
            return response;
        } catch (error) {
            console.error('Chyba v RAG question handling:', error);
            throw error;
        }
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
        try {
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

            console.log(`✅ Successfully retrieved ${searchResults.length} documents`);

            // Log the raw payload structure for debugging
            // searchResults.forEach((result, index) => {
            //     console.log(`\n📄 Document ${index + 1} Raw Payload:`, {
            //         score: result.score,
            //         payload: result.payload,
            //         payloadKeys: Object.keys(result.payload || {})
            //     });
            // });

            // Convert Qdrant results to LangChain documents
            const documents = searchResults.map(result => {
                const payload = result.payload as Record<string, any>;
                let content = '';
                let metadata = { ...payload };

                // First try to get the actual content from the payload
                if (payload?.obsah) {
                    content = payload.obsah;
                    delete metadata.obsah;
                }
                // Then try the standard LangChain format
                else if (payload?.pageContent) {
                    content = payload.pageContent;
                    delete metadata.pageContent;
                }
                // Then try the raw text field
                else if (payload?.text) {
                    content = payload.text;
                    delete metadata.text;
                }
                // Finally, try to get any text content from the payload
                else if (payload) {
                    // Try to find any string value in the payload that's not metadata
                    for (const [key, value] of Object.entries(payload)) {
                        if (typeof value === 'string' &&
                            value.length > 0 &&
                            !key.toLowerCase().includes('datum') &&
                            !key.toLowerCase().includes('url') &&
                            !key.toLowerCase().includes('ecli') &&
                            !key.toLowerCase().includes('spis') &&
                            !key.toLowerCase().includes('sud') &&
                            !key.toLowerCase().includes('type') &&
                            !key.toLowerCase().includes('chunk')) {
                            content = value;
                            delete metadata[key];
                            break;
                        }
                    }
                }

                if (!content) {
                    console.log('No content found in payload, using default');
                    content = 'No content available';
                }

                console.log('Final content length:', content.length);
                console.log('Content preview:', content.substring(0, 200) + '...');

                // Create a new document with the correct content and metadata
                return new Document({
                    pageContent: content,
                    metadata: metadata
                });
            });

            return documents;
        } catch (error) {
            console.error('❌ Error in similarity search:', error);
            throw error;
        }
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
        try {
            const startTime = Date.now();
            const context = this.getOrCreateContext(conversationId);
            console.log('\n=== Začínam vyhľadávanie relevantných dokumentov ===');
            console.log('Otázka:', query);
            console.log('Previous query:', context.previousQuery);

            // Combine current query with relevant context from previous documents
            let searchQuery = query;
            if (context.previousDocuments.length > 0) {
                const relevantContext = context.previousDocuments
                    .map(doc => doc.payload.text)
                    .join('\n')
                    .slice(0, 500); // Limit context length
                searchQuery = `${query}\n\nRelevant context from previous documents:\n${relevantContext}`;
            }

            // Expand the query with relevant legal terms
            const queryExpansionStart = Date.now();
            const expandedQuery = await this.expandQuery(searchQuery, conversationId);
            console.log('Rozšírená otázka:', expandedQuery);
            console.log(`Čas rozšírenia otázky: ${Date.now() - queryExpansionStart}ms`);

            // Initial search with limit of 3 and parallel processing
            const searchStart = Date.now();
            const [initialResults, caseIds] = await Promise.all([
                this.safeSimilaritySearch(expandedQuery, 3),
                this.getUniqueCaseIds(expandedQuery)
            ]);
            console.log(`Čas počiatočného vyhľadávania: ${Date.now() - searchStart}ms`);

            // Fetch all chunks for identified cases in parallel
            const chunksStart = Date.now();
            const caseDocsPromises = Array.from(caseIds).map(caseId =>
                this.fetchCaseChunks(caseId)
            );

            const caseDocsResults = await Promise.all(caseDocsPromises);
            console.log(`Čas získavania chunkov: ${Date.now() - chunksStart}ms`);

            // Process results
            const allDocs: Document[] = [];
            const conclusions: Document[] = [];

            caseDocsResults.forEach(({ chunks, conclusion }) => {
                if (chunks) allDocs.push(...chunks);
                if (conclusion) conclusions.push(conclusion);
            });

            // Fallback to initial documents if no additional chunks
            if (!allDocs.length && !conclusions.length) {
                console.warn('Failed to fetch additional chunks, using initial documents only');
                allDocs.push(...initialResults);
            }

            // Sort documents by chunk index
            allDocs.sort((a, b) => (a.metadata.chunk_index || 0) - (b.metadata.chunk_index || 0));
            conclusions.sort((a, b) => (a.metadata.chunk_index || 0) - (b.metadata.chunk_index || 0));

            // Combine chunks and conclusions efficiently
            const knowledge = this.combineKnowledge(allDocs, conclusions);
            const truncatedKnowledge = this.truncateKnowledge(knowledge);

            // Convert to SearchResult type and limit to 3 results
            const searchResults: SearchResult[] = [...allDocs, ...conclusions]
                .slice(0, 3)
                .map((doc, index) => ({
                    id: String(index),
                    score: 1 - (index / (allDocs.length + conclusions.length)),
                    payload: {
                        text: doc.pageContent || doc.metadata.obsah || 'No content available',
                        metadata: doc.metadata
                    }
                }));

            // Update context with new documents
            this.updateContext(conversationId, {
                previousDocuments: searchResults,
                previousQuery: query
            });

            const endTime = Date.now();
            const totalDuration = endTime - startTime;

            console.log(`\n=== Request Statistics ===`);
            console.log(`Celkový čas: ${totalDuration}ms`);
            console.log(`Počet získaných dokumentov: ${searchResults.length}`);
            console.log(`Počet chunkov: ${allDocs.length}`);
            console.log(`Počet záverov: ${conclusions.length}`);
            console.log(`=====================\n`);

            return searchResults;
        } catch (error) {
            console.error('Chyba pri vyhľadávaní dokumentov:', error);
            throw error;
        }
    }

    private async getUniqueCaseIds(query: string): Promise<Set<string>> {
        const results = await this.safeSimilaritySearch(query, 3);
        const caseIds = new Set<string>();
        for (const doc of results) {
            const caseId = doc.metadata['Identifikačné číslo spisu'];
            if (caseId) caseIds.add(caseId);
        }
        return caseIds;
    }

    private async fetchCaseChunks(caseId: string): Promise<{ chunks?: Document[], conclusion?: Document }> {
        try {
            const filter = {
                must: [
                    {
                        key: "Identifikačné číslo spisu",
                        match: { value: caseId }
                    }
                ]
            };

            const caseDocs = await this.safeSimilaritySearch("", 3, filter);
            const chunks: Document[] = [];
            let conclusion: Document | undefined;

            for (const doc of caseDocs) {
                if (doc.metadata.type === 'conclusion') {
                    conclusion = doc;
                } else {
                    chunks.push(doc);
                }
            }

            return { chunks, conclusion };
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
${results.map(r => r.payload.text).join('\n\n')}

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
        // Create summary section efficiently
        const summarySection = results.map((result, index) => {
            const { text, metadata } = result.payload;
            // Extract metadata from content if not in metadata
            const content = text || '';
            const caseNumber = metadata['Spisová značka'] || this.extractFromContent(content, 'Spisová značka:');
            const decisionDate = metadata['Dátum rozhodnutia'] || this.extractFromContent(content, 'Dátum rozhodnutia:');
            const court = metadata.Súd || this.extractFromContent(content, 'Súd:');
            const url = metadata.URL || this.extractFromContent(content, 'Url:');
            return `Case ${index + 1}: ${court} - ${caseNumber} (${decisionDate})
URL: ${url}`;
        }).join('\n');

        // Format documents efficiently
        const formattedResults = results.map((result, index) => {
            const { text, metadata } = result.payload;
            const content = text || 'No content available';

            // Extract metadata from content if not in metadata
            const caseNumber = metadata['Spisová značka'] || this.extractFromContent(content, 'Spisová značka:');
            const decisionDate = metadata['Dátum rozhodnutia'] || this.extractFromContent(content, 'Dátum rozhodnutia:');
            const court = metadata.Súd || this.extractFromContent(content, 'Súd:');
            const judge = metadata.Sudca || this.extractFromContent(content, 'Sudca:');
            const ecli = metadata['ECLI (Európsky identifikátor judikatúry)'] || this.extractFromContent(content, 'ECLI (Európsky identifikátor judikatúry):');
            const url = metadata.URL || this.extractFromContent(content, 'Url:');
            const caseId = metadata['Identifikačné číslo spisu'] || this.extractFromContent(content, 'Identifikačné číslo spisu:');
            const docType = metadata.type || this.extractFromContent(content, 'Type:');
            const chunkIndex = metadata.chunk_index || this.extractFromContent(content, 'Chunk Index:');
            const areaOfLaw = metadata['Oblasť právnej úpravy'] || this.extractFromContent(content, 'Oblasť právnej úpravy:');
            const subAreaOfLaw = metadata['Podoblasť právnej úpravy'] || this.extractFromContent(content, 'Podoblasť právnej úpravy:');
            const natureOfDecision = metadata['Povaha rozhodnutia'] || this.extractFromContent(content, 'Povaha rozhodnutia:');
            const decisionForm = metadata['Forma rozhodnutia'] || this.extractFromContent(content, 'Forma rozhodnutia:');
            const title = metadata.Názov || this.extractFromContent(content, 'Názov:') || 'Untitled';

            // Format content efficiently - remove metadata lines
            const formattedContent = content
                .split('\n')
                .filter(line => {
                    const trimmedLine = line.trim();
                    return trimmedLine &&
                        !trimmedLine.startsWith('Dátum rozhodnutia:') &&
                        !trimmedLine.startsWith('ECLI') &&
                        !trimmedLine.startsWith('Forma rozhodnutia:') &&
                        !trimmedLine.startsWith('Identifikačné číslo spisu:') &&
                        !trimmedLine.startsWith('Názov:') &&
                        !trimmedLine.startsWith('Oblasť právnej úpravy:') &&
                        !trimmedLine.startsWith('PDF url:') &&
                        !trimmedLine.startsWith('Podoblasť právnej úpravy:') &&
                        !trimmedLine.startsWith('Povaha rozhodnutia:') &&
                        !trimmedLine.startsWith('Pôvodná spisová značka:') &&
                        !trimmedLine.startsWith('Pôvodný súd:') &&
                        !trimmedLine.startsWith('Spisová značka:') &&
                        !trimmedLine.startsWith('Sudca:') &&
                        !trimmedLine.startsWith('Súd:') &&
                        !trimmedLine.startsWith('Url:') &&
                        !trimmedLine.startsWith('Väzby na predpisy') &&
                        !trimmedLine.startsWith('Chunk Index:') &&
                        !trimmedLine.startsWith('Type:');
                })
                .map(line => line.trim())
                .filter(Boolean)
                .join('\n');

            return `Document: ${title}
Court: ${court}
Case Number: ${caseNumber}
Case ID: ${caseId}
Decision Date: ${decisionDate}
Judge: ${judge}
ECLI: ${ecli}
URL: ${url}
Type: ${docType}
Chunk Index: ${chunkIndex}
Area of Law: ${areaOfLaw}
Sub-area of Law: ${subAreaOfLaw}
Nature of Decision: ${natureOfDecision}
Decision Form: ${decisionForm}

Content:
${formattedContent}

Relevance Score: ${result.score.toFixed(4)}
-------------------`;
        }).join('\n\n');

        return `=== Relevant Court Cases ===
${summarySection}

=== Detailed Documents ===
${formattedResults}`;
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

    private async generateResponseWithContext(
        question: string,
        context: string,
        history: ChatMessage[],
        conversationId: string
    ): Promise<string> {
        try {
            const conversationContext = this.getOrCreateContext(conversationId);
            
            // Run all checks in parallel
            const [isLegal, domain, needsRag] = await Promise.all([
                this.isLegalQuestion(question, conversationId),
                this.classifyLegalDomain(question, conversationId),
                this.decideIfRagNeeded(question, conversationId)
            ]);

            if (!isLegal) {
                return ERROR_MESSAGES.INVALID_QUERY;
            }

            if (!needsRag) {
                return 'Táto otázka nevyžaduje vyhľadávanie v právnych dokumentoch.';
            }

            console.log('Klasifikovaná právna doména:', domain);

            // Update context with new information
            this.updateContext(conversationId, {
                history: [...conversationContext.history, ...history],
                previousDomain: domain
            });

            // Format history efficiently, including previous context
            const historyStr = conversationContext.history
                .slice(-this.MAX_HISTORY_LENGTH)
                .map(msg => `${msg.role}: ${msg.content}`)
                .join('\n');

            // Add previous domain context if relevant
            const domainContext = conversationContext.previousDomain && 
                conversationContext.previousDomain !== domain ? 
                `\nPrevious legal domain: ${conversationContext.previousDomain}` : '';

            // Generate response using the template
            const prompt = RETRIEVAL_PROMPTS.RAG_RESPONSE
                .replace('{domain}', domain || 'právo')
                .replace('{question}', question)
                .replace('{history}', historyStr)
                .replace('{context}', context + domainContext);

            // Log only essential information
            console.log('\n🤖 Sending prompt to OpenAI (length:', prompt.length, 'chars)');

            const response = await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, conversationId);

            console.log('\n✅ Response received from OpenAI');

            return response;
        } catch (error) {
            console.error('Chyba pri generovaní odpovede s kontextom:', error);
            throw error;
        }
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
        try {
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
}

export const retrievalService = RetrievalService.getInstance();
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

class RetrievalService {
    private static instance: RetrievalService;
    private vectorStore: QdrantVectorStore;
    private embeddings: OpenAIEmbeddings;
    private openAIService: OpenAIService;
    private readonly COLLECTION_NAME = process.env.QDRANT_COLLECTION || '500_chunk_size_10_overlap_court_judgements';
    private readonly BASE_URL: string;

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
            const prompt = `Rozšírte túto právnu otázku o relevantné právne termíny a koncepty:
${query}

Prosím poskytnite rozšírenú verziu otázky, ktorá zahŕňa:
1. Relevantné právne termíny
2. Súvisiace koncepty
3. Špecifické zákony alebo predpisy
4. Právne oblasti`;

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
            searchResults.forEach((result, index) => {
                console.log(`\n📄 Document ${index + 1} Raw Payload:`, {
                    score: result.score,
                    payload: result.payload,
                    payloadKeys: Object.keys(result.payload || {})
                });
            });

            // Convert Qdrant results to LangChain documents
            const documents = searchResults.map(result => {
                // Try to get content from different possible locations in the payload
                let content = '';
                const payload = result.payload as Record<string, any>;
                
                // First try the standard LangChain format
                if (payload?.pageContent) {
                    content = payload.pageContent;
                }
                // Then try the raw text field
                else if (payload?.text) {
                    content = payload.text;
                }
                // Then try the obsah field
                else if (payload?.obsah) {
                    content = payload.obsah;
                }
                // Finally, try to get any text content from the payload
                else if (payload) {
                    // Try to find any string value in the payload
                    for (const [key, value] of Object.entries(payload)) {
                        if (typeof value === 'string' && value.length > 0) {
                            content = value;
                            break;
                        }
                    }
                }

                if (!content) {
                    console.log('No content found in payload, using default');
                    content = 'No content available';
                }

                console.log('Final content length:', content.length);
                
                // Create a new document with the correct content
                return new Document({
                    pageContent: content,
                    metadata: {
                        ...payload,
                        // Remove content fields from metadata since they're now in pageContent
                        pageContent: undefined,
                        text: undefined,
                        obsah: undefined
                    }
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

    public async searchRelevantDocuments(query: string, conversationId: string): Promise<SearchResult[]> {
        try {
            const startTime = Date.now();
            console.log('\n=== Začínam vyhľadávanie relevantných dokumentov ===');
            console.log('Otázka:', query);

            // Expand the query with relevant legal terms
            const expandedQuery = await this.expandQuery(query, conversationId);
            console.log('Rozšírená otázka:', expandedQuery);

            // Initial search with limit of 3
            let results = await this.safeSimilaritySearch(expandedQuery, 3);

            // Fallback search if no results
            if (!results.length) {
                console.warn('No initial documents retrieved, trying fallback search with increased k');
                results = await this.safeSimilaritySearch(expandedQuery, 3);
            }

            // Get unique case IDs
            const caseIds = new Set<string>();
            for (const doc of results) {
                const caseId = doc.metadata['Identifikačné číslo spisu'];
                if (caseId) {
                    caseIds.add(caseId);
                }
            }

            console.log(`Identified ${caseIds.size} unique case IDs`);

            // Fetch all chunks for identified cases
            const allDocs: Document[] = [];
            const conclusions: Document[] = [];

            for (const caseId of caseIds) {
                try {
                    console.log(`Fetching all chunks for case ID ${caseId}`);
                    // Simplified filter structure for Qdrant
                    const filter = {
                        must: [
                            {
                                key: "Identifikačné číslo spisu",
                                match: {
                                    value: caseId
                                }
                            }
                        ]
                    };
                    
                    // Use a simpler query for case-specific search
                    const caseDocs = await this.safeSimilaritySearch("", 3, filter);
                    
                    for (const doc of caseDocs) {
                        const docType = doc.metadata.type || 'chunk';
                        if (docType === 'conclusion') {
                            conclusions.push(doc);
                        } else {
                            allDocs.push(doc);
                        }
                    }
                } catch (error) {
                    console.error(`Error fetching chunks for case ${caseId}:`, error);
                    continue;
                }
            }

            // Fallback to initial documents if no additional chunks
            if (!allDocs.length && !conclusions.length) {
                console.warn('Failed to fetch additional chunks, using initial documents only');
                allDocs.push(...results);
            }

            // Sort documents by chunk index
            allDocs.sort((a, b) => (a.metadata.chunk_index || 0) - (b.metadata.chunk_index || 0));
            conclusions.sort((a, b) => (a.metadata.chunk_index || 0) - (b.metadata.chunk_index || 0));

            // Combine chunks and conclusions
            const knowledgeChunks = allDocs.map(doc => doc.pageContent || doc.metadata.obsah).join('\n\n');
            const knowledgeConclusions = conclusions.map(doc => doc.pageContent || doc.metadata.obsah).join('\n\n');
            const knowledge = conclusions.length 
                ? `### Conclusions\n${knowledgeConclusions}\n\n### Chunks\n${knowledgeChunks}`
                : knowledgeChunks;

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

            const endTime = Date.now();
            const duration = endTime - startTime;
            
            // Calculate approximate costs (based on OpenAI's pricing)
            const embeddingCost = (expandedQuery.length / 1000) * 0.0001; // $0.0001 per 1K tokens for text-embedding-3-large
            const totalCost = embeddingCost;

            console.log(`\n=== Request Statistics ===`);
            console.log(`Duration: ${duration}ms`);
            console.log(`Approximate Cost: $${totalCost.toFixed(4)}`);
            console.log(`Documents Retrieved: ${searchResults.length}`);
            console.log(`=====================\n`);

            return searchResults;
        } catch (error) {
            console.error('Chyba pri vyhľadávaní dokumentov:', error);
            throw error;
        }
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
        console.log('\n📝 ===== FORMATTING SEARCH RESULTS =====');
        
        const formattedResults = results.map((result, index) => {
            const { text, metadata } = result.payload;
            console.log(`\n📄 Formatting Document ${index + 1}:`);
            console.log('Raw Metadata:', JSON.stringify(metadata, null, 2));
            
            // Decode and format the content
            const content = text || 'No content available';
            const formattedContent = content
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .join('\n');

            const formattedDoc = `
Document: ${metadata.Názov || 'Untitled'}
Court: ${metadata.Súd || 'N/A'}
Case Number: ${metadata['Spisová značka'] || 'N/A'}
Decision Date: ${metadata['Dátum rozhodnutia'] || 'N/A'}
Judge: ${metadata.Sudca || 'N/A'}
ECLI: ${metadata['ECLI (Európsky identifikátor judikatúry)'] || 'N/A'}
Type: ${metadata.type || 'N/A'}
Chunk Index: ${metadata.chunk_index || 'N/A'}
Area of Law: ${metadata['Oblasť právnej úpravy'] || 'N/A'}
Sub-area of Law: ${metadata['Podoblasť právnej úpravy'] || 'N/A'}
Nature of Decision: ${metadata['Povaha rozhodnutia'] || 'N/A'}
Decision Form: ${metadata['Forma rozhodnutia'] || 'N/A'}

Content:
${formattedContent}

Relevance Score: ${result.score.toFixed(4)}
-------------------`;
            
            console.log('Formatted Document:', formattedDoc);
            return formattedDoc;
        }).join('\n\n');

        console.log('\n✅ ===== FORMATTING COMPLETE =====\n');
        return formattedResults;
    }

    private async generateResponseWithContext(
        question: string,
        context: string,
        history: ChatMessage[],
        conversationId: string
    ): Promise<string> {
        try {
            // Check if this is a legal question
            const isLegal = await this.isLegalQuestion(question, conversationId);
            if (!isLegal) {
                return 'Toto nie je právna otázka. Prosím sformulujte otázku týkajúcu sa práva.';
            }

            // Classify the legal domain
            const domain = await this.classifyLegalDomain(question, conversationId);
            console.log('Klasifikovaná právna doména:', domain);

            // Decide if RAG is needed
            const needsRag = await this.decideIfRagNeeded(question, conversationId);
            if (!needsRag) {
                return 'Táto otázka nevyžaduje vyhľadávanie v právnych dokumentoch.';
            }

            // Format history
            const historyStr = history.map(msg => `${msg.role}: ${msg.content}`).join('\n');

            // Generate the RAG prompt
            const prompt = `Si právnický asistent špecializovaný na ${domain || 'právo'} (ak je doména uvedená, rešpektuj ju striktne).
Odpovedaj na otázky výlučne na základe informácií poskytnutých v časti "Znalosti" a ich metadát.
Nepoužívaj svoju internú znalosť, iba ak nemôžeš nájsť relevantné údaje v "Znalostiach" pre všeobecné otázky.
Ak použiješ internú znalosť, upozorni, že ide o nepresné údaje mimo zákonov či databázy.
Cituj konkrétne časti rozsudkov (odseky, paragrafy) alebo zákonov (články, paragrafy) a uveď názov dokumentu (napr. 'Rozsudok 3T/115/2023') a URL z metadát, ak je k dispozícii.
Ak odpoveď nie je v súlade s uvedenou doménou, upozorni na to a poskytni všeobecnú odpoveď.

Otázka: ${question}

História konverzácie: ${historyStr}

Znalosti: ${context}

Prosím poskytnite:
1. Priamu odpoveď na otázku
2. Relevantné právne zásady
3. Aplikovateľné zákony a predpisy
4. Praktické príklady alebo prípady
5. Dôležité úvahy alebo varovania`;

            console.log('\nResponse Generation Prompt:');
            console.log(prompt);

            const response = await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, conversationId);

            console.log('\n=== Vygenerovaná odpoveď ===');
            console.log(response);
            console.log('\n=== Koniec odpovede ===\n');

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
            const prompt = `Analyzujte túto otázku a určite, či ide o právnu otázku:
${question}

Odpovedzte POUZE "áno" alebo "nie".`;

            const response = await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, conversationId);
            return response.trim().toLowerCase() === 'áno';
        } catch (error) {
            console.error('Chyba pri kontrole právnej otázky:', error);
            return false;
        }
    }

    private async classifyLegalDomain(question: string, conversationId: string): Promise<string> {
        try {
            const prompt = `Klasifikujte túto právnu otázku do jednej z týchto kategórií:
1. trestné právo
2. občianske právo
3. obchodné právo
4. správne právo
5. ústavné právo
6. medzinárodné právo
7. pracovné právo
8. rodinné právo
9. finančné právo
10. iné

Otázka: ${question}

Odpovedzte POUZE názvom kategórie.`;

            const domain = await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, conversationId);
            return domain.trim().toLowerCase();
        } catch (error) {
            console.error('Chyba pri klasifikácii právnej domény:', error);
            return 'iné';
        }
    }

    private async decideIfRagNeeded(question: string, conversationId: string): Promise<boolean> {
        try {
            const prompt = `Analyzujte túto otázku a určite, či vyžaduje RAG (Retrieval Augmented Generation):
${question}

Odpovedzte POUZE "áno" alebo "nie".`;

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
            const prompt = `Na základe nasledujúceho súdneho rozhodnutia vygenerujte stručné zhrnutie:
${fullCaseText}

Prosím poskytnite:
1. Kľúčové body rozhodnutia
2. Právne zásady
3. Dôležité precedenty
4. Praktické dôsledky`;

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
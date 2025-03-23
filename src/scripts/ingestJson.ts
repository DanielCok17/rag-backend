import { QdrantClientSingleton } from '../db/qdrantClient';
import { QdrantMetadata, QdrantRecord } from '../types/qdrant';
import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';
import OpenAI from 'openai';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { v4 as uuidv4 } from 'uuid';

config();

interface CourtJudgment {
    Názov: string;
    Url: string;
    'PDF url': string;
    'Identifikačné číslo spisu': string;
    Súd: string;
    'Spisová značka': string;
    'Dátum rozhodnutia': string;
    Sudca: string;
    'ECLI (Európsky identifikátor judikatúry)': string;
    'Forma rozhodnutia': string;
    'Oblasť právnej úpravy': string;
    'Podoblasť právnej úpravy': string;
    'Povaha rozhodnutia': string;
    'Väzby na predpisy Zbierky zákonov SR': Record<string, string>;
    Obsah: string;
    Zhrnutie: string;
}

async function generateEmbeddings(text: string): Promise<number[]> {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
    });

    const response = await openai.embeddings.create({
        model: "text-embedding-3-large",
        input: text
    });

    return response.data[0].embedding;
}

async function chunkText(text: string, chunkSize: number = 4000, overlap: number = 200): Promise<string[]> {
    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize,
        chunkOverlap: overlap,
        separators: ["\n\n", "\n", " ", ""],
        lengthFunction: (text) => text.length,
    });

    return await splitter.splitText(text);
}

async function checkDuplicate(client: any, collectionName: string, caseId: string): Promise<boolean> {
    try {
        const response = await client.scroll(collectionName, {
            filter: {
                must: [
                    {
                        key: 'caseId',
                        match: { value: caseId }
                    }
                ]
            },
            limit: 1
        });
        return response.points.length > 0;
    } catch (error) {
        console.error('Error checking for duplicates:', error);
        return false;
    }
}

async function ingestJsonFiles(directoryPath: string): Promise<void> {
    try {
        const client = QdrantClientSingleton.getInstance();
        const collectionName = process.env.QDRANT_COLLECTION || 'full_documents_with_summaries_court_judgments';

        // Check if collection exists, create if it doesn't
        const collections = await client.getCollections();
        if (!collections.collections.some(c => c.name === collectionName)) {
            console.log(`Creating new collection: ${collectionName}`);
            await client.createCollection(collectionName, {
                vectors: {
                    size: 3072, // Match text-embedding-3-large model dimensions
                    distance: 'Cosine'
                }
            });
        }

        // Read all JSON files from the directory
        const files = fs.readdirSync(directoryPath)
            .filter(file => file.endsWith('.json'));

        console.log(`Found ${files.length} JSON files to process`);

        let totalDocuments = 0;
        let processedFiles = 0;
        let skippedDuplicates = 0;

        for (const file of files) {
            console.log(`\nProcessing file: ${file}`);
            const filePath = path.join(directoryPath, file);
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const document = JSON.parse(fileContent) as CourtJudgment;

            // Check for duplicates
            const isDuplicate = await checkDuplicate(client, collectionName, document['Identifikačné číslo spisu']);
            if (isDuplicate) {
                console.log(`Skipping duplicate case ID: ${document['Identifikačné číslo spisu']}`);
                skippedDuplicates++;
                continue;
            }

            // Generate embedding for summary
            const summaryEmbedding = await generateEmbeddings(document.Zhrnutie);

            // Chunk the content
            const contentChunks = await chunkText(document.Obsah);
            console.log(`Split content into ${contentChunks.length} chunks`);

            // Generate embeddings for each chunk
            const contentEmbeddings = await Promise.all(
                contentChunks.map(chunk => generateEmbeddings(chunk))
            );

            // Prepare points for upload
            const points = [
                // Add summary point
                {
                    id: uuidv4(),
                    vector: summaryEmbedding,
                    payload: {
                        title: document.Názov,
                        url: document.Url,
                        pdfUrl: document['PDF url'],
                        caseId: document['Identifikačné číslo spisu'],
                        court: document.Súd,
                        caseNumber: document['Spisová značka'],
                        decisionDate: document['Dátum rozhodnutia'],
                        judge: document.Sudca,
                        ecli: document['ECLI (Európsky identifikátor judikatúry)'],
                        decisionForm: document['Forma rozhodnutia'],
                        legalArea: document['Oblasť právnej úpravy'],
                        legalSubArea: document['Podoblasť právnej úpravy'],
                        decisionNature: document['Povaha rozhodnutia'],
                        legalReferences: document['Väzby na predpisy Zbierky zákonov SR'],
                        content: document.Obsah,
                        summary: document.Zhrnutie,
                        text: document.Zhrnutie,
                        type: 'summary',
                        originalId: `${path.basename(file, '.json')}_summary`
                    }
                },
                // Add content chunk points
                ...contentChunks.map((chunk, index) => ({
                    id: uuidv4(),
                    vector: contentEmbeddings[index],
                    payload: {
                        title: document.Názov,
                        url: document.Url,
                        pdfUrl: document['PDF url'],
                        caseId: document['Identifikačné číslo spisu'],
                        court: document.Súd,
                        caseNumber: document['Spisová značka'],
                        decisionDate: document['Dátum rozhodnutia'],
                        judge: document.Sudca,
                        ecli: document['ECLI (Európsky identifikátor judikatúry)'],
                        decisionForm: document['Forma rozhodnutia'],
                        legalArea: document['Oblasť právnej úpravy'],
                        legalSubArea: document['Podoblasť právnej úpravy'],
                        decisionNature: document['Povaha rozhodnutia'],
                        legalReferences: document['Väzby na predpisy Zbierky zákonov SR'],
                        content: document.Obsah,
                        summary: document.Zhrnutie,
                        text: chunk,
                        type: 'content',
                        chunkIndex: index,
                        totalChunks: contentChunks.length,
                        originalId: `${path.basename(file, '.json')}_content_${index}`
                    }
                }))
            ];

            // Upload the points
            await client.upsert(collectionName, {
                points: points
            });

            totalDocuments += points.length;
            processedFiles++;
            console.log(`Successfully processed ${file}`);
            console.log(`Progress: ${processedFiles}/${files.length} files (${totalDocuments} total documents)`);
        }

        // Get final collection stats
        const stats = await client.count(collectionName);
        console.log('\nIngestion completed successfully!');
        console.log(`Total documents in collection: ${stats.count}`);
        console.log(`Total files processed: ${processedFiles}`);
        console.log(`Total documents ingested: ${totalDocuments}`);
        console.log(`Duplicates skipped: ${skippedDuplicates}`);
    } catch (error) {
        console.error('Error during ingestion:', error);
        throw error;
    }
}

// Use the specified directory path
const directoryPath = '/Users/danielcok/Solty/AI Solutions/langchain-ui/data/full_documents_with_summaries';
console.log(`Using directory: ${directoryPath}`);

ingestJsonFiles(directoryPath)
    .then(() => console.log('Ingestion completed successfully'))
    .catch(error => {
        console.error('Ingestion failed:', error);
        process.exit(1);
    }); 
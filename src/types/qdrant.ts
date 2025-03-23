import { z } from 'zod';

export const QdrantMetadataSchema = z.object({
    title: z.string().optional(),
    url: z.string().optional(),
    pdfUrl: z.string().optional(),
    caseId: z.string().optional(),
    court: z.string().optional(),
    caseNumber: z.string().optional(),
    decisionDate: z.string().optional(),
    judge: z.string().optional(),
    ecli: z.string().optional(),
    decisionForm: z.string().optional(),
    legalArea: z.string().optional(),
    legalSubArea: z.string().optional(),
    decisionNature: z.string().optional(),
    legalReferences: z.record(z.string()).optional(),
    content: z.string().optional(),
    summary: z.string().optional(),
    text: z.string().optional(),
    type: z.string().optional(),
    chunkIndex: z.number().optional(),
    totalChunks: z.number().optional(),
    originalId: z.string().optional(),
});

export type QdrantMetadata = z.infer<typeof QdrantMetadataSchema>;

export const QdrantRecordSchema = z.object({
    id: z.string(),
    score: z.number(),
    payload: QdrantMetadataSchema,
    vector: z.array(z.number()),
});

export type QdrantRecord = z.infer<typeof QdrantRecordSchema>;

export interface TranslatedQdrantRecord {
    id: string;
    score: number;
    metadata: {
        title: string;
        url: string;
        pdfUrl: string;
        caseId: string;
        court: string;
        caseNumber: string;
        decisionDate: string;
        judge: string;
        ecli: string;
        decisionForm: string;
        legalArea: string;
        legalSubArea: string;
        decisionNature: string;
        legalReferences: Record<string, string>;
        content: string;
        summary: string;
        text: string;
        type: string;
        chunkIndex?: number;
        totalChunks?: number;
        originalId: string;
    };
    vector: number[];
    vectorInterpretation?: string;
} 
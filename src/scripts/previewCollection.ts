import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

interface Point {
    id: string;
    payload: {
        text: string;
        metadata: Record<string, any>;
    };
}

const COLLECTION_NAME = process.env.QDRANT_COLLECTION || '500_chunk_size_10_overlap_court_judgements';

async function previewCollectionJson(): Promise<Point[]> {
    const qdrantClient = new QdrantClient({
        url: `http://${process.env.QDRANT_HOST || 'localhost'}:${process.env.QDRANT_PORT || '6333'}`,
    });

    try {
        console.log(`Collection name: ${COLLECTION_NAME}`);
        let offset: number | null = 0;
        const limit = 10;
        const points: Point[] = [];

        while (offset !== null) {
            const response = await qdrantClient.scroll(COLLECTION_NAME, {
                offset,
                limit,
                with_payload: true,
            });

            points.push(...response.points.map(point => ({
                id: point.id as string,
                payload: {
                    text: (point.payload as any).text || '',
                    metadata: (point.payload as any).metadata || {}
                }
            })));

            offset = response.next_page_offset as number | null;
        }

        console.log('Points:', JSON.stringify(points, null, 2));
        return points;
    } catch (error) {
        console.error('Error previewing collection:', error);
        return [];
    }
}

async function main() {
    try {
        // Get all records in JSON format
        const points = await previewCollectionJson();
        
        // Save to file
        const outputFile = path.join(__dirname, 'collection_preview.json');
        fs.writeFileSync(outputFile, JSON.stringify(points, null, 2), 'utf-8');
        
        console.log(`\n💾 Preview saved to: ${outputFile}`);
        console.log('✅ ===== COLLECTION PREVIEW COMPLETE =====\n');
    } catch (error) {
        console.error('❌ Error in main:', error);
        process.exit(1);
    }
}

// Run the script
main(); 
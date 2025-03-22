import { QdrantClient } from '@qdrant/js-client-rest';
import * as dotenv from 'dotenv';

dotenv.config();

interface QdrantConfig {
  host: string;
  port: string;
  collectionName: string;
}

interface CollectionInfo {
  name: string;
}

interface CollectionsList {
  collections: CollectionInfo[];
}

interface VectorConfig {
  size: number;
  distance: 'Cosine' | 'Euclid' | 'Dot' | 'Manhattan';
}

export class QdrantClientSingleton {
  private static instance: QdrantClient;
  private static readonly config = {
    host: process.env.QDRANT_HOST || 'localhost',
    port: process.env.QDRANT_PORT || '6333',
    collection: process.env.QDRANT_COLLECTION || '500_chunk_size_10_overlap_court_judgements'
  };

  private static readonly baseUrl = `http://${QdrantClientSingleton.config.host}:${QdrantClientSingleton.config.port}`;

  private constructor() { }

  public static getInstance(): QdrantClient {
    if (!QdrantClientSingleton.instance) {
      QdrantClientSingleton.instance = new QdrantClient({
        url: QdrantClientSingleton.baseUrl,
        timeout: 30000,
      });
      console.log(`Qdrant client initialized at: ${QdrantClientSingleton.baseUrl}`);
      console.log('Using Qdrant collection:', QdrantClientSingleton.config.collection);
    }
    return QdrantClientSingleton.instance;
  }

  public static getCollectionName(): string {
    return QdrantClientSingleton.config.collection;
  }

  public static async collectionExists(collectionName: string = this.config.collection): Promise<boolean> {
    try {
      const client = QdrantClientSingleton.getInstance();
      const collections = await client.getCollections();
      return collections.collections.some(c => c.name === collectionName);
    } catch (error) {
      console.error('Error checking collection existence:', error);
      return false;
    }
  }

  public static async waitForCollection(collectionName: string = this.config.collection): Promise<void> {
    const maxAttempts = 30;
    const delayMs = 1000;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const exists = await QdrantClientSingleton.collectionExists(collectionName);
      if (exists) {
        console.log(`Collection '${collectionName}' ready`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
      attempts++;
    }

    throw new Error(`Collection '${collectionName}' not found after ${maxAttempts} attempts`);
  }
}

// Usage in index.ts
async function bootstrap() {
  try {
    await QdrantClientSingleton.waitForCollection();
    console.log('Application started successfully');
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

bootstrap();

export default QdrantClientSingleton;
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
  private static instance: QdrantClient | null = null;
  private static isConnected: boolean = false;
  private static readonly config = {
    host: process.env.QDRANT_HOST || 'localhost',
    port: process.env.QDRANT_PORT || '6333',
    apiKey: process.env.QDRANT_API_KEY || '',
    collection: process.env.QDRANT_COLLECTION || '500_chunk_size_10_overlap_court_judgements'
  };

  private static readonly baseUrl = `http://${QdrantClientSingleton.config.host}:${QdrantClientSingleton.config.port}`;

  private constructor() { }

  public static getInstance(): QdrantClient | null {
    if (!QdrantClientSingleton.instance) {
      try {
        QdrantClientSingleton.instance = new QdrantClient({
          url: QdrantClientSingleton.baseUrl,
          apiKey: QdrantClientSingleton.config.apiKey,
          timeout: 30000
        });
        console.log(`Qdrant client initialized at: ${QdrantClientSingleton.baseUrl}`);
        console.log('Using Qdrant collection:', QdrantClientSingleton.config.collection);
      } catch (error) {
        console.error('Failed to initialize Qdrant client:', error);
        return null;
      }
    }
    return QdrantClientSingleton.instance;
  }

  public static getCollectionName(): string {
    return QdrantClientSingleton.config.collection;
  }

  public static async collectionExists(collectionName: string = this.config.collection): Promise<boolean> {
    try {
      const client = QdrantClientSingleton.getInstance();
      if (!client) {
        console.warn('Qdrant client not initialized, skipping collection check');
        return false;
      }
      const collections = await client.getCollections();
      return collections.collections.some(c => c.name === collectionName);
    } catch (error) {
      console.warn('Error checking collection existence:', error);
      return false;
    }
  }

  public static async waitForCollection(collectionName: string = this.config.collection): Promise<void> {
    const maxAttempts = 3; // Reduced from 30 to 3 for faster startup
    const delayMs = 1000;
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const exists = await QdrantClientSingleton.collectionExists(collectionName);
        if (exists) {
          console.log(`Collection '${collectionName}' ready`);
          QdrantClientSingleton.isConnected = true;
          return;
        }
      } catch (error) {
        console.warn(`Attempt ${attempts + 1}/${maxAttempts}: Failed to connect to Qdrant:`, error);
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
      attempts++;
    }

    console.warn(`Warning: Could not connect to Qdrant collection '${collectionName}' after ${maxAttempts} attempts. Application will continue without Qdrant functionality.`);
    QdrantClientSingleton.isConnected = false;
  }

  public static isQdrantConnected(): boolean {
    return QdrantClientSingleton.isConnected;
  }
}

// Usage in index.ts
async function bootstrap() {
  try {
    await QdrantClientSingleton.waitForCollection();
    if (QdrantClientSingleton.isQdrantConnected()) {
      console.log('Qdrant connection established successfully');
    } else {
      console.log('Application starting without Qdrant connection');
    }
  } catch (error) {
    console.warn('Warning: Failed to connect to Qdrant. Application will continue without Qdrant functionality:', error);
  }
}

bootstrap();

export default QdrantClientSingleton;
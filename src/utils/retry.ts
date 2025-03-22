import { logger } from './logger';

interface RetryOptions {
    maxAttempts: number;
    minDelay: number;
    maxDelay: number;
}

export async function withRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions = { maxAttempts: 3, minDelay: 1000, maxDelay: 10000 }
): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error as Error;
            logger.warn(`Attempt ${attempt} failed: ${error}`);
            
            if (attempt === options.maxAttempts) {
                break;
            }
            
            // Exponential backoff
            const delay = Math.min(
                options.minDelay * Math.pow(2, attempt - 1),
                options.maxDelay
            );
            
            logger.info(`Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw lastError;
} 
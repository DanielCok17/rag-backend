import winston from 'winston';
import path from 'path';

class LoggerService {
    private static instance: LoggerService;
    private logger: winston.Logger;

    private constructor() {
        // Define log format
        const logFormat = winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.json()
        );

        // Create the logger
        this.logger = winston.createLogger({
            level: process.env.LOG_LEVEL || 'info',
            format: logFormat,
            transports: [
                // Console transport for development
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.colorize(),
                        winston.format.simple()
                    )
                }),
                // File transport for errors
                new winston.transports.File({
                    filename: path.join('logs', 'error.log'),
                    level: 'error',
                    maxsize: 5242880, // 5MB
                    maxFiles: 5
                }),
                // File transport for all logs
                new winston.transports.File({
                    filename: path.join('logs', 'combined.log'),
                    maxsize: 5242880, // 5MB
                    maxFiles: 5
                })
            ]
        });
    }

    public static getInstance(): LoggerService {
        if (!LoggerService.instance) {
            LoggerService.instance = new LoggerService();
        }
        return LoggerService.instance;
    }

    public info(message: string, meta?: any): void {
        this.logger.info(message, meta);
    }

    public error(message: string, meta?: any): void {
        this.logger.error(message, meta);
    }

    public warn(message: string, meta?: any): void {
        this.logger.warn(message, meta);
    }

    public debug(message: string, meta?: any): void {
        this.logger.debug(message, meta);
    }

    public logWorkflowStep(step: string, data: any): void {
        this.info(`[WORKFLOW] ${step}`, {
            timestamp: new Date().toISOString(),
            ...data
        });
    }

    public logError(error: Error, context: string): void {
        this.error(`[ERROR] ${context}`, {
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name
            },
            timestamp: new Date().toISOString()
        });
    }

    public logPerformance(operation: string, duration: number, meta?: any): void {
        this.info(`[PERFORMANCE] ${operation}`, {
            duration,
            timestamp: new Date().toISOString(),
            ...meta
        });
    }
}

export const loggerService = LoggerService.getInstance(); 
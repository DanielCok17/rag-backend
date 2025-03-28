/**
 * Entry point of the rag-ai-lawyer application.
 * Initializes the server, configures middleware, and sets up error handling.
 */

import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import QdrantClientSingleton from './db/qdrantClient';
import SocketService from './services/socketService';
import routes from './routes';

class Application {
    private port: number;
    private app: express.Application;
    private httpServer: any;
    private socketService: SocketService;

    constructor() {
        this.port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3003;
        this.app = express();
        this.socketService = SocketService.getInstance();

        // Initialize the application
        this.initialize();
    }

    /**
     * Initializes the application with middleware, routes, and error handling.
     */
    private async initialize(): Promise<void> {
        try {
            // Initialize Qdrant collection
            await QdrantClientSingleton.waitForCollection();

            // Setup middleware
            this.setupMiddleware();

            // Setup routes
            this.setupRoutes();

            // Start the server
            this.startServer();
        } catch (error) {
            console.error('Failed to initialize application:', error);
            process.exit(1);
        }
    }

    /**
     * Sets up middleware for request handling, security, and performance optimization.
     */
    private setupMiddleware(): void {
        // Enable CORS
        this.app.use(cors());
        
        // Parse JSON bodies
        this.app.use(express.json());

        // Add request logging
        this.app.use((req, res, next) => {
            console.log(`${req.method} ${req.path}`);
            next();
        });

        console.log('Middleware initialized');
    }

    /**
     * Configures application routes.
     */
    private setupRoutes(): void {
        // Mount all routes under /api
        this.app.use('/api', routes);
        
        // Handle 404
        this.app.use((req, res) => {
            res.status(404).json({ error: 'Not Found' });
        });

        console.log('Routes configured');
    }

    /**
     * Starts the server and listens on the specified port.
     */
    private startServer(): void {
        // Create HTTP server
        this.httpServer = createServer(this.app);

        // Initialize WebSocket server
        this.socketService.initialize(this.httpServer);

        // Start listening
        this.httpServer.listen(this.port, () => {
            console.log(`Server is running on port ${this.port}`);
            console.log(`WebSocket endpoint: ws://localhost:${this.port}/api/stream`);
            console.log(`API endpoint: http://localhost:${this.port}/api`);
        });

        // Handle graceful shutdown
        process.on('SIGTERM', this.shutdown.bind(this));
        process.on('SIGINT', this.shutdown.bind(this));
    }

    /**
     * Handles server shutdown gracefully.
     */
    private shutdown(): void {
        console.log('Server shutting down...');
        if (this.httpServer) {
            this.httpServer.close(() => {
                console.log('HTTP server closed');
                process.exit(0);
            });
        }
    }
}

// Instantiate and start the application
const app = new Application();
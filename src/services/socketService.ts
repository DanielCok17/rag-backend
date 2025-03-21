import WebSocket from 'ws';
import { Server as HttpServer } from 'http';
import { IncomingMessage } from 'http';
import { parse as parseUrl } from 'url';
import OpenAIService from './openaiService';
import { WebSocketMessage } from '../types/chat';
import { ERROR_MESSAGES } from '../config/prompts';

class SocketService {
    private static instance: SocketService;
    private wss: WebSocket.Server;
    private sockets: Map<string, WebSocket>;
    private openAIService: OpenAIService;

    private constructor() {
        this.wss = new WebSocket.Server({ noServer: true });
        this.sockets = new Map();
        this.openAIService = OpenAIService.getInstance();
        this.setupWebSocketServer();
    }

    public static getInstance(): SocketService {
        if (!SocketService.instance) {
            SocketService.instance = new SocketService();
        }
        return SocketService.instance;
    }

    public initialize(server: HttpServer): void {
        server.on('upgrade', (request: IncomingMessage, socket: any, head: Buffer) => {
            const { pathname } = parseUrl(request.url || '');

            if (pathname === '/api/stream') {
                this.wss.handleUpgrade(request, socket, head, (ws) => {
                    this.wss.emit('connection', ws, request);
                });
            } else {
                socket.destroy();
            }
        });

        console.log('WebSocket server initialized at /api/stream');
    }

    private setupWebSocketServer(): void {
        this.wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
            const socketId = this.extractSocketId(request);
            if (!socketId) {
                ws.close(1008, 'Socket ID is required');
                return;
            }

            this.handleNewConnection(ws, socketId);
        });
    }

    private extractSocketId(request: IncomingMessage): string | null {
        return request.headers['x-socket-id'] as string || null;
    }

    private handleNewConnection(ws: WebSocket, socketId: string): void {
        console.log(`Client connected with socket ID: ${socketId}`);
        this.sockets.set(socketId, ws);

        this.setupMessageHandler(ws, socketId);
        this.setupCloseHandler(ws, socketId);
        this.sendConnectionConfirmation(socketId);
    }

    private setupMessageHandler(ws: WebSocket, socketId: string): void {
        ws.on('message', async (message: Buffer) => {
            try {
                const data = JSON.parse(message.toString());
                console.log('Received message:', data);
                
                const questionContent = data.content || data.question;
                
                if (data.type === 'question' && questionContent) {
                    await this.handleQuestion(socketId, questionContent);
                } else {
                    throw new Error('Invalid message format: missing type or question content');
                }
            } catch (error) {
                console.error('Error processing message:', error);
                this.sendError(socketId, error instanceof Error ? error.message : 'Failed to process message');
            }
        });
    }

    private setupCloseHandler(ws: WebSocket, socketId: string): void {
        ws.on('close', () => {
            console.log(`Client disconnected: ${socketId}`);
            this.sockets.delete(socketId);
        });
    }

    private sendConnectionConfirmation(socketId: string): void {
        this.sendMessage(socketId, {
            type: 'start',
            content: 'Connected to WebSocket server'
        });
    }

    private async handleQuestion(socketId: string, question: string): Promise<void> {
        try {
            this.validateQuestion(question);
            console.log(`Processing question for socket ${socketId}:`, question);

            await this.processQuestion(socketId, question);
        } catch (error) {
            console.error(`Error handling question for socket ${socketId}:`, error);
            this.sendError(socketId, error instanceof Error ? error.message : 'Failed to process question');
        }
    }

    private validateQuestion(question: string): void {
        if (!question || typeof question !== 'string') {
            throw new Error(ERROR_MESSAGES.INVALID_QUESTION);
        }
    }

    private async processQuestion(socketId: string, question: string): Promise<void> {
        this.sendMessage(socketId, {
            type: 'start',
            content: 'Processing your question...'
        });

        await this.openAIService.streamResponse(question, (chunk: string) => {
            if (chunk) {
                this.sendMessage(socketId, {
                    type: 'chunk',
                    content: chunk
                });
            }
        });

        this.sendMessage(socketId, {
            type: 'complete',
            content: 'Response completed'
        });
    }

    private sendMessage(socketId: string, message: WebSocketMessage): void {
        const ws = this.sockets.get(socketId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    public sendError(socketId: string, error: string): void {
        this.sendMessage(socketId, {
            type: 'error',
            error: error
        });
    }

    public sendStreamChunk(socketId: string, content: string): void {
        this.sendMessage(socketId, {
            type: 'chunk',
            content: content
        });
    }

    public sendStreamComplete(socketId: string, data: any): void {
        this.sendMessage(socketId, {
            type: 'complete',
            ...data
        });
    }

    public getWSS(): WebSocket.Server {
        return this.wss;
    }
}

export default SocketService; 
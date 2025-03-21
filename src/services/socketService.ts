import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { IncomingMessage } from 'http';
import { parse as parseUrl } from 'url';

class SocketService {
    private static instance: SocketService;
    private wss: WebSocketServer | null = null;
    private clients: Map<string, WebSocket> = new Map();
    private clientCounter: number = 0;

    private constructor() {}

    public static getInstance(): SocketService {
        if (!SocketService.instance) {
            SocketService.instance = new SocketService();
        }
        return SocketService.instance;
    }

    public initialize(server: HttpServer): void {
        this.wss = new WebSocketServer({ 
            noServer: true,
            path: "/api/stream"
        });

        server.on('upgrade', (request: IncomingMessage, socket: any, head: Buffer) => {
            const { pathname } = parseUrl(request.url || '');

            if (pathname === '/api/stream') {
                this.wss?.handleUpgrade(request, socket, head, (ws) => {
                    this.wss?.emit('connection', ws, request);
                });
            } else {
                socket.destroy();
            }
        });

        this.wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
            const clientId = `client_${++this.clientCounter}`;
            this.clients.set(clientId, ws);

            console.log('Client connected:', clientId);

            // Send connection confirmation
            this.sendToClient(clientId, {
                type: 'connected',
                clientId: clientId,
                timestamp: new Date().toISOString()
            });

            ws.on('message', (data: string) => {
                try {
                    const parsedData = JSON.parse(data.toString());
                    this.handleMessage(clientId, parsedData);
                } catch (error) {
                    console.error('Error parsing message:', error);
                    this.sendError(clientId, 'Invalid message format');
                }
            });

            ws.on('close', () => {
                console.log('Client disconnected:', clientId);
                this.clients.delete(clientId);
            });

            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                this.sendError(clientId, 'WebSocket error occurred');
            });
        });

        console.log('WebSocket server initialized at /api/stream');
    }

    private handleMessage(clientId: string, data: any) {
        if (data.type === 'question') {
            this.handleStreamStart(clientId, data.question);
        } else {
            this.sendToClient(clientId, {
                type: 'echo',
                data: data,
                timestamp: new Date().toISOString()
            });
        }
    }

    private async handleStreamStart(clientId: string, question: string) {
        try {
            console.log('Processing question:', question);
            // Mock streaming response for testing
            const mockResponse = "This is a test streaming response for: " + question;
            for (const char of mockResponse) {
                await new Promise(resolve => setTimeout(resolve, 100));
                this.sendStreamChunk(clientId, char);
            }
            this.sendStreamComplete(clientId, { 
                message: 'Stream completed',
                question: question
            });
        } catch (error) {
            console.error('Streaming error:', error);
            this.sendError(clientId, error instanceof Error ? error.message : 'Unknown error occurred');
        }
    }

    private sendToClient(clientId: string, data: any): void {
        const client = this.clients.get(clientId);
        if (client?.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    }

    public sendStreamChunk(clientId: string, chunk: string): void {
        this.sendToClient(clientId, {
            type: 'chunk',
            data: chunk,
            timestamp: new Date().toISOString()
        });
    }

    public sendStreamComplete(clientId: string, data: any): void {
        this.sendToClient(clientId, {
            type: 'complete',
            ...data,
            timestamp: new Date().toISOString()
        });
    }

    public sendError(clientId: string, error: string): void {
        this.sendToClient(clientId, {
            type: 'error',
            message: error,
            timestamp: new Date().toISOString()
        });
    }

    public getConnectedClients(): string[] {
        return Array.from(this.clients.keys());
    }
}

export default SocketService; 
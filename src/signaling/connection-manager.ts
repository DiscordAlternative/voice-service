import type { ServerMessage } from '../types/signaling';
import { logger } from '../config/logger';

interface Connection {
    ws: any; // Elysia WebSocket type
    userId: string;
    channelId?: string;
}

class ConnectionManager {
    private connections = new Map<string, Connection>();
    private userConnections = new Map<string, string>(); // userId -> connectionId

    addConnection(connectionId: string, ws: any, userId: string): void {
        this.connections.set(connectionId, { ws, userId });
        this.userConnections.set(userId, connectionId);
        logger.info({ connectionId, userId }, 'WebSocket connection added');
    }

    removeConnection(connectionId: string): void {
        const connection = this.connections.get(connectionId);
        if (connection) {
            this.userConnections.delete(connection.userId);
            this.connections.delete(connectionId);
            logger.info({ connectionId, userId: connection.userId }, 'WebSocket connection removed');
        }
    }

    getConnection(connectionId: string): Connection | undefined {
        return this.connections.get(connectionId);
    }

    getConnectionByUserId(userId: string): Connection | undefined {
        const connectionId = this.userConnections.get(userId);
        return connectionId ? this.connections.get(connectionId) : undefined;
    }

    setChannelId(connectionId: string, channelId: string): void {
        const connection = this.connections.get(connectionId);
        if (connection) {
            connection.channelId = channelId;
        }
    }

    send(connectionId: string, message: ServerMessage): void {
        const connection = this.connections.get(connectionId);
        if (connection) {
            try {
                connection.ws.send(JSON.stringify(message));
            } catch (error) {
                logger.error({ error, connectionId }, 'Failed to send message');
            }
        }
    }

    sendToUser(userId: string, message: ServerMessage): void {
        const connection = this.getConnectionByUserId(userId);
        if (connection) {
            try {
                connection.ws.send(JSON.stringify(message));
            } catch (error) {
                logger.error({ error, userId }, 'Failed to send message to user');
            }
        }
    }

    broadcastToChannel(channelId: string, message: ServerMessage, exceptUserId?: string): void {
        for (const [connectionId, connection] of this.connections) {
            if (connection.channelId === channelId && connection.userId !== exceptUserId) {
                try {
                    connection.ws.send(JSON.stringify(message));
                } catch (error) {
                    logger.error({ error, connectionId }, 'Failed to broadcast message');
                }
            }
        }
    }
}

export const connectionManager = new ConnectionManager();

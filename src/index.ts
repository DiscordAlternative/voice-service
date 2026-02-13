import { Elysia } from 'elysia';
import { config } from './config';
import { logger } from './config/logger';
import { redis } from './config/redis';
import { workerManager } from './media/worker-manager';
import { routerManager } from './media/router';
import { connectionManager } from './signaling/connection-manager';
import { handleMessage } from './signaling/message-handler';
import { verifyToken } from './utils/jwt';
import { generateId } from './utils/id-generator';
import { roomManager } from './rooms/room-manager';

const app = new Elysia();

// Health check endpoint
app.get('/health', () => ({
    status: 'ok',
    service: 'voice-service',
    timestamp: new Date().toISOString(),
}));

// Get RTP capabilities
app.get('/rtp-capabilities', () => {
    try {
        const rtpCapabilities = routerManager.getRtpCapabilities();
        return { rtpCapabilities };
    } catch (error: any) {
        logger.error({ error }, 'Failed to get RTP capabilities');
        return {
            error: 'Failed to get RTP capabilities',
            message: error.message,
        };
    }
});

// WebSocket signaling endpoint
app.ws('/signaling', {
    async upgrade(req) {
        // Extract token from headers
        const authHeader = req.headers.get('authorization');
        const token = authHeader?.replace('Bearer ', '');

        if (!token) {
            return new Response('Unauthorized', { status: 401 });
        }

        // Verify JWT
        const payload = await verifyToken(token);
        if (!payload || !payload.userId) {
            return new Response('Unauthorized', { status: 401 });
        }

        return {
            headers: {
                'sec-websocket-protocol': 'voice-signaling',
            },
            data: {
                userId: payload.userId,
                connectionId: generateId(),
            },
        };
    },

    open(ws) {
        const { userId, connectionId } = ws.data;

        connectionManager.addConnection(connectionId, ws, userId);

        logger.info({ userId, connectionId }, 'WebSocket connection opened');

        ws.send(JSON.stringify({
            type: 'connected',
            connectionId,
        }));
    },

    async message(ws, message) {
        const { connectionId } = ws.data;

        try {
            const parsedMessage = typeof message === 'string' ? JSON.parse(message) : message;
            await handleMessage(connectionId, parsedMessage);
        } catch (error: any) {
            logger.error({ error, connectionId }, 'Error processing message');
            ws.send(JSON.stringify({
                type: 'error',
                message: error.message || 'Failed to process message',
            }));
        }
    },

    async close(ws) {
        const { userId, connectionId } = ws.data;

        const connection = connectionManager.getConnection(connectionId);
        if (connection?.channelId) {
            // Clean up room
            await roomManager.removeParticipant(connection.channelId, userId);

            // Notify others
            connectionManager.broadcastToChannel(connection.channelId, {
                type: 'userLeft',
                userId,
            });
        }

        connectionManager.removeConnection(connectionId);
        logger.info({ userId, connectionId }, 'WebSocket connection closed');
    },

    error(ws, error) {
        logger.error({ error, userId: ws.data?.userId }, 'WebSocket error');
    },
});

// Startup
async function start() {
    try {
        // Initialize MediaSoup workers
        await workerManager.initialize();
        logger.info('MediaSoup workers initialized');

        // Test Redis connection
        await redis.ping();
        logger.info('Redis connected');

        // Start server
        app.listen(config.port, () => {
            logger.info(`Voice service running on port ${config.port}`);
            logger.info(`WebSocket endpoint: ws://localhost:${config.port}/signaling`);
            logger.info(`Environment: ${config.nodeEnv}`);
        });
    } catch (error) {
        logger.error({ error }, 'Failed to start server');
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    logger.info('Shutting down gracefully...');
    await workerManager.close();
    await redis.quit();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Shutting down gracefully...');
    await workerManager.close();
    await redis.quit();
    process.exit(0);
});

start();

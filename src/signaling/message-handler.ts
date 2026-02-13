import type { ClientMessage } from '../types/signaling';
import { connectionManager } from './connection-manager';
import { roomManager } from '../rooms/room-manager';
import { createWebRtcTransport } from '../media/transport';
import { createProducer, createConsumer } from '../media/producer-consumer';
import { logger } from '../config/logger';

export async function handleMessage(
    connectionId: string,
    message: ClientMessage
): Promise<void> {
    const connection = connectionManager.getConnection(connectionId);
    if (!connection) {
        logger.warn({ connectionId }, 'Connection not found');
        return;
    }

    const { userId } = connection;

    try {
        switch (message.type) {
            case 'join':
                await handleJoin(connectionId, userId, message);
                break;

            case 'leave':
                await handleLeave(connectionId, userId, message);
                break;

            case 'createTransport':
                await handleCreateTransport(connectionId, userId, message);
                break;

            case 'connectTransport':
                await handleConnectTransport(connectionId, userId, message);
                break;

            case 'produce':
                await handleProduce(connectionId, userId, message);
                break;

            case 'consume':
                await handleConsume(connectionId, userId, message);
                break;

            case 'updateState':
                await handleUpdateState(connectionId, userId, message);
                break;

            case 'resumeConsumer':
                await handleResumeConsumer(connectionId, userId, message);
                break;

            default:
                logger.warn({ type: (message as any).type }, 'Unknown message type');
        }
    } catch (error: any) {
        logger.error({ error, message }, 'Error handling message');
        connectionManager.send(connectionId, {
            type: 'error',
            message: error.message || 'Internal server error',
        });
    }
}

async function handleJoin(
    connectionId: string,
    userId: string,
    message: Extract<ClientMessage, { type: 'join' }>
): Promise<void> {
    const { channelId, rtpCapabilities } = message;

    // Create or get room
    const router = await roomManager.getOrCreateRoom(channelId);

    // Add participant
    await roomManager.addParticipant(channelId, userId, connectionId);

    // Update connection
    connectionManager.setChannelId(connectionId, channelId);

    // Send router capabilities
    connectionManager.send(connectionId, {
        type: 'routerCapabilities',
        rtpCapabilities: router.rtpCapabilities,
    });

    // Notify other users
    connectionManager.broadcastToChannel(channelId, {
        type: 'userJoined',
        userId,
    }, userId);

    // Send existing producers to new user
    const participants = await roomManager.getParticipants(channelId);
    for (const participant of participants) {
        if (participant.userId !== userId) {
            // Send audio producer
            if (participant.producers.audio) {
                connectionManager.send(connectionId, {
                    type: 'newProducer',
                    producerId: participant.producers.audio,
                    userId: participant.userId,
                    kind: 'audio',
                });
            }

            // Send video producer
            if (participant.producers.video) {
                connectionManager.send(connectionId, {
                    type: 'newProducer',
                    producerId: participant.producers.video,
                    userId: participant.userId,
                    kind: 'video',
                    producerType: 'camera',
                });
            }

            // Send screen share producer
            if (participant.producers.screen) {
                connectionManager.send(connectionId, {
                    type: 'newProducer',
                    producerId: participant.producers.screen,
                    userId: participant.userId,
                    kind: 'video',
                    producerType: 'screen',
                });
            }
        }
    }

    logger.info({ channelId, userId }, 'User joined voice channel');
}

async function handleLeave(
    connectionId: string,
    userId: string,
    message: Extract<ClientMessage, { type: 'leave' }>
): Promise<void> {
    const { channelId } = message;

    await roomManager.removeParticipant(channelId, userId);
    connectionManager.setChannelId(connectionId, undefined!);

    // Notify other users
    connectionManager.broadcastToChannel(channelId, {
        type: 'userLeft',
        userId,
    });

    logger.info({ channelId, userId }, 'User left voice channel');
}

async function handleCreateTransport(
    connectionId: string,
    userId: string,
    message: Extract<ClientMessage, { type: 'createTransport' }>
): Promise<void> {
    const connection = connectionManager.getConnection(connectionId);
    if (!connection?.channelId) {
        throw new Error('Not in a voice channel');
    }

    const router = await roomManager.getOrCreateRoom(connection.channelId);
    const transport = await createWebRtcTransport(router, message.direction);

    // Store transport
    roomManager.addTransport(transport.id, transport);

    // Store in router for consumer creation
    (transport as any).appData.router = router;

    // Update participant data
    const participant = await roomManager.getParticipant(connection.channelId, userId);
    if (participant) {
        if (message.direction === 'send') {
            participant.sendTransportId = transport.id;
        } else {
            participant.recvTransportId = transport.id;
        }
        await roomManager.updateParticipant(connection.channelId, userId, participant);
    }

    // Send transport info
    connectionManager.send(connectionId, {
        type: 'transportCreated',
        transportId: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
    });

    logger.info({ transportId: transport.id, direction: message.direction }, 'Transport created');
}

async function handleConnectTransport(
    connectionId: string,
    userId: string,
    message: Extract<ClientMessage, { type: 'connectTransport' }>
): Promise<void> {
    const { transportId, dtlsParameters } = message;

    const transport = roomManager.getTransport(transportId);
    if (!transport) {
        throw new Error('Transport not found');
    }

    await transport.connect({ dtlsParameters });
    logger.info({ transportId }, 'Transport connected');
}

async function handleProduce(
    connectionId: string,
    userId: string,
    message: Extract<ClientMessage, { type: 'produce' }>
): Promise<void> {
    const connection = connectionManager.getConnection(connectionId);
    if (!connection?.channelId) {
        throw new Error('Not in a voice channel');
    }

    const { transportId, kind, rtpParameters, producerType } = message;

    const transport = roomManager.getTransport(transportId);
    if (!transport) {
        throw new Error('Transport not found');
    }

    const producer = await createProducer(
        transport,
        kind,
        rtpParameters,
        userId,
        connection.channelId,
        producerType
    );

    // Store producer
    roomManager.addProducer(producer.id, producer);

    // Update participant data
    const participant = await roomManager.getParticipant(connection.channelId, userId);
    if (participant) {
        if (kind === 'audio') {
            participant.producers.audio = producer.id;
        } else if (producerType === 'screen') {
            participant.producers.screen = producer.id;
            participant.state.screenSharing = true;
        } else {
            participant.producers.video = producer.id;
            participant.state.videoEnabled = true;
        }
        await roomManager.updateParticipant(connection.channelId, userId, participant);
    }

    // Send producer ID
    connectionManager.send(connectionId, {
        type: 'produced',
        producerId: producer.id,
    });

    // Notify other users
    connectionManager.broadcastToChannel(connection.channelId, {
        type: 'newProducer',
        producerId: producer.id,
        userId,
        kind,
        producerType,
    }, userId);

    logger.info({ producerId: producer.id, kind }, 'Producer created');
}

async function handleConsume(
    connectionId: string,
    userId: string,
    message: Extract<ClientMessage, { type: 'consume' }>
): Promise<void> {
    const connection = connectionManager.getConnection(connectionId);
    if (!connection?.channelId) {
        throw new Error('Not in a voice channel');
    }

    const { producerId } = message;

    const producer = roomManager.getProducer(producerId);
    if (!producer) {
        throw new Error('Producer not found');
    }

    const participant = await roomManager.getParticipant(connection.channelId, userId);
    if (!participant?.recvTransportId) {
        throw new Error('Receive transport not found');
    }

    const transport = roomManager.getTransport(participant.recvTransportId);
    if (!transport) {
        throw new Error('Transport not found');
    }

    // Get RTP capabilities from router
    const router = (transport as any).appData.router;
    const rtpCapabilities = router.rtpCapabilities;

    const consumer = await createConsumer(transport, producer, rtpCapabilities, userId);

    // Store consumer
    roomManager.addConsumer(consumer.id, consumer);

    // Send consumer info
    connectionManager.send(connectionId, {
        type: 'consumed',
        consumerId: consumer.id,
        producerId: producer.id,
        kind: producer.kind,
        rtpParameters: consumer.rtpParameters,
    });

    logger.info({ consumerId: consumer.id, producerId }, 'Consumer created');
}

async function handleUpdateState(
    connectionId: string,
    userId: string,
    message: Extract<ClientMessage, { type: 'updateState' }>
): Promise<void> {
    const connection = connectionManager.getConnection(connectionId);
    if (!connection?.channelId) {
        throw new Error('Not in a voice channel');
    }

    const participant = await roomManager.getParticipant(connection.channelId, userId);
    if (!participant) return;

    if (message.muted !== undefined) {
        participant.state.muted = message.muted;
    }
    if (message.deafened !== undefined) {
        participant.state.deafened = message.deafened;
    }
    if (message.videoEnabled !== undefined) {
        participant.state.videoEnabled = message.videoEnabled;
    }

    await roomManager.updateParticipant(connection.channelId, userId, participant);

    // Broadcast state update
    connectionManager.broadcastToChannel(connection.channelId, {
        type: 'userStateUpdate',
        userId,
        muted: participant.state.muted,
        deafened: participant.state.deafened,
        videoEnabled: participant.state.videoEnabled,
    });

    logger.info({ userId, state: participant.state }, 'User state updated');
}

async function handleResumeConsumer(
    connectionId: string,
    userId: string,
    message: Extract<ClientMessage, { type: 'resumeConsumer' }>
): Promise<void> {
    const { consumerId } = message;

    const consumer = roomManager.getConsumer(consumerId);
    if (!consumer) {
        throw new Error('Consumer not found');
    }

    await consumer.resume();
    logger.info({ consumerId }, 'Consumer resumed');
}

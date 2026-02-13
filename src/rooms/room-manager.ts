import { types as mediasoupTypes } from 'mediasoup';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { routerManager } from '../media/router';
import type { ParticipantState, RoomState } from '../types/signaling';

class RoomManager {
    private routers = new Map<string, mediasoupTypes.Router>();
    private transports = new Map<string, mediasoupTypes.WebRtcTransport>();
    private producers = new Map<string, mediasoupTypes.Producer>();
    private consumers = new Map<string, mediasoupTypes.Consumer>();

    async getOrCreateRoom(channelId: string): Promise<mediasoupTypes.Router> {
        let router = this.routers.get(channelId);

        if (!router) {
            router = await routerManager.getOrCreateRouter(channelId);
            this.routers.set(channelId, router);

            // Save room state to Redis
            await redis.set(
                `voice:room:${channelId}`,
                JSON.stringify({
                    channelId,
                    routerId: router.id,
                    participants: {},
                    createdAt: Date.now(),
                })
            );
        }

        return router;
    }

    async addParticipant(
        channelId: string,
        userId: string,
        connectionId: string
    ): Promise<void> {
        const participantData: ParticipantState = {
            userId,
            connectionId,
            producers: {},
            state: {
                muted: false,
                deafened: false,
                videoEnabled: false,
                screenSharing: false,
            },
            joinedAt: Date.now(),
        };

        await redis.hset(
            `voice:room:${channelId}:participants`,
            userId,
            JSON.stringify(participantData)
        );

        logger.info({ channelId, userId }, 'Participant added to room');
    }

    async removeParticipant(channelId: string, userId: string): Promise<void> {
        // Get participant data to clean up their resources
        const participantData = await this.getParticipant(channelId, userId);

        if (participantData) {
            // Close all producers
            for (const producerId of Object.values(participantData.producers)) {
                if (producerId) {
                    const producer = this.producers.get(producerId);
                    if (producer) {
                        producer.close();
                        this.producers.delete(producerId);
                    }
                }
            }

            // Close transports
            if (participantData.sendTransportId) {
                const transport = this.transports.get(participantData.sendTransportId);
                if (transport) {
                    transport.close();
                    this.transports.delete(participantData.sendTransportId);
                }
            }

            if (participantData.recvTransportId) {
                const transport = this.transports.get(participantData.recvTransportId);
                if (transport) {
                    transport.close();
                    this.transports.delete(participantData.recvTransportId);
                }
            }
        }

        // Remove from Redis
        await redis.hdel(`voice:room:${channelId}:participants`, userId);

        // Check if room is empty
        const count = await redis.hlen(`voice:room:${channelId}:participants`);

        if (count === 0) {
            // Schedule room deletion (5 min delay)
            await redis.expire(`voice:room:${channelId}`, 300);
            await redis.expire(`voice:room:${channelId}:participants`, 300);

            // Close router
            const router = this.routers.get(channelId);
            if (router) {
                setTimeout(() => {
                    router.close();
                    this.routers.delete(channelId);
                    logger.info({ channelId }, 'Router closed due to empty room');
                }, 300000); // 5 minutes
            }
        }

        logger.info({ channelId, userId }, 'Participant removed from room');
    }

    async getParticipant(
        channelId: string,
        userId: string
    ): Promise<ParticipantState | null> {
        const data = await redis.hget(`voice:room:${channelId}:participants`, userId);
        return data ? JSON.parse(data) : null;
    }

    async updateParticipant(
        channelId: string,
        userId: string,
        updates: Partial<ParticipantState>
    ): Promise<void> {
        const current = await this.getParticipant(channelId, userId);
        if (!current) return;

        const updated = { ...current, ...updates };
        await redis.hset(
            `voice:room:${channelId}:participants`,
            userId,
            JSON.stringify(updated)
        );
    }

    async getParticipants(channelId: string): Promise<ParticipantState[]> {
        const data = await redis.hgetall(`voice:room:${channelId}:participants`);
        return Object.values(data).map((d) => JSON.parse(d));
    }

    // Resource management
    addTransport(transportId: string, transport: mediasoupTypes.WebRtcTransport): void {
        this.transports.set(transportId, transport);
    }

    getTransport(transportId: string): mediasoupTypes.WebRtcTransport | undefined {
        return this.transports.get(transportId);
    }

    addProducer(producerId: string, producer: mediasoupTypes.Producer): void {
        this.producers.set(producerId, producer);
    }

    getProducer(producerId: string): mediasoupTypes.Producer | undefined {
        return this.producers.get(producerId);
    }

    addConsumer(consumerId: string, consumer: mediasoupTypes.Consumer): void {
        this.consumers.set(consumerId, consumer);
    }

    getConsumer(consumerId: string): mediasoupTypes.Consumer | undefined {
        return this.consumers.get(consumerId);
    }
}

export const roomManager = new RoomManager();

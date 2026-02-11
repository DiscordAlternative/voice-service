# Voice Service - Product Requirements Document

> [!IMPORTANT]
> Bu servis, Discord alternatif Discord alternatifinin tüm gerçek zamanlı ses ve video iletişimini yönetir: WebRTC signaling, SFU media server, ekran paylaşımı ve ses akışı.

---

## 1. Servis Genel Bakış

### 1.1 Amaç
Gerçek zamanlı ses ve video iletişimi için WebRTC signaling ve media forwarding servisi. Düşük gecikme ve yüksek kalite önceliklidir.

### 1.2 Teknik Stack
- **Runtime**: Bun.js (WebSocket for signaling)
- **Framework**: Elysia.js v1.3+ (WebSocket endpoints)
- **SFU (Media Server)**: MediaSoup v3 (Selective Forwarding Unit)
- **WebRTC**: Native WebRTC APIs
- **TURN/STUN**: coturn server (NAT traversal)
- **Database**: Redis (active connections, room state)
- **Protocol**: WebSocket (signaling), RTP/SRTP (media)

### 1.3 Port ve Deployment
- **Signaling Port**: 3003 (WebSocket)
- **Media Ports**: 40000-49999 (UDP, RTP)
- **Internal URL**: `ws://voice-service:3003`
- **External URL**: `wss://voice.discord-alt.com`

---

## 2. WebRTC Architecture

### 2.1 SFU (Selective Forwarding Unit) vs P2P

**Neden SFU?**
- P2P: 10 kişilik bir odada her client 9 bağlantı açar (9 upload, 9 download)
- SFU: Her client sadece 1 bağlantı açar (1 upload, N download)
- Bandwidth tasarrufu
- Central server kontrolü (recording, moderation)

**Mimari:**
```
Client A ─────┐
              │
Client B ─────┤──> SFU Server ──┬──> Client A görsel
              │                 ├──> Client B görsel
Client C ─────┘                 └──> Client C görsel
```

### 2.2 MediaSoup Integration

```typescript
// src/media/mediasoup.ts
import mediasoup from 'mediasoup'
import os from 'os'

// Create workers (one per CPU core)
const workers: mediasoup.types.Worker[] = []

async function createWorkers() {
  const numWorkers = os.cpus().length
  
  for (let i = 0; i < numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: 'warn',
      rtcMinPort: 40000,
      rtcMaxPort: 49999,
      logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp'],
    })
    
    worker.on('died', () => {
      console.error(`MediaSoup worker ${worker.pid} died, restarting...`)
      createWorker()
    })
    
    workers.push(worker)
  }
}

// Get least loaded worker
function getWorker(): mediasoup.types.Worker {
  return workers.reduce((prev, curr) => 
    prev.appData.load < curr.appData.load ? prev : curr
  )
}

// Create router for a voice channel
async function createRouter(
  channelId: string
): Promise<mediasoup.types.Router> {
  const worker = getWorker()
  
  const router = await worker.createRouter({
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000,
        },
      },
      {
        kind: 'video',
        mimeType: 'video/H264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '42e01f',
          'level-asymmetry-allowed': 1,
        },
      },
    ],
  })
  
  return router
}
```

---

## 3. WebSocket Signaling

### 3.1 WebSocket Server

```typescript
// src/signaling/websocket.ts
import { Elysia } from 'elysia'
import { WebSocketManager } from './manager'

const wsManager = new WebSocketManager()

const app = new Elysia()
  .ws('/signaling', {
    open(ws) {
      const userId = ws.data.userId // From JWT
      const connectionId = generateId()
      
      wsManager.addConnection(connectionId, ws, userId)
      
      console.log(`User ${userId} connected (${connectionId})`)
      
      ws.send({
        type: 'connected',
        connectionId
      })
    },
    
    async message(ws, message) {
      await wsManager.handleMessage(ws, message)
    },
    
    close(ws) {
      wsManager.removeConnection(ws.data.connectionId)
      console.log(`User ${ws.data.userId} disconnected`)
    }
  })
```

### 3.2 Signaling Messages

**Client → Server Messages:**
```typescript
// Join voice channel
{
  type: 'join',
  channelId: string,
  rtpCapabilities: RTCRtpCapabilities
}

// Leave voice channel
{
  type: 'leave',
  channelId: string
}

// Create transport (send/receive)
{
  type: 'createTransport',
  direction: 'send' | 'recv'
}

// Connect transport
{
  type: 'connectTransport',
  transportId: string,
  dtlsParameters: DTLSParameters
}

// Produce media (send audio/video)
{
  type: 'produce',
  transportId: string,
  kind: 'audio' | 'video',
  rtpParameters: RTCRtpParameters
}

// Consume media (receive audio/video)
{
  type: 'consume',
  producerId: string
}

// Update state
{
  type: 'updateState',
  muted: boolean,
  deafened: boolean,
  videoEnabled: boolean
}
```

**Server → Client Messages:**
```typescript
// Router RTP capabilities
{
  type: 'routerCapabilities',
  rtpCapabilities: RTCRtpCapabilities
}

// Transport created
{
  type: 'transportCreated',
  transportId: string,
  iceParameters: ICEParameters,
  iceCandidates: ICECandidate[],
  dtlsParameters: DTLSParameters
}

// Producer created (you started sending)
{
  type: 'produced',
  producerId: string
}

// New producer available (someone else started sending)
{
  type: 'newProducer',
  producerId: string,
  userId: string,
  kind: 'audio' | 'video'
}

// Consumer created (you're receiving someone's stream)
{
  type: 'consumed',
  consumerId: string,
  producerId: string,
  kind: 'audio' | 'video',
  rtpParameters: RTCRtpParameters
}

// User state update
{
  type: 'userStateUpdate',
  userId: string,
  muted: boolean,
  deafened: boolean,
  videoEnabled: boolean
}

// User joined/left
{
  type: 'userJoined' | 'userLeft',
  userId: string
}
```

---

## 4. Room Management

### 4.1 Voice Room (Redis State)

```typescript
// Redis data structure
// voice:room:{channelId}
{
  channelId: string,
  routerId: string,
  participants: {
    [userId: string]: {
      connectionId: string,
      sendTransportId: string?,
      recvTransportId: string?,
      producers: {
        audio: string?, // producer ID
        video: string?,
        screen: string? // screen share
      },
      state: {
        muted: boolean,
        deafened: boolean,
        videoEnabled: boolean,
        screenSharing: boolean
      },
      joinedAt: number
    }
  },
  createdAt: number
}

// Expiry: Auto-delete when empty for 5 minutes
```

### 4.2 Room Manager

```typescript
// src/rooms/manager.ts
class RoomManager {
  private routers = new Map<string, mediasoup.types.Router>()
  
  async getOrCreateRoom(channelId: string) {
    // Check Redis cache
    const roomData = await redis.get(`voice:room:${channelId}`)
    
    if (roomData) {
      const room = JSON.parse(roomData)
      
      // Get existing router
      if (this.routers.has(room.routerId)) {
        return this.routers.get(room.routerId)!
      }
    }
    
    // Create new router
    const router = await createRouter(channelId)
    const routerId = generateId()
    
    this.routers.set(routerId, router)
    
    // Save to Redis
    await redis.set(`voice:room:${channelId}`, JSON.stringify({
      channelId,
      routerId,
      participants: {},
      createdAt: Date.now()
    }))
    
    return router
  }
  
  async addParticipant(channelId: string, userId: string, connectionId: string) {
    const room = await this.getOrCreateRoom(channelId)
    
    // Update Redis
    await redis.hset(
      `voice:room:${channelId}:participants`,
      userId,
      JSON.stringify({
        connectionId,
        producers: {},
        state: {
          muted: false,
          deafened: false,
          videoEnabled: false,
          screenSharing: false
        },
        joinedAt: Date.now()
      })
    )
    
    // Broadcast to other participants
    this.broadcastToRoom(channelId, {
      type: 'userJoined',
      userId
    }, userId)
  }
  
  async removeParticipant(channelId: string, userId: string) {
    // Close all producers/consumers
    // ...
    
    // Remove from Redis
    await redis.hdel(`voice:room:${channelId}:participants`, userId)
    
    // Check if room is empty
    const count = await redis.hlen(`voice:room:${channelId}:participants`)
    
    if (count === 0) {
      // Schedule room deletion (5 min delay)
      await redis.expire(`voice:room:${channelId}`, 300)
    }
    
    // Broadcast
    this.broadcastToRoom(channelId, {
      type: 'userLeft',
      userId
    })
  }
  
  broadcastToRoom(channelId: string, message: any, except?: string) {
    // Send to all participants except 'except' userId
    wsManager.broadcast(`room:${channelId}`, message, except)
  }
}

export const roomManager = new RoomManager()
```

---

## 5. Transport Creation

### 5.1 WebRTC Transport

```typescript
async function createWebRtcTransport(
  router: mediasoup.types.Router,
  direction: 'send' | 'recv'
): Promise<mediasoup.types.WebRtcTransport> {
  const transport = await router.createWebRtcTransport({
    listenIps: [
      {
        ip: '0.0.0.0', // Listen on all interfaces
        announcedIp: process.env.PUBLIC_IP // Public IP for ICE
      }
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1000000,
    minimumAvailableOutgoingBitrate: 600000,
    maxSctpMessageSize: 262144,
    maxIncomingBitrate: 1500000
  })
  
  transport.on('dtlsstatechange', (dtlsState) => {
    if (dtlsState === 'closed') {
      transport.close()
    }
  })
  
  return transport
}
```

---

## 6. Producer/Consumer Management

### 6.1 Audio Producer

```typescript
async function createAudioProducer(
  transport: mediasoup.types.WebRtcTransport,
  rtpParameters: RTCRtpParameters,
  userId: string,
  channelId: string
): Promise<mediasoup.types.Producer> {
  const producer = await transport.produce({
    kind: 'audio',
    rtpParameters,
    appData: { userId, channelId, type: 'audio' }
  })
  
  producer.on('transportclose', () => {
    console.log(`Audio producer closed for user ${userId}`)
    producer.close()
  })
  
  // Store producer ID
  await redis.hset(
    `voice:room:${channelId}:participants`,
    userId,
    JSON.stringify({
      ...(await getPartici pantData(channelId, userId)),
      producers: {
        ...(await getParticipantData(channelId, userId)).producers,
        audio: producer.id
      }
    })
  )
  
  // Notify other participants
  roomManager.broadcastToRoom(channelId, {
    type: 'newProducer',
    producerId: producer.id,
    userId,
    kind: 'audio'
  }, userId)
  
  return producer
}
```

### 6.2 Video Producer (Camera/Screen)

```typescript
async function createVideoProducer(
  transport: mediasoup.types.WebRtcTransport,
  rtpParameters: RTCRtpParameters,
  userId: string,
  channelId: string,
  type: 'video' | 'screen'
): Promise<mediasoup.types.Producer> {
  const producer = await transport.produce({
    kind: 'video',
    rtpParameters,
    appData: { userId, channelId, type }
  })
  
  // Similar to audio...
  
  return producer
}
```

### 6.3 Consumer Creation

```typescript
async function createConsumer(
  router: mediasoup.types.Router,
  recvTransport: mediasoup.types.WebRtcTransport,
  producerId: string,
  rtpCapabilities: RTCRtpCapabilities,
  userId: string
): Promise<mediasoup.types.Consumer> {
  if (!router.canConsume({ producerId, rtpCapabilities })) {
    throw new Error('Cannot consume this producer')
  }
  
  const consumer = await recvTransport.consume({
    producerId,
    rtpCapabilities,
    paused: true // Start paused, resume after client confirms
  })
  
  consumer.on('transportclose', () => {
    consumer.close()
  })
  
  consumer.on('producerclose', () => {
    consumer.close()
  })
  
  return consumer
}
```

---

## 7. TURN/STUN Server

### 7.1 coturn Configuration

```ini
# /etc/turnserver.conf

# Listening port
listening-port=3478
tls-listening-port=5349

# Public IP
external-ip=YOUR_PUBLIC_IP

# Realm
realm=voice.discord-alt.com

# Credentials
user=username:password
lt-cred-mech

# Fingerprint
fingerprint

# Log
log-file=/var/log/turnserver.log
verbose

# SSL certificates (for TLS)
cert=/etc/letsencrypt/live/voice.discord-alt.com/fullchain.pem
pkey=/etc/letsencrypt/live/voice.discord-alt.com/privkey.pem

# Relay IP
relay-ip=YOUR_PUBLIC_IP

# UDP relay ports
min-port=49152
max-port=65535
```

### 7.2 ICE Servers Configuration

```typescript
const ICE_SERVERS = [
  {
    urls: 'stun:stun.l.google.com:19302' // Google STUN
  },
  {
    urls: 'stun:voice.discord-alt.com:3478' // Our STUN
  },
  {
    urls: 'turn:voice.discord-alt.com:3478',
    username: process.env.TURN_USERNAME,
    credential: process.env.TURN_CREDENTIAL
  },
  {
    urls: 'turns:voice.discord-alt.com:5349', // TURN over TLS
    username: process.env.TURN_USERNAME,
    credential: process.env.TURN_CREDENTIAL
  }
]
```

---

## 8. Quality Settings

### 8.1 Audio Quality

```typescript
const AUDIO_SETTINGS = {
  opus: {
    clockRate: 48000,
    channels: 2,
    bitrate: 128000, // 128 kbps (high quality)
    // Opus-specific
    useinbandfec: 1, // Forward error correction
    usedtx: 1, // Discontinuous transmission
    maxaveragebitrate: 128000,
    maxplaybackrate: 48000,
    stereo: 1,
    sprop-stereo: 1
  }
}
```

### 8.2 Video Quality Layers

```typescript
const VIDEO_SETTINGS = {
  layers: [
    {
      // Low quality (mobile, poor connection)
      scalabilityMode: 'L1T1',
      maxBitrate: 150000, // 150 kbps
      maxFramerate: 15
    },
    {
      // Medium quality
      scalabilityMode: 'L1T2',
      maxBitrate: 500000, // 500 kbps
      maxFramerate: 24
    },
    {
      // High quality
      scalabilityMode: 'L1T3',
      maxBitrate: 1500000, // 1.5 Mbps
      maxFramerate: 30
    }
  ]
}
```

### 8.3 Adaptive Bitrate

```typescript
// Monitor consumer stats and adjust bitrate
async function monitorConsumer(consumer: mediasoup.types.Consumer) {
  setInterval(async () => {
    const stats = await consumer.getStats()
    
    for (const stat of stats.values()) {
      if (stat.type === 'inbound-rtp') {
        const packetsLost = stat.packetsLost || 0
        const packetsReceived = stat.packetsReceived || 0
        const lossRate = packetsLost / (packetsLost + packetsReceived)
        
        if (lossRate > 0.05) {
          // High packet loss, reduce quality
          await consumer.setPreferredLayers({
            spatialLayer: 0,
            temporalLayer: 1
          })
        } else if (lossRate < 0.01) {
          // Good connection, increase quality
          await consumer.setPreferredLayers({
            spatialLayer: 2,
            temporalLayer: 2
          })
        }
      }
    }
  }, 5000) // Every 5 seconds
}
```

---

## 9. Database Schema (Redis)

```typescript
// Active voice sessions
// voice:session:{userId}
{
  userId: string,
  channelId: string,
  connectionId: string,
  muted: boolean,
  deafened: boolean,
  videoEnabled: boolean,
  screenSharing: boolean,
  joinedAt: number
}
TTL: Session-based (removed on disconnect)

// Voice channel state
// voice:channel:{channelId}:state
{
  channelId: string,
  activeUsers: number,
  createdAt: number
}

// Speaking indicators (ephemeral)
// voice:speaking:{channelId}:{userId}
TTL: 10 seconds (auto-expire)
```

---

## 10. Monitoring

### 10.1 Metrics

```typescript
import { Counter, Gauge, Histogram } from 'prom-client'

const activeConnections = new Gauge({
  name: 'voice_active_connections',
  help: 'Number of active WebRTC connections'
})

const producerCount = new Gauge({
  name: 'voice_producer_count',
  help: 'Number of active producers',
  labelNames: ['kind'] // audio, video, screen
})

const rtpPackets = new Counter({
  name: 'voice_rtp_packets_total',
  help: 'Total RTP packets sent/received',
  labelNames: ['direction'] // in, out
})

const latency = new Histogram({
  name: 'voice_latency_ms',
  help: 'Voice latency in milliseconds',
  buckets: [10, 25, 50, 100, 250, 500, 1000]
})
```

---

## 11. Security

### 11.1 Authentication

```typescript
// Validate JWT before WebSocket upgrade
app.ws('/signaling', {
  upgrade(req, res) {
    const token = req.headers['authorization']?.replace('Bearer ', '')
    
    if (!token) {
      res.writeStatus('401 Unauthorized')
      res.end()
      return
    }
    
    const payload = jwt.verify(token)
    
    if (!payload) {
      res.writeStatus('401 Unauthorized')
      res.end()
      return
    }
    
    // Attach userId to WebSocket data
    res.upgrade(
      { userId: payload.userId },
      req.getHeader('sec-websocket-key'),
      req.getHeader('sec-websocket-protocol'),
      req.getHeader('sec-websocket-extensions'),
      context
    )
  },
  
  // ... rest of WebSocket lifecycle
})
```

### 11.2 Permission Check

```typescript
async function canJoinVoiceChannel(
  userId: string,
  channelId: string
): Promise<boolean> {
  // Check if user has CONNECT permission
  const permissions = await getPermissions(userId, channelId)
  
  return hasPermission(permissions, Permissions.CONNECT)
}
```

---

## 12. Performance Targets

- WebSocket latency: < 30ms
- RTP latency (end-to-end): < 150ms
- Packet loss: < 1%
- Concurrent connections per server: 1000+
- Audio quality: 128kbps Opus
- Video quality: Up to 1080p @ 30fps (adaptive)

---

## 13. Multi-Threading Strategy

```typescript
// Load balancing across CPU cores
import cluster from 'cluster'
import os from 'os'

if (cluster.isPrimary) {
  const numWorkers = os.cpus().length
  
  for (let i = 0; i < numWorkers; i++) {
    cluster.fork()
  }
  
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died`)
    cluster.fork() // Restart
  })
} else {
  // Worker process
  import('./index')
}
```

---

## 14. Environment Variables

```env
PORT=3003
NODE_ENV=production

# Public IP (for ICE)
PUBLIC_IP=123.45.67.89

# TURN server
TURN_USERNAME=voice-user
TURN_CREDENTIAL=secure-password
TURN_PORT=3478

# Redis
REDIS_URL=redis://redis:6379

# MediaSoup RTP ports
RTC_MIN_PORT=40000
RTC_MAX_PORT=49999

# JWT
JWT_SECRET=same-as-api-service
```

---

## Özet

Voice Service, gerçek zamanlı ses ve video iletişimi için WebRTC signaling ve MediaSoup SFU kullanarak yüksek performanslı, düşük gecikmeli bir servis sağlar. Multi-threaded architecture, adaptive bitrate, ve TURN/STUN support ile NAT traversal garantilenir. Redis ile state management ve load balancing desteklenir.

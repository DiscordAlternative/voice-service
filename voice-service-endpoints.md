# Voice Service - Endpoints Documentation

Bu dosya, Voice Service'in tüm HTTP endpoint'lerini ve WebSocket signaling protokolünü detaylandırmaktadır.

## Base URL
```
http://localhost:3003
```

## WebSocket URL
```
ws://localhost:3003/signaling
```

---

## HTTP Endpoints

### GET /health
Servis durumu kontrolü.

**Response (200):**
```json
{
  "status": "ok",
  "service": "voice-service",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Returns:**
- `status`: Servis durumu ("ok")
- `service`: Servis adı
- `timestamp`: İstek zamanı

---

### GET /rtp-capabilities
MediaSoup router RTP yeteneklerini getir.

**Response (200):**
```json
{
  "rtpCapabilities": {
    "codecs": [
      {
        "kind": "audio",
        "mimeType": "audio/opus",
        "clockRate": 48000,
        "channels": 2
      },
      {
        "kind": "video",
        "mimeType": "video/VP8",
        "clockRate": 90000
      },
      {
        "kind": "video",
        "mimeType": "video/H264",
        "clockRate": 90000
      }
    ],
    "headerExtensions": [...]
  }
}
```

**Returns:**
- `rtpCapabilities`: Router'ın desteklediği codec'ler ve özellikler

---

## WebSocket Signaling

### Connection
WebSocket bağlantısı için JWT authentication gereklidir.

**Connection URL:**
```
ws://localhost:3003/signaling
```

**Headers:**
```
Authorization: Bearer <accessToken>
```

**Connection Flow:**
1. Client JWT token ile WebSocket bağlantısı açar
2. Server token'ı doğrular
3. Başarılı ise bağlantı kurulur ve `connected` mesajı gönderilir

---

## Client → Server Messages

### 1. join - Sesli kanala katıl
```json
{
  "type": "join",
  "channelId": "channel-id-here",
  "rtpCapabilities": {
    "codecs": [...],
    "headerExtensions": [...]
  }
}
```

**Variables:**
- `channelId`: Katılınacak sesli kanal ID'si (required)
- `rtpCapabilities`: Client'ın RTP yetenekleri (required)
  - Browser'dan `device.rtpCapabilities` ile alınır

**Server Response:**
```json
{
  "type": "routerCapabilities",
  "rtpCapabilities": {...}
}
```

**Broadcast:** Diğer katılımcılara `userJoined` mesajı gönderilir.

---

### 2. leave - Sesli kanaldan ayrıl
```json
{
  "type": "leave",
  "channelId": "channel-id-here"
}
```

**Variables:**
- `channelId`: Ayrılınacak kanal ID'si (required)

**Broadcast:** Diğer katılımcılara `userLeft` mesajı gönderilir.

---

### 3. createTransport - WebRTC transport oluştur
```json
{
  "type": "createTransport",
  "direction": "send"
}
```

**Variables:**
- `direction`: Transport yönü (required)
  - `"send"`: Media göndermek için
  - `"recv"`: Media almak için

**Server Response:**
```json
{
  "type": "transportCreated",
  "transportId": "transport-id",
  "iceParameters": {...},
  "iceCandidates": [...],
  "dtlsParameters": {...}
}
```

**Returns:**
- `transportId`: Oluşturulan transport ID'si
- `iceParameters`: ICE bağlantı parametreleri
- `iceCandidates`: ICE candidate'leri
- `dtlsParameters`: DTLS güvenlik parametreleri

---

### 4. connectTransport - Transport'u bağla
```json
{
  "type": "connectTransport",
  "transportId": "transport-id",
  "dtlsParameters": {
    "role": "auto",
    "fingerprints": [...]
  }
}
```

**Variables:**
- `transportId`: Transport ID'si (required)
- `dtlsParameters`: Client DTLS parametreleri (required)

**Note:** Bu mesaj client tarafında `transport.on('connect')` event'inde gönderilir.

---

### 5. produce - Media üretmeye başla (ses/video gönder)
```json
{
  "type": "produce",
  "transportId": "transport-id",
  "kind": "audio",
  "rtpParameters": {...},
  "producerType": "camera"
}
```

**Variables:**
- `transportId`: Send transport ID'si (required)
- `kind`: Media türü (required)
  - `"audio"`: Ses
  - `"video"`: Video
- `rtpParameters`: RTP parametreleri (required)
- `producerType`: Video üretici tipi (optional, sadece video için)
  - `"camera"`: Kamera
  - `"screen"`: Ekran paylaşımı

**Server Response:**
```json
{
  "type": "produced",
  "producerId": "producer-id"
}
```

**Broadcast:** Diğer katılımcılara `newProducer` mesajı gönderilir.

---

### 6. consume - Media tüketmeye başla (ses/video al)
```json
{
  "type": "consume",
  "producerId": "producer-id"
}
```

**Variables:**
- `producerId`: Tüketilecek producer ID'si (required)

**Server Response:**
```json
{
  "type": "consumed",
  "consumerId": "consumer-id",
  "producerId": "producer-id",
  "kind": "audio",
  "rtpParameters": {...}
}
```

**Returns:**
- `consumerId`: Oluşturulan consumer ID'si
- `producerId`: Kaynak producer ID'si
- `kind`: Media türü
- `rtpParameters`: RTP parametreleri

**Note:** Consumer başlangıçta duraklatılmış (paused) olarak oluşturulur. Client `resumeConsumer` mesajı göndermeli.

---

### 7. resumeConsumer - Consumer'ı başlat
```json
{
  "type": "resumeConsumer",
  "consumerId": "consumer-id"
}
```

**Variables:**
- `consumerId`: Başlatılacak consumer ID'si (required)

---

### 8. updateState - Kullanıcı durumunu güncelle
```json
{
  "type": "updateState",
  "muted": true,
  "deafened": false,
  "videoEnabled": false
}
```

**Variables:**
- `muted`: Mikrofon kapalı mı (optional)
- `deafened`: Kulaklık kapalı mı (optional)
- `videoEnabled`: Video açık mı (optional)

**Broadcast:** Diğer katılımcılara `userStateUpdate` mesajı gönderilir.

---

## Server → Client Messages

### 1. connected - Bağlantı kuruldu
```json
{
  "type": "connected",
  "connectionId": "connection-id"
}
```

Bağlantı kurulduğunda otomatik gönderilir.

---

### 2. routerCapabilities - Router yetenekleri
```json
{
  "type": "routerCapabilities",
  "rtpCapabilities": {...}
}
```

`join` mesajına yanıt olarak gönderilir.

---

### 3. transportCreated - Transport oluşturuldu
```json
{
  "type": "transportCreated",
  "transportId": "transport-id",
  "iceParameters": {...},
  "iceCandidates": [...],
  "dtlsParameters": {...}
}
```

`createTransport` mesajına yanıt olarak gönderilir.

---

### 4. produced - Producer oluşturuldu
```json
{
  "type": "produced",
  "producerId": "producer-id"
}
```

`produce` mesajına yanıt olarak gönderilir.

---

### 5. newProducer - Yeni producer mevcut
```json
{
  "type": "newProducer",
  "producerId": "producer-id",
  "userId": "user-id",
  "kind": "audio",
  "producerType": "camera"
}
```

Başka bir kullanıcı media üretmeye başladığında broadcast edilir.

**Client Action:** Bu mesajı alan client `consume` mesajı göndererek stream'i almaya başlamalı.

---

### 6. consumed - Consumer oluşturuldu
```json
{
  "type": "consumed",
  "consumerId": "consumer-id",
  "producerId": "producer-id",
  "kind": "audio",
  "rtpParameters": {...}
}
```

`consume` mesajına yanıt olarak gönderilir.

---

### 7. userJoined - Kullanıcı katıldı
```json
{
  "type": "userJoined",
  "userId": "user-id"
}
```

Yeni kullanıcı kanala katıldığında broadcast edilir.

---

### 8. userLeft - Kullanıcı ayrıldı
```json
{
  "type": "userLeft",
  "userId": "user-id"
}
```

Kullanıcı kanaldan ayrıldığında broadcast edilir.

**Client Action:** İlgili consumer'ları temizle.

---

### 9. userStateUpdate - Kullanıcı durumu güncellendi
```json
{
  "type": "userStateUpdate",
  "userId": "user-id",
  "muted": true,
  "deafened": false,
  "videoEnabled": false
}
```

Kullanıcı durumunu değiştirdiğinde broadcast edilir.

---

### 10. producerClosed - Producer kapatıldı
```json
{
  "type": "producerClosed",
  "producerId": "producer-id"
}
```

Producer kapatıldığında broadcast edilir.

---

### 11. error - Hata mesajı
```json
{
  "type": "error",
  "message": "Error description",
  "code": "ERROR_CODE"
}
```

Bir hata oluştuğunda gönderilir.

---

## Connection Flow (Örnek)

### 1. Kanala Katılma
```
Client -> Server: join
Server -> Client: routerCapabilities
Server -> Others: userJoined
Server -> Client: newProducer (mevcut producer'lar için)
```

### 2. Media Gönderme (Audio)
```
Client -> Server: createTransport (direction: send)
Server -> Client: transportCreated
Client -> Server: connectTransport
Client -> Server: produce (kind: audio)
Server -> Client: produced
Server -> Others: newProducer
```

### 3. Media Alma (Audio)
```
Client -> Server: createTransport (direction: recv)
Server -> Client: transportCreated
Client -> Server: connectTransport
Client -> Server: consume (producerId: xxx)
Server -> Client: consumed
Client -> Server: resumeConsumer
```

### 4. Kanaldan Ayrılma
```
Client -> Server: leave
Server -> Others: userLeft
```

---

## Error Responses

### Authentication Error
WebSocket bağlantısı sırasında JWT token geçersiz ise:
```
HTTP 401 Unauthorized
```

### Message Processing Error
```json
{
  "type": "error",
  "message": "Transport not found"
}
```

---

## Notes

- Tüm WebSocket mesajları JSON formatındadır
- Client önce `send` transport oluşturmalı (produce için)
- Client sonra `recv` transport oluşturmalı (consume için)
- Her producer için ayrı `consume` mesajı gönderilmeli
- Consumer oluşturulduktan sonra `resumeConsumer` ile başlatılmalı
- `userStateUpdate` broadcast'i real-time UI güncellemeleri için kullanılır (mute icons vb.)

---

## Environment Variables

Servisin çalışması için gerekli environment variables:

```env
PORT=3003
PUBLIC_IP=127.0.0.1          # Production'da server public IP
REDIS_URL=redis://localhost:6379
JWT_SECRET=same-as-api-service
RTC_MIN_PORT=40000
RTC_MAX_PORT=49999
TURN_USERNAME=voice-user
TURN_CREDENTIAL=secure-password
NODE_ENV=development
LOG_LEVEL=info
```

---

## Development Testing

### 1. Server Başlatma
```bash
cd /Users/berke/Desktop/Projeler/DiscordAlternative/backend/voice-service
bun install
cp .env.example .env
# .env dosyasını düzenleyin
bun run dev
```

### 2. Health Check
```bash
curl http://localhost:3003/health
```

### 3. RTP Capabilities
```bash
curl http://localhost:3003/rtp-capabilities
```

### 4. WebSocket Test (wscat gerekli)
```bash
# JWT token alın (API service'ten)
wscat -c ws://localhost:3003/signaling -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Bağlantı kurulunca:
> {"type":"join","channelId":"test-channel","rtpCapabilities":{...}}
```

---

## Integration with Frontend

Frontend WebRTC entegrasyonu için:
1. `mediasoup-client` library kullanın
2. WebSocket bağlantısı kurun
3. `join` mesajı gönderin
4. Router capabilities alın
5. Device oluşturun: `device.load({ routerRtpCapabilities })`
6. Transport'ları oluşturun ve bağlayın
7. Media produce/consume işlemlerini yapın

Detaylı örnek için mediasoup-client documentation'a bakın.

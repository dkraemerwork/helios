# Helios

**Helios** is a production-ready TypeScript/Bun/NestJS port of [Hazelcast](https://hazelcast.com/) — a distributed in-memory data platform.

- Distributed `IMap`, `IQueue`, `ISet`, `IList`, `ITopic`, `MultiMap`, `ReplicatedMap`, `Ringbuffer`
- Built-in near-cache with TTL, eviction, and invalidation
- NestJS integration (`HeliosModule`, `@HeliosCache`, `@Transactional`)
- Multi-node TCP clustering out of the box
- Standalone server mode (`bun run helios-server.ts`)

---

## Installation

```sh
bun add helios
# or
npm install helios
```

---

## Quick Start

```typescript
import { Helios, HeliosConfig, NetworkConfig } from 'helios';

// Default instance (single node, in-memory)
const hz = await Helios.newInstance();

// Get a distributed map
const map = hz.getMap<string, number>('my-map');
await map.put('key', 42);
console.log(await map.get('key')); // 42

// Shut down
hz.shutdown();
```

---

## Config-file bootstrap

Create `helios-config.json`:

```json
{
  "instanceName": "my-helios",
  "network": {
    "port": 5701,
    "tcpIp": {
      "enabled": false
    }
  }
}
```

Then:

```typescript
const hz = await Helios.newInstance('helios-config.json');
```

---

## Multi-node TCP cluster

```typescript
import { Helios, HeliosConfig, NetworkConfig, TcpIpConfig } from 'helios';

const cfg = new HeliosConfig();
cfg.setInstanceName('node-1');
const net = new NetworkConfig();
net.setPort(5701);
const tcp = new TcpIpConfig();
tcp.setEnabled(true);
tcp.addMember('127.0.0.1:5702');
net.setTcpIpConfig(tcp);
cfg.setNetworkConfig(net);

const hz = await Helios.newInstance(cfg);
```

---

## NestJS Integration

```typescript
import { Module } from '@nestjs/common';
import { HeliosModule, HeliosCacheModule } from 'helios';

@Module({
  imports: [
    HeliosModule.forRoot({ instanceName: 'nestjs-helios' }),
    HeliosCacheModule.register({ ttl: 60_000 }),
  ],
})
export class AppModule {}
```

### Transactional service

```typescript
import { Injectable } from '@nestjs/common';
import { Transactional } from 'helios';

@Injectable()
export class OrderService {
  @Transactional()
  async placeOrder(order: Order): Promise<void> {
    // all IMap/queue ops within this method are transactional
  }
}
```

---

## Standalone server

```sh
bun run node_modules/helios/dist/src/server/cli.js --port 5701
```

Or with a config file:

```sh
bun run node_modules/helios/dist/src/server/cli.js --config helios-config.json
```

---

## Building from source

```sh
git clone https://github.com/helios-ts/helios
cd helios/ts-port
bun install
bun run build      # emits to dist/
bun test           # run all tests
```

---

## License

Apache 2.0 — see [LICENSE](../LICENSE).

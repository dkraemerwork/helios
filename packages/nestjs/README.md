# @helios/nestjs

NestJS integration for Helios.

## Install

```bash
npm install @helios/nestjs @helios/core @nestjs/common @nestjs/core
```

## Quick Start

```ts
import { Module } from '@nestjs/common';
import { Helios } from '@helios/core/Helios';
import { HeliosModule, HeliosCacheModule, HeliosTransactionModule } from '@helios/nestjs';

const instance = Helios.newInstance();

@Module({
  imports: [
    HeliosModule.forRoot(instance),
    HeliosCacheModule.register(),
    HeliosTransactionModule.register(),
  ],
})
export class AppModule {}
```

## Subpath Exports

- `@helios/nestjs/cache`
- `@helios/nestjs/transaction`
- `@helios/nestjs/health`
- `@helios/nestjs/events`
- `@helios/nestjs/decorators`
- `@helios/nestjs/autoconfiguration`
- `@helios/nestjs/context`

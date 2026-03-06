# @zenystx/helios-nestjs

NestJS integration for Helios.

## Install

```bash
npm install @zenystx/helios-nestjs @zenystx/helios-core @nestjs/common @nestjs/core
```

## Quick Start

```ts
import { Module } from '@nestjs/common';
import { Helios } from '@zenystx/helios-core/Helios';
import { HeliosModule, HeliosCacheModule, HeliosTransactionModule } from '@zenystx/helios-nestjs';

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

- `@zenystx/helios-nestjs/cache`
- `@zenystx/helios-nestjs/transaction`
- `@zenystx/helios-nestjs/health`
- `@zenystx/helios-nestjs/events`
- `@zenystx/helios-nestjs/decorators`
- `@zenystx/helios-nestjs/autoconfiguration`
- `@zenystx/helios-nestjs/context`

# @zenystx/nestjs

NestJS integration for Helios.

## Install

```bash
npm install @zenystx/nestjs @zenystx/core @nestjs/common @nestjs/core
```

## Quick Start

```ts
import { Module } from '@nestjs/common';
import { Helios } from '@zenystx/core/Helios';
import { HeliosModule, HeliosCacheModule, HeliosTransactionModule } from '@zenystx/nestjs';

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

- `@zenystx/nestjs/cache`
- `@zenystx/nestjs/transaction`
- `@zenystx/nestjs/health`
- `@zenystx/nestjs/events`
- `@zenystx/nestjs/decorators`
- `@zenystx/nestjs/autoconfiguration`
- `@zenystx/nestjs/context`

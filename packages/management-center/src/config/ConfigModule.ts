/**
 * NestJS module that provides the validated ConfigService globally.
 *
 * Import this module once in the root ManagementCenterModule to make
 * ConfigService available for injection throughout the application.
 */

import { Global, Module } from '@nestjs/common';
import { ConfigService } from './ConfigService.js';

@Global()
@Module({
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}

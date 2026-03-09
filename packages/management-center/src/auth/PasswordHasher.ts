/**
 * Argon2id password hashing service.
 *
 * Uses argon2id variant with production-grade parameters tuned for server-side
 * hashing: 64 MiB memory cost, 3 iterations, 4 parallelism lanes, 32-byte
 * output. These match OWASP recommended minimums for argon2id.
 */

import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

const ARGON2_OPTIONS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  hashLength: 32,
};

@Injectable()
export class PasswordHasher {
  async hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  async verify(password: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}

import { Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';

@Injectable()
export class PasswordHasher {
  async hash(password: string): Promise<string> {
    try {
      return await hash(password, {
        type: argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
    } catch {
      // Never attach library errors or input values to a public/logged error.
      throw new Error('Password hashing failed.');
    }
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      // Invalid stored hashes must not leak their contents or bypass verification.
      return false;
    }
  }
}

import { describe, it, expect } from 'bun:test';
import { UsernamePasswordCredentials } from '@zenystx/helios-core/security/UsernamePasswordCredentials';
import { SimpleTokenCredentials } from '@zenystx/helios-core/security/SimpleTokenCredentials';

describe('CredentialsTest', () => {
    describe('UsernamePasswordCredentials', () => {
        it('getName returns username', () => {
            const c = new UsernamePasswordCredentials('admin', 'secret');
            expect(c.getName()).toBe('admin');
        });

        it('getPassword returns password', () => {
            const c = new UsernamePasswordCredentials('admin', 'secret');
            expect(c.getPassword()).toBe('secret');
        });

        it('setName and setPassword', () => {
            const c = new UsernamePasswordCredentials('a', 'b');
            c.setName('admin2');
            c.setPassword('newpass');
            expect(c.getName()).toBe('admin2');
            expect(c.getPassword()).toBe('newpass');
        });

        it('default constructor', () => {
            const c = new UsernamePasswordCredentials();
            expect(c.getName()).toBeNull();
            expect(c.getPassword()).toBeNull();
        });
    });

    describe('SimpleTokenCredentials', () => {
        it('getToken returns copy of token', () => {
            const token = Buffer.from([1, 2, 3]);
            const c = new SimpleTokenCredentials(token);
            const t = c.getToken();
            expect(t).not.toBeNull();
            expect(Array.from(t!)).toEqual([1, 2, 3]);
        });

        it('getName returns <token> for non-null token', () => {
            const c = new SimpleTokenCredentials(Buffer.from([1]));
            expect(c.getName()).toBe('<token>');
        });

        it('getName returns <empty> for null token', () => {
            const c = new SimpleTokenCredentials();
            expect(c.getName()).toBe('<empty>');
        });

        it('throws on null token in constructor', () => {
            expect(() => new SimpleTokenCredentials(null as unknown as Buffer)).toThrow();
        });
    });
});

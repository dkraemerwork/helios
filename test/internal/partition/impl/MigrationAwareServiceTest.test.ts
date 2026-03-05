/**
 * Tests for Block 16.B6 — MigrationAwareService interface,
 * PartitionMigrationEvent, ServiceNamespace, and registration on InternalPartitionServiceImpl.
 */
import { describe, test, expect } from 'bun:test';
import { PartitionMigrationEvent } from '@helios/internal/partition/PartitionMigrationEvent';
import type { MigrationAwareService } from '@helios/internal/partition/MigrationAwareService';
import { Operation } from '@helios/spi/impl/operationservice/Operation';
import { PartitionReplica } from '@helios/internal/partition/PartitionReplica';
import { Address } from '@helios/cluster/Address';
import { InternalPartitionServiceImpl } from '@helios/internal/partition/impl/InternalPartitionServiceImpl';

// ── helpers ──

function replica(host: string, port: number, uuid: string): PartitionReplica {
    return new PartitionReplica(new Address(host, port), uuid);
}

class NoopOperation extends Operation {
    ran = false;
    async run(): Promise<void> { this.ran = true; }
}

function mockService(returnOp: Operation | null = null): MigrationAwareService {
    return {
        prepareReplicationOperation: (_event, _ns) => returnOp,
    };
}

// ── PartitionMigrationEvent ──

describe('PartitionMigrationEvent', () => {
    test('stores all fields', () => {
        const src = replica('127.0.0.1', 5701, 'src-uuid');
        const dst = replica('127.0.0.1', 5702, 'dst-uuid');
        const event = new PartitionMigrationEvent(42, src, dst, 'MOVE');

        expect(event.partitionId).toBe(42);
        expect(event.source).toBe(src);
        expect(event.destination).toBe(dst);
        expect(event.migrationType).toBe('MOVE');
    });

    test('allows null source and destination', () => {
        const event = new PartitionMigrationEvent(0, null, null, 'COPY');
        expect(event.source).toBeNull();
        expect(event.destination).toBeNull();
    });

    test('toString includes all fields', () => {
        const src = replica('10.0.0.1', 5701, 'a');
        const event = new PartitionMigrationEvent(7, src, null, 'SHIFT_UP');
        const str = event.toString();
        expect(str).toContain('7');
        expect(str).toContain('SHIFT_UP');
    });
});

// ── MigrationAwareService registration on InternalPartitionServiceImpl ──

describe('MigrationAwareService registration', () => {
    test('registerMigrationAwareService stores service by name', () => {
        const svc = new InternalPartitionServiceImpl(10);
        const mock = mockService();
        svc.registerMigrationAwareService('mapService', mock);

        const services = svc.getMigrationAwareServices();
        expect(services.get('mapService')).toBe(mock);
    });

    test('getMigrationAwareServices returns empty map initially', () => {
        const svc = new InternalPartitionServiceImpl(10);
        expect(svc.getMigrationAwareServices().size).toBe(0);
    });

    test('multiple services registered independently', () => {
        const svc = new InternalPartitionServiceImpl(10);
        const mapSvc = mockService();
        const queueSvc = mockService();
        svc.registerMigrationAwareService('mapService', mapSvc);
        svc.registerMigrationAwareService('queueService', queueSvc);

        const services = svc.getMigrationAwareServices();
        expect(services.size).toBe(2);
        expect(services.get('mapService')).toBe(mapSvc);
        expect(services.get('queueService')).toBe(queueSvc);
    });

    test('prepareReplicationOperation returning null is valid', () => {
        const nullService = mockService(null);
        const event = new PartitionMigrationEvent(0, null, null, 'COPY');
        const result = nullService.prepareReplicationOperation(event, []);
        expect(result).toBeNull();
    });

    test('prepareReplicationOperation returning an Operation is valid', () => {
        const op = new NoopOperation();
        const service = mockService(op);
        const event = new PartitionMigrationEvent(1, null, null, 'MOVE');
        const result = service.prepareReplicationOperation(event, []);
        expect(result).toBe(op);
    });
});

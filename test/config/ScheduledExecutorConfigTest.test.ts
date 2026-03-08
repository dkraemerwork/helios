import { describe, expect, it } from "bun:test";
import { ScheduledExecutorConfig } from "@zenystx/helios-core/config/ScheduledExecutorConfig";
import { CapacityPolicy } from "@zenystx/helios-core/config/CapacityPolicy";
import { ScheduleShutdownPolicy } from "@zenystx/helios-core/config/ScheduleShutdownPolicy";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";

describe("ScheduledExecutorConfig", () => {
    describe("default values", () => {
        it("should have correct defaults matching Hazelcast", () => {
            const config = new ScheduledExecutorConfig("test");
            expect(config.getName()).toBe("test");
            expect(config.getPoolSize()).toBe(16);
            expect(config.getCapacity()).toBe(100);
            expect(config.getCapacityPolicy()).toBe(CapacityPolicy.PER_NODE);
            expect(config.getDurability()).toBe(1);
            expect(config.isStatisticsEnabled()).toBe(true);
            expect(config.getScheduleShutdownPolicy()).toBe(ScheduleShutdownPolicy.GRACEFUL_TRANSFER);
            expect(config.getMaxHistoryEntriesPerTask()).toBe(100);
            expect(config.getMergePolicyConfig()).toBeNull();
        });
    });

    describe("setters and getters", () => {
        it("should allow setting all fields via fluent API", () => {
            const config = new ScheduledExecutorConfig("my-scheduler")
                .setPoolSize(8)
                .setCapacity(200)
                .setCapacityPolicy(CapacityPolicy.PER_PARTITION)
                .setDurability(3)
                .setStatisticsEnabled(false)
                .setScheduleShutdownPolicy(ScheduleShutdownPolicy.FORCE_STOP)
                .setMaxHistoryEntriesPerTask(50);

            expect(config.getName()).toBe("my-scheduler");
            expect(config.getPoolSize()).toBe(8);
            expect(config.getCapacity()).toBe(200);
            expect(config.getCapacityPolicy()).toBe(CapacityPolicy.PER_PARTITION);
            expect(config.getDurability()).toBe(3);
            expect(config.isStatisticsEnabled()).toBe(false);
            expect(config.getScheduleShutdownPolicy()).toBe(ScheduleShutdownPolicy.FORCE_STOP);
            expect(config.getMaxHistoryEntriesPerTask()).toBe(50);
        });
    });

    describe("validation", () => {
        it("should reject poolSize <= 0", () => {
            const config = new ScheduledExecutorConfig("test");
            expect(() => config.setPoolSize(0)).toThrow();
            expect(() => config.setPoolSize(-1)).toThrow();
        });

        it("should reject negative capacity", () => {
            const config = new ScheduledExecutorConfig("test");
            expect(() => config.setCapacity(-1)).toThrow();
        });

        it("should allow capacity of 0 (unlimited)", () => {
            const config = new ScheduledExecutorConfig("test");
            config.setCapacity(0);
            expect(config.getCapacity()).toBe(0);
        });

        it("should reject negative durability", () => {
            const config = new ScheduledExecutorConfig("test");
            expect(() => config.setDurability(-1)).toThrow();
        });

        it("should allow durability of 0", () => {
            const config = new ScheduledExecutorConfig("test");
            config.setDurability(0);
            expect(config.getDurability()).toBe(0);
        });

        it("should reject negative maxHistoryEntriesPerTask", () => {
            const config = new ScheduledExecutorConfig("test");
            expect(() => config.setMaxHistoryEntriesPerTask(-1)).toThrow();
        });
    });

    describe("CapacityPolicy enum", () => {
        it("should have PER_NODE and PER_PARTITION values", () => {
            expect(CapacityPolicy.PER_NODE).toBeDefined();
            expect(CapacityPolicy.PER_PARTITION).toBeDefined();
            expect(CapacityPolicy.PER_NODE).not.toBe(CapacityPolicy.PER_PARTITION);
        });
    });

    describe("ScheduleShutdownPolicy enum", () => {
        it("should have GRACEFUL_TRANSFER and FORCE_STOP values", () => {
            expect(ScheduleShutdownPolicy.GRACEFUL_TRANSFER).toBeDefined();
            expect(ScheduleShutdownPolicy.FORCE_STOP).toBeDefined();
            expect(ScheduleShutdownPolicy.GRACEFUL_TRANSFER).not.toBe(ScheduleShutdownPolicy.FORCE_STOP);
        });
    });
});

describe("HeliosConfig — scheduledExecutorConfigs", () => {
    it("should add and retrieve a ScheduledExecutorConfig", () => {
        const helios = new HeliosConfig("test-instance");
        const sec = new ScheduledExecutorConfig("my-scheduler").setPoolSize(4);
        helios.addScheduledExecutorConfig(sec);

        const found = helios.getScheduledExecutorConfig("my-scheduler");
        expect(found.getName()).toBe("my-scheduler");
        expect(found.getPoolSize()).toBe(4);
    });

    it("should return a default config for unknown names", () => {
        const helios = new HeliosConfig("test-instance");
        const found = helios.getScheduledExecutorConfig("unknown");
        expect(found.getName()).toBe("unknown");
        expect(found.getPoolSize()).toBe(16);
    });

    it("should expose all scheduled executor configs as a readonly map", () => {
        const helios = new HeliosConfig("test-instance");
        helios.addScheduledExecutorConfig(new ScheduledExecutorConfig("a"));
        helios.addScheduledExecutorConfig(new ScheduledExecutorConfig("b"));

        const all = helios.getScheduledExecutorConfigs();
        expect(all.size).toBe(2);
        expect(all.has("a")).toBe(true);
        expect(all.has("b")).toBe(true);
    });

    it("findScheduledExecutorConfig returns null for missing name", () => {
        const helios = new HeliosConfig("test-instance");
        expect(helios.findScheduledExecutorConfig("nope")).toBeNull();
    });

    it("findScheduledExecutorConfig returns the config when present", () => {
        const helios = new HeliosConfig("test-instance");
        helios.addScheduledExecutorConfig(new ScheduledExecutorConfig("present"));
        const found = helios.findScheduledExecutorConfig("present");
        expect(found).not.toBeNull();
        expect(found!.getName()).toBe("present");
    });
});

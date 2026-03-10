import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { HeliosMapSink, JsonCodec, NatsSource, type BlitzJob, type JobConfig } from '@zenystx/helios-blitz';
import type { HeliosBlitzService } from '@zenystx/helios-blitz/nestjs';
import { InjectBlitz } from '@zenystx/helios-blitz/nestjs';
import type { IMap } from '@zenystx/helios-core/map/IMap';
import { InjectMap } from '@zenystx/helios-nestjs';
import type { Quote } from './binance-ws.source';

const MARKET_TICKS_SUBJECT = 'market.ticks';
const QUOTE_ROLLUPS_MAP = 'quote-rollups';
const DEFAULT_JOB_NAME = 'binance-market-rollups';

export interface QuoteRollup {
    symbol: string;
    price: number;
    open: number;
    high: number;
    low: number;
    volume: number;
    quoteVolume: number;
    timestamp: number;
    priceChangePct: number;
    ingestLagMs: number;
    updatedAt: number;
}

export interface BinanceBlitzJobState {
    enabled: boolean;
    jobId: string | null;
    status: string;
    jobName: string | null;
}

@Injectable()
export class BinanceBlitzJobsService implements OnModuleDestroy {
    private readonly _logger = new Logger(BinanceBlitzJobsService.name);
    private _job: BlitzJob | null = null;

    constructor(
        @InjectBlitz() private readonly _blitz: HeliosBlitzService,
        @InjectMap(QUOTE_ROLLUPS_MAP) private readonly _quoteRollupsMap: IMap<string, QuoteRollup>,
    ) {}

    async ensureStarted(jobName = DEFAULT_JOB_NAME): Promise<BlitzJob> {
        if (this._job && this._job.getStatus() === 'RUNNING') {
            return this._job;
        }

        const pipeline = this._blitz.pipeline(jobName);
        pipeline
            .readFrom(NatsSource.fromSubject<Quote>(this._blitz.blitz.nc, MARKET_TICKS_SUBJECT, JsonCodec<Quote>()))
            .map((quote) => this._toRollupEntry(quote))
            .writeTo(HeliosMapSink.put(this._quoteRollupsMap));

        const config: JobConfig = {
            name: jobName,
        };

        const job = await this._blitz.newJob(pipeline, config);
        this._job = job;
        this._logger.log(`Started Blitz job ${job.name} (${job.id})`);
        return job;
    }

    getState(): BinanceBlitzJobState {
        return {
            enabled: this._job !== null,
            jobId: this._job?.id ?? null,
            status: this._job?.getStatus() ?? 'IDLE',
            jobName: this._job?.name ?? null,
        };
    }

    async stop(): Promise<void> {
        if (!this._job) {
            return;
        }

        const job = this._job;
        this._job = null;
        if (job.getStatus() === 'RUNNING') {
            await job.cancel();
        }
    }

    async onModuleDestroy(): Promise<void> {
        await this.stop();
    }

    private _toRollupEntry(quote: Quote): { key: string; value: QuoteRollup } {
        const now = Date.now();
        const priceChangePct = quote.open === 0 ? 0 : ((quote.price - quote.open) / quote.open) * 100;
        return {
            key: quote.symbol,
            value: {
                symbol: quote.symbol,
                price: quote.price,
                open: quote.open,
                high: quote.high,
                low: quote.low,
                volume: quote.volume,
                quoteVolume: quote.quoteVolume,
                timestamp: quote.timestamp,
                priceChangePct,
                ingestLagMs: Math.max(0, now - quote.timestamp),
                updatedAt: now,
            },
        };
    }
}

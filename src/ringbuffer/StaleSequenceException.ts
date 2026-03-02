/**
 * Thrown when accessing an item in the Ringbuffer using a sequence that is
 * smaller than the current head sequence and the ringbuffer store is disabled.
 */
export class StaleSequenceException extends Error {
    readonly headSeq: number;

    constructor(message: string, headSeq: number, cause?: Error) {
        super(message);
        this.name = 'StaleSequenceException';
        this.headSeq = headSeq;
        if (cause) {
            this.cause = cause;
        }
    }

    getHeadSeq(): number {
        return this.headSeq;
    }

    wrap(): StaleSequenceException {
        return new StaleSequenceException(this.message, this.headSeq, this);
    }
}

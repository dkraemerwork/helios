import { BlitzError } from './BlitzError.ts';

/**
 * Thrown when an unrecoverable error occurs in a pipeline stage.
 * Carries the pipeline name to aid in diagnostics.
 */
export class PipelineError extends BlitzError {
    override readonly name = 'PipelineError';

    /** Name of the pipeline where the error occurred. */
    readonly pipelineName: string;

    constructor(message: string, pipelineName: string, options?: ErrorOptions) {
        super(message, options);
        this.pipelineName = pipelineName;
    }
}

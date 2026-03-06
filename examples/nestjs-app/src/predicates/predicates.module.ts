/**
 * PredicatesModule — wires up the predicate query demo.
 *
 * Imports HeliosObjectExtractionModule to expose the 'products' IMap
 * under @InjectMap('products').
 */

import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { HeliosObjectExtractionModule } from '@zenystx/nestjs';
import { PredicatesService } from './predicates.service';

@Module({
    imports: [
        HeliosObjectExtractionModule.forRoot({ namedMaps: ['products'] }),
    ],
    providers: [PredicatesService],
    exports: [PredicatesService],
})
export class PredicatesModule {}

/**
 * PredicatesService — demonstrates predicate-based queries on a Helios IMap.
 *
 * Populates a 'products' map and runs several predicate queries:
 *   - equal        : exact match on a field
 *   - greaterThan  : numeric range
 *   - between      : inclusive numeric range
 *   - and / or     : boolean combinations
 */

import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { InjectMap } from '@zenystx/nestjs';
import type { IMap } from '@zenystx/core/map/IMap';
import { Predicates } from '@zenystx/core/query/Predicates';

export interface Product {
    id: string;
    name: string;
    price: number;
    category: string;
}

@Injectable()
export class PredicatesService {
    constructor(
        @InjectMap('products') private readonly products: IMap<string, Product>,
    ) {}

    /** Seed the map with sample product data. */
    seed(): void {
        const catalog: Product[] = [
            { id: 'p1', name: 'Wireless Mouse',    price: 29.99,  category: 'electronics' },
            { id: 'p2', name: 'Mechanical Keyboard', price: 89.99, category: 'electronics' },
            { id: 'p3', name: 'USB-C Hub',          price: 49.99,  category: 'electronics' },
            { id: 'p4', name: 'Desk Lamp',          price: 35.00,  category: 'accessories' },
            { id: 'p5', name: 'Monitor Stand',      price: 55.00,  category: 'accessories' },
            { id: 'p6', name: 'Notebook',           price: 4.99,   category: 'stationery'  },
            { id: 'p7', name: 'Pen Set',            price: 12.50,  category: 'stationery'  },
        ];
        for (const p of catalog) {
            this.products.put(p.id, p);
        }
        console.log(`  Seeded ${this.products.size()} products into the 'products' map`);
    }

    /** Run all predicate query demos and print results. */
    runQueries(): void {
        // ── 1. Equal predicate ──────────────────────────────────────────────
        const electronics = this.products.values(
            Predicates.equal<string, Product>('category', 'electronics'),
        );
        console.log(`\n  [equal] category = 'electronics' → ${electronics.length} result(s):`);
        for (const p of electronics) {
            console.log(`    - ${p.name} ($${p.price})`);
        }

        // ── 2. greaterThan predicate ────────────────────────────────────────
        const expensive = this.products.values(
            Predicates.greaterThan<string, Product>('price', 50),
        );
        console.log(`\n  [greaterThan] price > 50 → ${expensive.length} result(s):`);
        for (const p of expensive) {
            console.log(`    - ${p.name} ($${p.price})`);
        }

        // ── 3. between predicate ────────────────────────────────────────────
        const midRange = this.products.values(
            Predicates.between<string, Product>('price', 20, 60),
        );
        console.log(`\n  [between] price BETWEEN 20 AND 60 → ${midRange.length} result(s):`);
        for (const p of midRange) {
            console.log(`    - ${p.name} ($${p.price})`);
        }

        // ── 4. and combination ──────────────────────────────────────────────
        const cheapElectronics = this.products.values(
            Predicates.and<string, Product>(
                Predicates.equal('category', 'electronics'),
                Predicates.lessThan('price', 50),
            ),
        );
        console.log(`\n  [and] category = 'electronics' AND price < 50 → ${cheapElectronics.length} result(s):`);
        for (const p of cheapElectronics) {
            console.log(`    - ${p.name} ($${p.price})`);
        }

        // ── 5. or combination ───────────────────────────────────────────────
        const stationeryOrExpensive = this.products.values(
            Predicates.or<string, Product>(
                Predicates.equal('category', 'stationery'),
                Predicates.greaterThan('price', 80),
            ),
        );
        console.log(`\n  [or] category = 'stationery' OR price > 80 → ${stationeryOrExpensive.length} result(s):`);
        for (const p of stationeryOrExpensive) {
            console.log(`    - ${p.name} ($${p.price})`);
        }

        // ── 6. keySet predicate ─────────────────────────────────────────────
        const accessoryKeys = this.products.keySet(
            Predicates.equal<string, Product>('category', 'accessories'),
        );
        console.log(`\n  [keySet] category = 'accessories' keys → [${[...accessoryKeys].join(', ')}]`);

        // ── 7. entrySet predicate ───────────────────────────────────────────
        const cheapEntries = this.products.entrySet(
            Predicates.lessThan<string, Product>('price', 10),
        );
        console.log(`\n  [entrySet] price < 10 → ${cheapEntries.size} entry/entries:`);
        for (const [key, p] of cheapEntries) {
            console.log(`    - key=${key}: ${p.name} ($${p.price})`);
        }
    }
}

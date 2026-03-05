/**
 * Configuration for a map index.
 * Port of com.hazelcast.config.IndexConfig.
 */
import { IndexType } from '@helios/query/impl/Index';

export class IndexConfig {
    private _name: string | null = null;
    private _type: IndexType;
    private _attributes: string[];

    constructor(type?: IndexType, attributes?: string[]) {
        this._type = type ?? IndexType.SORTED;
        this._attributes = attributes ? [...attributes] : [];
        if (attributes !== undefined && attributes.length === 0) {
            throw new Error('IndexConfig requires at least one attribute');
        }
    }

    getName(): string | null {
        return this._name;
    }

    setName(name: string): this {
        this._name = name;
        return this;
    }

    getType(): IndexType {
        return this._type;
    }

    setType(type: IndexType): this {
        this._type = type;
        return this;
    }

    getAttributes(): string[] {
        return [...this._attributes];
    }

    setAttributes(attributes: string[]): this {
        this._attributes = [...attributes];
        return this;
    }

    addAttribute(attribute: string): this {
        this._attributes.push(attribute);
        return this;
    }
}

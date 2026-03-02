/**
 * General-purpose property descriptor, equivalent to Java's {@code HazelcastProperty}.
 *
 * Can be used anywhere a property name + default value pair is needed.
 * Compatible with {@link HeliosProperties} for reading values.
 */
export class HeliosProperty {
    readonly name: string;
    readonly defaultValue: string;

    constructor(name: string, defaultValue: number | string) {
        this.name = name;
        this.defaultValue = String(defaultValue);
    }

    getName(): string { return this.name; }
    getDefaultValue(): string { return this.defaultValue; }

    toString(): string { return this.name; }
}

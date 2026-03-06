import { expect } from 'bun:test';
import type { InstancePermission } from '@zenystx/helios-core/security/permission/InstancePermission';

/** Port of Java PermissionTestSupport + CheckPermission builder */
export type PermissionFactory = (name: string, ...actions: string[]) => InstancePermission;

export class CheckPermission {
    private static readonly DEFAULT_NAME = 'someMapsPermission';

    private _of: string | null = null;
    private _against: string[] | null = null;
    private _expected: boolean | null = null;
    private _allowedName = CheckPermission.DEFAULT_NAME;
    private _requestedName = CheckPermission.DEFAULT_NAME;

    constructor(private readonly factory: PermissionFactory) {}

    withAllowedName(name: string): this { this._allowedName = name; return this; }
    withRequestedName(name: string): this { this._requestedName = name; return this; }
    of(action: string): this { this._of = action; return this; }
    against(...actions: string[]): this { this._against = actions; return this; }
    expect(result: boolean): this { this._expected = result; return this; }

    run(): void {
        if (this._of === null || this._against === null || this._expected === null) {
            throw new Error('of/against/expect must all be set');
        }
        const allowed = this.factory(this._allowedName, ...this._against);
        const requested = this.factory(this._requestedName, this._of);
        const actual = allowed.implies(requested);
        expect(actual).toBe(this._expected);
    }
}

/** Tests inherited from AbstractGenericPermissionTest */
export function runGenericPermissionTests(factory: PermissionFactory): void {
    const c = () => new CheckPermission(factory);

    c().of('read').against('read').expect(true).run();
    c().of('read').against('all').expect(true).run();
    c().of('read').against('create').expect(false).run();
    c().of('modify').against('modify').expect(true).run();
    c().of('modify').against('all').expect(true).run();
    c().of('modify').against('read').expect(false).run();
    c().of('modify').against('read', 'create').expect(false).run();
    c().of('modify').against('read', 'create', 'delete').expect(false).run();
    c().of('create').against('create').expect(true).run();
    c().of('create').against('all').expect(true).run();
    c().of('create').against('read').expect(false).run();
    c().of('destroy').against('destroy').expect(true).run();
    c().of('destroy').against('all').expect(true).run();
    c().of('destroy').against('read').expect(false).run();
}

/** Tests inherited from AbstractMapPermissionTest */
export function runMapPermissionTests(factory: PermissionFactory, allActions: string[]): void {
    const c = () => new CheckPermission(factory);

    c().of('put').against('read', 'create').expect(false).run();
    c().of('listen').against('read', 'create', 'put').expect(false).run();
    c().of('put').against('put', 'read', 'create').expect(true).run();
    c().of('put').against('all').expect(true).run();

    new CheckPermission(factory)
        .withAllowedName('myDataStructure.*')
        .withRequestedName('myDataStructure.foo')
        .of('put').against(...allActions).expect(true).run();

    new CheckPermission(factory)
        .withAllowedName('myDataStructure')
        .withRequestedName('myOtherDataStructure')
        .of('put').against(...allActions).expect(false).run();
}

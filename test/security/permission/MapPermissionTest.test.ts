import { describe, it } from 'bun:test';
import { MapPermission } from '@helios/security/permission/MapPermission';
import { CheckPermission, runMapPermissionTests } from './permissionTestSupport';

const ALL_ACTIONS = ['put', 'read', 'remove', 'listen', 'lock', 'index', 'intercept', 'create', 'destroy'];
const factory = (name: string, ...actions: string[]) => new MapPermission(name, ...actions);

describe('MapPermissionTest', () => {
    it('willReturnFalseForNoPermOnPut', () => new CheckPermission(factory).of('put').against('read', 'create').expect(false).run());
    it('willReturnFalseForNoPermOnListen', () => new CheckPermission(factory).of('listen').against('read', 'create', 'put').expect(false).run());
    it('willReturnTrueForPermOnPutOn', () => new CheckPermission(factory).of('put').against('put', 'read', 'create').expect(true).run());
    it('willReturnTrueForPermOnAll', () => new CheckPermission(factory).of('put').against('all').expect(true).run());
    it('willReturnTrueWhenNameUseMatchingWildcard', () =>
        new CheckPermission(factory)
            .withAllowedName('myDataStructure.*')
            .withRequestedName('myDataStructure.foo')
            .of('put').against(...ALL_ACTIONS).expect(true).run()
    );
    it('willReturnFalseWhenNameUseNonNames', () =>
        new CheckPermission(factory)
            .withAllowedName('myDataStructure')
            .withRequestedName('myOtherDataStructure')
            .of('put').against(...ALL_ACTIONS).expect(false).run()
    );
    it('willReturnFalseForNoPermOnIndex', () =>
        new CheckPermission(factory).of('index').against('read', 'create', 'put', 'intercept').expect(false).run()
    );
});

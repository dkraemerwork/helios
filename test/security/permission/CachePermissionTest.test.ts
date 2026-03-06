import { describe, it } from 'bun:test';
import { CachePermission } from '@zenystx/helios-core/security/permission/CachePermission';
import { CheckPermission } from './permissionTestSupport';

const ALL_ACTIONS = ['put', 'read', 'remove', 'listen', 'create', 'destroy'];
const factory = (name: string, ...actions: string[]) => new CachePermission(name, ...actions);

describe('CachePermissionTest', () => {
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
});

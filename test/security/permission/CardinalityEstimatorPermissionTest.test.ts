import { describe, it } from 'bun:test';
import { CardinalityEstimatorPermission } from '@helios/security/permission/CardinalityEstimatorPermission';
import { CheckPermission } from './permissionTestSupport';

const factory = (name: string, ...actions: string[]) => new CardinalityEstimatorPermission(name, ...actions);
const c = () => new CheckPermission(factory);

describe('CardinalityEstimatorPermissionTest', () => {
    it('checkReadPermission', () => c().of('read').against('read').expect(true).run());
    it('checkReadPermission_whenAll', () => c().of('read').against('all').expect(true).run());
    it('checkReadPermission_whenOnlyCreateAllowed', () => c().of('read').against('create').expect(false).run());

    it('checkModifyPermission', () => c().of('modify').against('modify').expect(true).run());
    it('checkModifyPermission_whenAll', () => c().of('modify').against('all').expect(true).run());
    it('checkModifyPermission_whenOnlyReadAllowed', () => c().of('modify').against('read').expect(false).run());
    it('checkModifyPermission_whenOnlyReadAndCreateAllowed', () => c().of('modify').against('read', 'create').expect(false).run());
    it('checkModifyPermission_whenOnlyReadCreateAndDeleteAllowed', () => c().of('modify').against('read', 'create', 'delete').expect(false).run());

    it('checkCreatePermission', () => c().of('create').against('create').expect(true).run());
    it('checkCreatePermission_whenAll', () => c().of('create').against('all').expect(true).run());
    it('checkCreatePermission_whenOnlyReadAllowed', () => c().of('create').against('read').expect(false).run());

    it('checkDestroyPermission', () => c().of('destroy').against('destroy').expect(true).run());
    it('checkDestroyPermission_whenAll', () => c().of('destroy').against('all').expect(true).run());
    it('checkDestroyPermission_whenOnlyReadAllowed', () => c().of('destroy').against('read').expect(false).run());
});

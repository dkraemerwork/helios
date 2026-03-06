import { describe, test, expect } from 'bun:test';
import { LikePredicate } from '@zenystx/helios-core/query/impl/predicates/LikePredicate';
import { ILikePredicate } from '@zenystx/helios-core/query/impl/predicates/ILikePredicate';
import type { QueryContext } from '@zenystx/helios-core/query/impl/QueryContext';
import { IndexMatchHint } from '@zenystx/helios-core/query/impl/QueryContext';
import type { Index } from '@zenystx/helios-core/query/impl/Index';
import { IndexType } from '@zenystx/helios-core/query/impl/Index';
import { entry } from './PredicateTestUtils';

/** Creates a minimal Index stub with the given type. */
function createMockIndex(type: IndexType): Index {
  return { getConfig: () => ({ getType: () => type }) };
}

/** Creates a QueryContext that always returns the given index for any matchIndex call. */
function createMockQueryContext(index: Index | null): QueryContext {
  return { matchIndex: (_attr: string, _hint: IndexMatchHint) => index };
}

describe('LikePredicate', () => {

  test('testILikePredicateUnicodeCase', () => {
    expect(new ILikePredicate('this', 'Hazelcast%').apply(entry('Hazelcast is here!'))).toBe(true);
    expect(new ILikePredicate('this', 'hazelcast%').apply(entry('Hazelcast is here!'))).toBe(true);
    expect(new ILikePredicate('this', 'Хазелкаст%').apply(entry('Хазелкаст с большой буквы'))).toBe(true);
    expect(new ILikePredicate('this', 'хазелкаст%').apply(entry('Хазелкаст с большой буквы'))).toBe(true);
  });

  test('testLikePredicateUnicodeCase', () => {
    expect(new LikePredicate('this', 'Hazelcast%').apply(entry('Hazelcast is here!'))).toBe(true);
    expect(new LikePredicate('this', 'hazelcast%').apply(entry('Hazelcast is here!'))).toBe(false);
    expect(new LikePredicate('this', 'Хазелкаст%').apply(entry('Хазелкаст с большой буквы'))).toBe(true);
    expect(new LikePredicate('this', 'хазелкаст%').apply(entry('Хазелкаст с большой буквы'))).toBe(false);
  });

  test('testLikePredicateSyntax', () => {
    expect(new LikePredicate('this', '%Hazelcast%').apply(entry('Hazelcast is here!'))).toBe(true);
    expect(new LikePredicate('this', '%here_').apply(entry('Hazelcast is here!'))).toBe(true);
    expect(new LikePredicate('this', '%%').apply(entry('Hazelcast is here!'))).toBe(true);
    expect(new LikePredicate('this', '%%').apply(entry(''))).toBe(true);
  });

  test('testLikePredicateSyntaxEscape', () => {
    expect(new LikePredicate('this', '%\\_is\\_%').apply(entry('Hazelcast_is_here!'))).toBe(true);
    expect(new LikePredicate('this', '%is\\%here!').apply(entry('Hazelcast%is%here!'))).toBe(true);
  });

  test('negative_testLikePredicateSyntax', () => {
    expect(new LikePredicate('this', '_Hazelcast%').apply(entry('Hazelcast is here!'))).toBe(false);
    expect(new LikePredicate('this', '_').apply(entry(''))).toBe(false);
    expect(new LikePredicate('this', 'Hazelcast%').apply(entry(''))).toBe(false);
  });

  test('likePredicateIsNotIndexed_whenBitmapIndexIsUsed', () => {
    const queryContext = createMockQueryContext(createMockIndex(IndexType.BITMAP));
    expect(new LikePredicate('this', 'string%').isIndexed(queryContext)).toBe(false);
  });

  test('likePredicateIsNotIndexed_whenHashIndexIsUsed', () => {
    const queryContext = createMockQueryContext(createMockIndex(IndexType.HASH));
    expect(new LikePredicate('this', 'string%').isIndexed(queryContext)).toBe(false);
  });

  test('likePredicateIsNotIndexed_whenUnderscoreWildcardIsUsed', () => {
    const queryContext = createMockQueryContext(createMockIndex(IndexType.SORTED));
    expect(new LikePredicate('this', 'string_').isIndexed(queryContext)).toBe(false);
  });

  test('likePredicateIsNotIndexed_whenPercentWildcardIsUsedAtTheBeginning', () => {
    const queryContext = createMockQueryContext(createMockIndex(IndexType.SORTED));
    expect(new LikePredicate('this', '%string').isIndexed(queryContext)).toBe(false);
  });

  test('likePredicateIsNotIndexed_whenPercentWildcardIsUsedMultipleTimes', () => {
    const queryContext = createMockQueryContext(createMockIndex(IndexType.SORTED));
    expect(new LikePredicate('this', 'sub%string%').isIndexed(queryContext)).toBe(false);
  });

  test('likePredicateIsNotIndexed_whenPercentWildcardIsEscaped', () => {
    const queryContext = createMockQueryContext(createMockIndex(IndexType.SORTED));
    expect(new LikePredicate('this', 'sub\\%').isIndexed(queryContext)).toBe(false);
    expect(new LikePredicate('this', 'sub\\\\\\%').isIndexed(queryContext)).toBe(false);
    expect(new LikePredicate('this', 'sub\\%string\\%').isIndexed(queryContext)).toBe(false);
    expect(new LikePredicate('this', 'sub\\str\\%').isIndexed(queryContext)).toBe(false);
  });

  test('likePredicateIsNotIndexed_whenPercentWildcardIsNotTheLastSymbol', () => {
    const queryContext = createMockQueryContext(createMockIndex(IndexType.SORTED));
    expect(new LikePredicate('this', 'sub%str').isIndexed(queryContext)).toBe(false);
    expect(new LikePredicate('this', 'sub%   ').isIndexed(queryContext)).toBe(false);
  });

  test('likePredicateIsIndexed_whenPercentWildcardIsUsed_andIndexIsSorted', () => {
    const queryContext = createMockQueryContext(createMockIndex(IndexType.SORTED));
    expect(new LikePredicate('this', 'sub%').isIndexed(queryContext)).toBe(true);
    expect(new LikePredicate('this', 'sub\\\\%').isIndexed(queryContext)).toBe(true);
    expect(new LikePredicate('this', 'sub\\%string%').isIndexed(queryContext)).toBe(true);
    expect(new LikePredicate('this', 'sub\\_string%').isIndexed(queryContext)).toBe(true);
  });
});

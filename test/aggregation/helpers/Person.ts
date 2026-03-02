/** Port of com.hazelcast.aggregation.Person */
export class Person {
  age: number | null;

  constructor(age?: number | null) {
    this.age = age ?? null;
  }
}

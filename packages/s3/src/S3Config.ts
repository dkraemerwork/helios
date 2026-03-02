export interface Serializer<T> {
  serialize(value: T): string;
  deserialize(raw: string): T;
}

export interface S3Config<T = unknown> {
  bucket: string;
  prefix?: string;          // default: ''
  suffix?: string;          // default: '.json' — appended to key for S3 object key
  region?: string;
  endpoint?: string;        // for LocalStack / MinIO
  credentials?: { accessKeyId: string; secretAccessKey: string };
  serializer?: Serializer<T>;  // default: JSON.stringify / JSON.parse
}

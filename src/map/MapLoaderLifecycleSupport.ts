export interface MapLoaderLifecycleSupport {
  init(properties: Map<string, string>, mapName: string): Promise<void>;
  destroy(): Promise<void>;
}

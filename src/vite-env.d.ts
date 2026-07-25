/// <reference types="vite/client" />

declare module "occt-import-js" {
  interface OcctModule {
    ReadStepFile: (buffer: Uint8Array, params: unknown) => {
      success: boolean;
      meshes: {
        name: string;
        color?: number[];
        attributes: { position: { array: number[] }; normal?: { array: number[] } };
        index: { array: number[] };
      }[];
    };
  }
  const factory: (options?: { locateFile?: (file: string) => string }) => Promise<OcctModule>;
  export default factory;
}

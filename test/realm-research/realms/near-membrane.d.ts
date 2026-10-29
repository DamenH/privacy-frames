/** Public package omits the types its exports map names; describe the used API. */
declare module '@locker/near-membrane-dom' {
  interface Environment {
    evaluate(source: string): unknown;
  }
  interface Options {
    keepAlive: boolean;
    protectDistortions: boolean;
    globalObjectShape: object;
    distortionCallback?: (value: object) => object;
    endowments?: PropertyDescriptorMap;
  }
  export default function createVirtualEnvironment(
    window: Window & typeof globalThis,
    options: Options,
  ): Environment;
}

declare module "picomatch" {
  export interface PicomatchOptions {
    dot?: boolean;
    basename?: boolean;
    windows?: boolean;
    [key: string]: unknown;
  }
  export type Matcher = (input: string) => boolean;
  function picomatch(glob: string | string[], options?: PicomatchOptions): Matcher;
  export default picomatch;
}

export interface CapturedResponse {
  url: string;
  bytes: ArrayBuffer;
  contentType: string;
}
export interface PreparedCache {
  name: string;
  entries: CapturedResponse[];
}
export type PreparationRequest =
  | { type: 'prepare'; scope: string; scriptURL: string; code: string }
  | {
      type: 'download-result';
      id: number;
      ok: true;
      bytes: ArrayBuffer;
      contentType: string;
    }
  | { type: 'download-result'; id: number; ok: false; error: string };
export type PreparationReply =
  | { type: 'download'; id: number; url: string }
  | { type: 'prepared'; caches: PreparedCache[] }
  | { type: 'failed'; error: string };
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

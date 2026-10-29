export const CONTENT_MARKER = 'data-privacy-content';
export interface ContentAttribute {
  name: string;
  value: string;
  namespace?: string;
}
interface ContentPosition {
  marker: string;
  /** Descriptors inside templates remain dormant until their template activates. */
  templates: string[];
}
export interface ContentScript extends ContentPosition {
  kind: 'classic' | 'module';
  async: boolean;
  defer: boolean;
  noModule: boolean;
  attributes: ContentAttribute[];
  source:
    | {
        kind: 'inline';
        code: string;
        baseURL: string;
      }
    | {
        kind: 'resource';
        url: string;
        sourceURL: string;
      }
    | {
        kind: 'unavailable';
        sourceURL: string;
      };
}
export interface ContentHandler extends ContentPosition {
  event: string;
  code: string;
}
export type ChildDocumentSource =
  | {
      kind: 'empty';
    }
  | {
      kind: 'srcdoc';
      text: string;
      baseURL: string;
    }
  | {
      kind: 'data' | 'blob';
      url: string;
      baseURL: string;
    }
  | {
      kind: 'url';
      url: string;
      installedURL?: string;
    };
export interface ContentContext extends ContentPosition {
  element: 'iframe' | 'object';
  source: ChildDocumentSource;
  attributes: ContentAttribute[];
}
export interface ContentCommon {
  sourceURL: string;
  baseURL: string;
  scripts: ContentScript[];
  handlers: ContentHandler[];
  contexts: ContentContext[];
}
export type CompiledDocumentContent = ContentCommon &
  (
    | {
        kind: 'html';
        html: {
          attributes: ContentAttribute[];
          bodyAttributes: ContentAttribute[];
          head: string;
          body: string;
        };
      }
    | {
        kind: 'svg';
        svg: {
          attributes: ContentAttribute[];
          content: string;
        };
      }
  );
export interface DocumentContentInput {
  kind: 'html' | 'svg';
  text: string;
  sourceURL: string;
  baseURL?: string;
  aliases: readonly (readonly [string, string])[];
  unavailableURLs?: readonly string[];
}

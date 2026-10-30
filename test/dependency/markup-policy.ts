import createDOMPurify, { type Config } from 'dompurify';
import {
  isNavigationTarget,
  isUnsafeTargetMutation,
} from '../../src/shared/navigation-targets.ts';

const purifier = createDOMPurify(window);
const defaultPurifier = createDOMPurify(window);
const construction = document.implementation.createHTMLDocument('');
const forbidden = [
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'portal',
  'fencedframe',
  'webview',
  'base',
  'script',
  'link',
  'meta',
];

// A candidate host adapter: the returned sanitized text is the only insertable
// value. `removed` below is diagnostic, never an authorization decision.
purifier.addHook('uponSanitizeAttribute', (_node, data) => {
  if (
    (isNavigationTarget(data.attrName) && data.attrValue.toLowerCase() !== '_self') ||
    isUnsafeTargetMutation(data.attrName, data.attrValue)
  )
    data.keepAttr = false;
});

function configuration(hostPolicy: boolean): Config {
  const config: Config = {
    TRUSTED_TYPES_POLICY: null,
    RETURN_TRUSTED_TYPE: false,
    ...(hostPolicy
      ? {
          FORBID_TAGS: forbidden,
          FORBID_ATTR: ['srcdoc', 'is', 'manifest'],
          ADD_ATTR: ['target', 'formtarget'],
          CUSTOM_ELEMENT_HANDLING: {
            tagNameCheck: /^[a-z][\w.]*-[\w.-]+$/,
            attributeNameCheck: /^[\w:-]+$/,
            allowCustomizedBuiltInElements: false,
          },
        }
      : {}),
  };
  return config;
}

export function sanitize(text: string, hostPolicy: boolean) {
  const instance = hostPolicy ? purifier : defaultPurifier;
  const html = instance.sanitize(text, configuration(hostPolicy));
  return { html, removed: instance.removed.length, supported: instance.isSupported };
}

/** Test a context-aware adapter rather than treating every fragment as body HTML. */
export function sanitizeContext(text: string, localName: string, namespace: string) {
  const container = construction.createElementNS(namespace, localName);
  container.innerHTML = text;
  const result = purifier.sanitize(container, {
    ...configuration(true),
    IN_PLACE: true,
  });
  if (result !== container) throw new Error('Sanitizer replaced the parsing container');
  return {
    html: container.innerHTML,
    removed: purifier.removed.length,
    supported: purifier.isSupported,
  };
}

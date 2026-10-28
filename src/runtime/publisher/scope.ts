import { ownDescriptor, strings } from '../../shared/primordials.ts';

const NativeURL = URL;
const apply = Reflect.apply;
const href = ownDescriptor(NativeURL.prototype, 'href')!.get!;
const origin = ownDescriptor(NativeURL.prototype, 'origin')!.get!;
const pathname = ownDescriptor(NativeURL.prototype, 'pathname')!.get!;
const search = ownDescriptor(NativeURL.prototype, 'search')!.get!;
const hash = ownDescriptor(NativeURL.prototype, 'hash')!.get!;
const username = ownDescriptor(NativeURL.prototype, 'username')!.get!;
const password = ownDescriptor(NativeURL.prototype, 'password')!.get!;

interface ScopeContext {
  applicationURL: string;
  installationSourceURL: string;
  documentBaseURL: string;
}

/** Translate this app's physical scope to its existing publisher identity. */
export function publisherRegistrationScope(
  input: string | undefined,
  scriptURL: string,
  context: ScopeContext,
): string {
  if (input === undefined) return apply(href, new NativeURL('./', scriptURL), []);
  const application = new NativeURL(context.applicationURL);
  const applicationPath: string = apply(pathname, application, []);
  const physical = new NativeURL(
    input,
    strings.startsWith(input, applicationPath)
      ? context.applicationURL
      : context.documentBaseURL,
  );
  const path: string = apply(pathname, physical, []);
  if (
    apply(origin, physical, []) === apply(origin, application, []) &&
    !apply(username, physical, []) &&
    !apply(password, physical, []) &&
    strings.startsWith(path, applicationPath)
  ) {
    const directory = new NativeURL('./', context.installationSourceURL);
    const relative = strings.slice(path, applicationPath.length);
    return (
      apply(href, new NativeURL(relative, directory), []) +
      apply(search, physical, []) +
      apply(hash, physical, [])
    );
  }
  return apply(href, physical, []);
}

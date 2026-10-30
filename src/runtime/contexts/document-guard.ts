import { installDocumentExitGuard } from '../enforcement/document-exit.ts';

try {
  installDocumentExitGuard();
  const bootstrapScript =
    document.currentScript || document.querySelector('script[data-privacy-context]');
  const apply = Reflect.apply;
  const text = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')!.set!;
  const root = document.documentElement;
  const report = console.error.bind(console);
  void import('./document-main.ts')
    .then(({ startDocumentGuard }) => startDocumentGuard(bootstrapScript))
    .catch((error: unknown) => {
      apply(text, root, ['Application document could not start.']);
      report(error);
    });
} catch (error) {
  document.documentElement.textContent =
    'The browser could not establish runtime restrictions.';
  console.error(error);
}

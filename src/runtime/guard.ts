import { installDocumentExitGuard } from './enforcement/document-exit.ts';

try {
  installDocumentExitGuard();
  const bootstrapScript = document.currentScript;
  const apply = Reflect.apply;
  const text = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')!.set!;
  const body = document.body;
  const report = console.error.bind(console);
  void import('./root-guard.ts')
    .then(({ startRootGuard }) => startRootGuard(bootstrapScript))
    .catch((error: unknown) => {
      apply(text, body, ['Application could not start.']);
      report(error);
    });
} catch (error) {
  document.body.textContent = 'The browser could not establish runtime restrictions.';
  console.error(error);
}

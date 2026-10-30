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
  const title = document.createElement('h1');
  title.textContent = 'Application refused';
  const description = document.createElement('p');
  description.textContent =
    'The browser could not establish the required runtime restrictions.';
  document.body.replaceChildren(title, description);
  console.error(error);
}

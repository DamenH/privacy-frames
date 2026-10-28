const bindingNames = [
  'Array',
  'Object',
  'Proxy',
  'Reflect',
  'JSON',
  'Promise',
  'globalThis',
  'AudioWorkletProcessor',
];
for (const name of bindingNames) {
  if (!(name in globalThis)) continue;
  const original = Reflect.get(globalThis, name);
  let assignmentRejected = false;
  try {
    assignmentRejected = !Reflect.set(
      globalThis,
      name,
      function applicationReplacement() {},
    );
  } catch {
    assignmentRejected = true;
  }
  if (!assignmentRejected || Reflect.get(globalThis, name) !== original)
    throw new Error('Worklet assignment replaced ' + name);
  let rejected = false;
  try {
    Object.defineProperty(globalThis, name, {
      value: function applicationReplacement() {},
    });
  } catch {
    rejected = true;
  }
  if (!rejected || Reflect.get(globalThis, name) !== original)
    throw new Error('Worklet property definition replaced ' + name);
}
const originalPush = Array.prototype.push;
let pushRejected = false;
try {
  Array.prototype.push = function () {
    return 0;
  };
} catch {
  pushRejected = true;
}
if (!pushRejected || Array.prototype.push !== originalPush)
  throw new Error('Worklet native array operation was replaced');
let implicitHookRejected = false;
try {
  Object.defineProperty(Object.prototype, 'then', { value() {} });
} catch {
  implicitHookRejected = true;
}
if (!implicitHookRejected || Reflect.get(Object.prototype, 'then') !== undefined)
  throw new Error('Worklet implicit promise protocol was replaced');
Object.defineProperty(Object.prototype, '__workletOrdinaryExtension', {
  value: 31,
  configurable: true,
});
if (Reflect.get({}, '__workletOrdinaryExtension') !== 31)
  throw new Error('Worklet ordinary prototype extension was refused');
Reflect.deleteProperty(Object.prototype, '__workletOrdinaryExtension');
Reflect.set(globalThis, 'dependencyPrototypeProtected', true);
Reflect.set(globalThis, 'dependencyBindingsSealed', true);
export {};

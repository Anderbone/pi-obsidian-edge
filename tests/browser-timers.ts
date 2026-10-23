// Client tests run in Node; production uses the browser window's timer lifecycle.
Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });

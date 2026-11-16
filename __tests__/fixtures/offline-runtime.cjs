// No outbound requests during CLI regression tests or offline build checks.
globalThis.fetch = async () => { throw new Error('synthetic upstream unavailable'); };

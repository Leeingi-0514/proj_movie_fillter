(() => {
  if (window.parent !== window) { window.chrome = window.parent.chrome; return; }
  let data = {}, listeners = [], receiver = null;
  window.chrome = {
    storage: { local: { get: async key => ({ [key]: data[key] }), set: async updates => {
      const changes = {}; for (const [key, value] of Object.entries(updates)) { changes[key] = { oldValue: data[key], newValue: structuredClone(value) }; data[key] = structuredClone(value); }
      for (const callback of listeners) callback(changes, 'local');
    } }, onChanged: { addListener: cb => listeners.push(cb) } },
    runtime: { onMessage: { addListener: cb => receiver = cb } },
    tabs: { query: async () => [{ id: 1, url: `https://www.netflix.com${location.pathname}` }], sendMessage: async (_id, msg) => new Promise(resolve => receiver(msg, {}, resolve)) }
  };
})();

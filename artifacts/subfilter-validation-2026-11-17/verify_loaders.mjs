import fs from 'node:fs';
import { parseSegments } from '../../filter-engine.js';
await import('../../extension/filter-engine.js');

const paths = JSON.parse(fs.readFileSync(0, 'utf8'));
const results = paths.map(path => {
  const payload = JSON.parse(fs.readFileSync(path, 'utf8'));
  const result = { path, types: payload.segments.map(s => s.type) };
  for (const [name, loader] of Object.entries({
    web: parseSegments,
    extension: globalThis.MovieGuardEngine.normalizePayload,
  })) {
    try {
      result[name] = { accepted: true, count: loader(payload).length };
    } catch (error) {
      result[name] = { accepted: false, error: error.message };
    }
  }
  return result;
});
process.stdout.write(JSON.stringify(results));

import test from 'node:test';
import assert from 'node:assert/strict';
import { compactPersistedStateValue } from './persistedStateBudget';

test('compactPersistedStateValue keeps small persisted payload unchanged', () => {
  const raw = JSON.stringify({
    state: {
      projectName: 'small-project',
      tasks: [],
      globalReferenceImages: [],
    },
    version: 0,
  });

  const result = compactPersistedStateValue(raw, raw.length + 10);

  assert.equal(result.compacted, false);
  assert.equal(result.value, raw);
});

test('compactPersistedStateValue strips task image payloads when snapshot is oversized', () => {
  const raw = JSON.stringify({
    state: {
      projectName: 'oversized-project',
      globalReferenceImages: ['data:image/png;base64,global'],
      tasks: [
        {
          id: 'task-1',
          index: 1,
          title: 'Heavy task',
          description: 'keep this text',
          sourceImage: `data:image/png;base64,${'a'.repeat(512)}`,
          referenceImages: [`data:image/png;base64,${'b'.repeat(256)}`],
          resultImage: `data:image/png;base64,${'c'.repeat(128)}`,
          resultImagePreview: `data:image/png;base64,${'d'.repeat(128)}`,
          resultImageOriginal: `data:image/png;base64,${'e'.repeat(128)}`,
          resultImages: [
            {
              id: 'result-1',
              src: `data:image/png;base64,${'f'.repeat(128)}`,
              createdAt: 1,
            },
          ],
          status: 'Idle',
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    },
    version: 0,
  });

  const result = compactPersistedStateValue(raw, 100);
  const parsed = JSON.parse(result.value) as {
    state: {
      globalReferenceImages: string[];
      tasks: Array<{
        description: string;
        sourceImage?: string;
        referenceImages: string[];
        resultImage?: string;
        resultImages?: Array<{ id: string; src: string; assetId?: string }>;
      }>;
    };
  };

  assert.equal(result.compacted, true);
  assert.equal(parsed.state.tasks[0].description, 'keep this text');
  assert.equal(parsed.state.tasks[0].sourceImage, undefined);
  assert.deepEqual(parsed.state.tasks[0].referenceImages, []);
  assert.equal(parsed.state.tasks[0].resultImage, undefined);
  assert.equal(parsed.state.tasks[0].resultImages?.[0].id, 'result-1');
  assert.equal(parsed.state.tasks[0].resultImages?.[0].src, '');
  assert.deepEqual(parsed.state.globalReferenceImages, []);
});

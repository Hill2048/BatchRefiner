import test from 'node:test';
import assert from 'node:assert/strict';
import { getResultDownloadDiagnostics, resolveResultImageDownloadBlob, ResultImageDownloadError } from './resultImageDownload';

test('resolveResultImageDownloadBlob rejects invalid asset sources at normalize stage', async () => {
  await assert.rejects(
    () => resolveResultImageDownloadBlob({
      id: 'result-1',
      src: 'preview.png',
      createdAt: 1,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ResultImageDownloadError);
      assert.equal(error.stage, 'normalize');
      assert.equal(error.status, 'invalid_source');
      return true;
    },
  );
});

test('download diagnostics default to stage/source/cache and ignore size deltas', () => {
  assert.equal(
    getResultDownloadDiagnostics(
      {
        id: 'result-1',
        src: 'https://example.com/render.png',
        originalSrc: 'https://example.com/original.png',
        requestedWidth: 832,
        requestedHeight: 1248,
        assetWidth: 1023,
        assetHeight: 1537,
        createdAt: 1,
      },
      {
        stage: 'fetch',
        cacheStatus: 'failed',
        sourceType: 'original',
      },
    ),
    '阶段=fetch / 源=original / 缓存=failed',
  );
});

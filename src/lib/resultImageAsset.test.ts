import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getResultImageAssetDimensions,
  getResultImageAssetExtension,
  getResultImageAssetSrc,
  getResultImageDownloadSourceType,
  getResultImageRequestedDimensions,
  inferResultImageAssetMetadata,
  isValidResultImageAssetSrc,
} from './resultImageAsset';

test('asset source prefers original src over preview/display src', () => {
  assert.equal(
    getResultImageAssetSrc({
      src: 'https://example.com/preview.png',
      originalSrc: 'https://example.com/original.png',
    }),
    'https://example.com/preview.png',
  );

  assert.equal(
    getResultImageAssetSrc({
      src: 'https://example.com/render.webp',
    }),
    'https://example.com/render.webp',
  );
});

test('asset dimensions prefer asset size over legacy width height', () => {
  assert.deepEqual(
    getResultImageAssetDimensions({
      width: 832,
      height: 1248,
      assetWidth: 1023,
      assetHeight: 1537,
    }),
    { width: 1023, height: 1537 },
  );

  assert.deepEqual(
    getResultImageRequestedDimensions({
      requestedWidth: 832,
      requestedHeight: 1248,
    }),
    { width: 832, height: 1248 },
  );
});

test('download source type treats data url as its own source category', () => {
  assert.equal(
    getResultImageDownloadSourceType({
      src: 'data:image/png;base64,abcd',
    }),
    'data_url',
  );

  assert.equal(
    getResultImageDownloadSourceType({
      src: 'https://example.com/render.png',
      originalSrc: 'https://example.com/original.png',
    }),
    'src',
  );
});

test('asset metadata infers extension without producing double suffixes', () => {
  assert.equal(
    getResultImageAssetExtension({
      src: 'https://example.com/path/final-image.jpeg?token=1',
    }),
    'jpg',
  );

  const metadata = inferResultImageAssetMetadata('data:image/webp;base64,abcd');
  assert.equal(metadata.mimeType, 'image/webp');
  assert.equal(metadata.extension, 'webp');
});

test('asset source validation only checks source usability, not size differences', () => {
  assert.equal(isValidResultImageAssetSrc('https://example.com/result.png'), true);
  assert.equal(isValidResultImageAssetSrc('data:image/png;base64,abcd'), true);
  assert.equal(isValidResultImageAssetSrc('blob:https://example.com/123'), true);
  assert.equal(isValidResultImageAssetSrc(''), false);
  assert.equal(isValidResultImageAssetSrc('preview.png'), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { mapOpenverseImage, mapPexelsPhoto, mapPixabayImage, mapPixabayVideo, mapWikimediaPage } from '../src/lib/mediaProviders';

test('maps Pexels photos as approved stock assets', () => {
  const asset = mapPexelsPhoto({
    id: 123,
    width: 1920,
    height: 1080,
    url: 'https://www.pexels.com/photo/example-123/',
    photographer: 'Jane Doe',
    src: {
      original: 'https://images.pexels.com/photos/123/original.jpg',
      large: 'https://images.pexels.com/photos/123/large.jpg',
    },
    alt: 'city street',
  });

  assert.equal(asset.provider, 'pexels');
  assert.equal(asset.licenseStatus, 'approved');
  assert.equal(asset.license.commercialUseAllowed, true);
});

test('maps Pixabay images as approved stock assets', () => {
  const asset = mapPixabayImage({
    id: 456,
    imageWidth: 1280,
    imageHeight: 720,
    pageURL: 'https://pixabay.com/photos/example-456/',
    largeImageURL: 'https://cdn.pixabay.com/photo.jpg',
    webformatURL: 'https://cdn.pixabay.com/preview.jpg',
    user: 'John Doe',
    tags: 'people walking street',
  });

  assert.equal(asset.provider, 'pixabay');
  assert.equal(asset.licenseStatus, 'approved');
});

test('maps Pixabay video thumbnails from rendition metadata', () => {
  const asset = mapPixabayVideo({
    id: 789,
    pageURL: 'https://pixabay.com/videos/example-789/',
    user: 'Video Creator',
    tags: 'waterfall jungle',
    duration: 12,
    videos: {
      medium: {
        url: 'https://cdn.pixabay.com/video/medium.mp4',
        width: 1920,
        height: 1080,
        thumbnail: 'https://cdn.pixabay.com/video/medium.jpg',
      },
      tiny: {
        url: 'https://cdn.pixabay.com/video/tiny.mp4',
        width: 640,
        height: 360,
        thumbnail: 'https://cdn.pixabay.com/video/tiny.jpg',
      },
    },
  });

  assert.equal(asset.provider, 'pixabay');
  assert.equal(asset.mediaType, 'video');
  assert.equal(asset.previewUrl, 'https://cdn.pixabay.com/video/medium.jpg');
  assert.equal(asset.licenseStatus, 'approved');
});

test('maps Wikimedia CC BY metadata as attribution required', () => {
  const asset = mapWikimediaPage({
    pageid: 1,
    title: 'File:Example.jpg',
    imageinfo: [{
      url: 'https://upload.wikimedia.org/example.jpg',
      thumburl: 'https://upload.wikimedia.org/thumb/example.jpg',
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
      mime: 'image/jpeg',
      width: 1024,
      height: 768,
      extmetadata: {
        ObjectName: { value: 'Example image' },
        Artist: { value: 'Example Artist' },
        LicenseShortName: { value: 'CC BY 4.0' },
        LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' },
      },
    }],
  });

  assert.ok(asset);
  assert.equal(asset?.provider, 'wikimedia');
  assert.equal(asset?.licenseStatus, 'attribution_required');
  assert.match(asset?.attributionText || '', /Example Artist/);
});

test('maps Openverse candidates as review required', () => {
  const asset = mapOpenverseImage({
    id: 'abc',
    title: 'Openverse photo',
    creator: 'Creator',
    url: 'https://example.com/photo.jpg',
    thumbnail: 'https://example.com/thumb.jpg',
    foreign_landing_url: 'https://source.example/photo',
    license: 'cc0',
    license_version: '1.0',
    license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  });

  assert.equal(asset.provider, 'openverse');
  assert.equal(asset.licenseStatus, 'review_required');
  assert.ok(asset.riskFlags.includes('openverse_unverified'));
});

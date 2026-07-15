'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const androidRoot = path.resolve(__dirname, '..', '..', 'android');
const read = (...parts) => fs.readFileSync(path.join(androidRoot, ...parts), 'utf8');

test('Android app targets API 36 and version 1.1.0', () => {
  const build = read('app', 'build.gradle');
  assert.match(build, /compileSdk 36/);
  assert.match(build, /targetSdk 36/);
  assert.match(build, /versionName '1\.1\.0'/);
});

test('Android app implements all mobile transfer actions', () => {
  const activity = read('app', 'src', 'main', 'java', 'cn', 'jiyu', 'meshuttle', 'MainActivity.java');
  assert.match(activity, /ACTION_OPEN_DOCUMENT/);
  assert.match(activity, /ACTION_OPEN_DOCUMENT_TREE/);
  assert.match(activity, /sendText\(/);
  assert.match(activity, /uploadFiles\(/);
  assert.match(activity, /downloadItemsTo\(/);
  assert.match(activity, /confirmDelete\(/);
});

test('Android API streams files and authenticates every request', () => {
  const api = read('app', 'src', 'main', 'java', 'cn', 'jiyu', 'meshuttle', 'MeshuttleApi.java');
  const secrets = read('app', 'src', 'main', 'java', 'cn', 'jiyu', 'meshuttle', 'SecretStore.java');
  assert.match(api, /setFixedLengthStreamingMode\(size\)/);
  assert.match(api, /Authorization/);
  assert.match(api, /BufferedInputStream/);
  assert.match(secrets, /AndroidKeyStore/);
  assert.doesNotMatch(`${api}\n${secrets}`, /syncthing/i);
});

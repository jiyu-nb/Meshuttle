'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..', '..');

test('desktop Syncthing launch handles Windows and macOS differences', () => {
  const controller = fs.readFileSync(path.join(projectRoot, 'client', 'p2p', 'syncthing.js'), 'utf8');
  const integration = fs.readFileSync(path.join(projectRoot, 'tools', 'test-p2p-cluster.js'), 'utf8');

  assert.match(controller, /process\.platform === 'win32'[\s\S]+--no-console/);
  assert.match(controller, /Array\.isArray\(device\.addresses\)[\s\S]+addresses,/);
  assert.match(integration, /process\.platform === 'win32' \? 'syncthing\.exe' : 'syncthing'/);
  assert.match(integration, /tcp:\/\/127\.0\.0\.1:[${}\w]+[\s\S]+listenAddresses: \[syncAddress\]/);
});

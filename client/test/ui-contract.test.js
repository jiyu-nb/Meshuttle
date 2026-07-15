'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rendererDir = path.resolve(__dirname, '..', 'renderer');
const pages = [
  ['index.html', 'renderer.js'],
  ['mini.html', 'mini.js'],
  ['setup.html', 'setup.js']
];
const retiredBrands = [
  ['Three', 'Drop'],
  ['three', 'Drop'],
  ['三端', '快传'],
  ['THREE', ' DROP']
].map((parts) => new RegExp(parts.join('')));

function read(name) {
  return fs.readFileSync(path.join(rendererDir, name), 'utf8');
}

function plainText(html) {
  return html.replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

for (const [htmlName, scriptName] of pages) {
  test(`${htmlName} has no empty or unhandled buttons`, () => {
    const html = read(htmlName);
    const script = read(scriptName);
    const matches = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)];
    assert.ok(matches.length > 0, `${htmlName} should contain buttons`);

    for (const [, attributes, body] of matches) {
      const id = attributes.match(/\bid="([^"]+)"/i)?.[1] || '';
      const text = plainText(body);
      assert.ok(text, `${htmlName}${id ? `#${id}` : ''} contains an empty button`);

      const submit = /\btype="submit"/i.test(attributes);
      const delegated = /\bdata-(?:mode|p2p-action)=/i.test(attributes);
      const directHandler = id && (script.includes(`$('#${id}').addEventListener`) || script.includes(`${id}.addEventListener`));
      assert.ok(submit || delegated || directHandler, `${htmlName}#${id || '(no id)'} has no interaction handler`);
    }
  });

  test(`${htmlName} ids are unique and script selectors resolve`, () => {
    const html = read(htmlName);
    const script = read(scriptName);
    const ids = [...html.matchAll(/\bid="([^"]+)"/gi)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${htmlName} contains duplicate ids`);
    const idSet = new Set(ids);
    const selectors = [...script.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((match) => match[1]);
    for (const id of selectors) assert.ok(idSet.has(id), `${scriptName} references missing #${id}`);
  });

  test(`${htmlName} uses the Meshuttle bridge and contains no retired brand`, () => {
    const html = read(htmlName);
    const script = read(scriptName);
    for (const retiredBrand of retiredBrands) assert.doesNotMatch(`${html}\n${script}`, retiredBrand);
    assert.match(script, /window\.meshuttle/);
  });
}

test('all visible setup inputs have labels or accessible names', () => {
  const html = read('setup.html');
  const visibleControls = [...html.matchAll(/<(input|select)\b([^>]*)>/gi)]
    .filter(([, , attributes]) => !/\bhidden\b/i.test(attributes) && !/\btype="file"/i.test(attributes));
  for (const [, tag, attributes] of visibleControls) {
    const id = attributes.match(/\bid="([^"]+)"/i)?.[1];
    const ariaLabel = attributes.match(/\baria-label="([^"]+)"/i)?.[1];
    assert.ok(id, `${tag} is missing an id`);
    assert.ok(ariaLabel || new RegExp(`<label\\s+for="${id}"`, 'i').test(html), `#${id} is missing a label`);
  }
});

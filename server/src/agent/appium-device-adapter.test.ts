import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toAppiumAction, resolveBundleId, screenshotOutcome } from './appium-device-adapter'

test('toAppiumAction maps gestures to XCUITest mobile: scripts', () => {
  assert.deepEqual(toAppiumAction({ kind: 'screenshot' }), { via: 'screenshot' })
  assert.deepEqual(toAppiumAction({ kind: 'reboot' }), { via: 'reboot' })
  assert.deepEqual(toAppiumAction({ kind: 'type', text: 'hi' }), { via: 'type', text: 'hi' })
  assert.deepEqual(toAppiumAction({ kind: 'tap', x: 5, y: 6 }), { via: 'execute', script: 'mobile: tap', args: [{ x: 5, y: 6 }] })
  assert.deepEqual(toAppiumAction({ kind: 'swipe', dir: 'up' }), { via: 'execute', script: 'mobile: swipe', args: [{ direction: 'up' }] })
  assert.deepEqual(toAppiumAction({ kind: 'lock' }), { via: 'execute', script: 'mobile: lock', args: [{}] })
  assert.deepEqual(toAppiumAction({ kind: 'unlock' }), { via: 'execute', script: 'mobile: unlock', args: [{}] })
})

test('home and switcher both go to the home screen (XCUITest has no app-switcher gesture)', () => {
  const home = toAppiumAction({ kind: 'home' })
  assert.deepEqual(home, { via: 'execute', script: 'mobile: pressButton', args: [{ name: 'home' }] })
  assert.deepEqual(toAppiumAction({ kind: 'switcher' }), home)
})

test('back emulates the iOS left-edge swipe', () => {
  const back = toAppiumAction({ kind: 'back' })
  assert.equal(back.via, 'execute')
  assert.equal((back as { script: string }).script, 'mobile: dragFromToForDuration')
})

test('launch resolves a bundleId via the map or an explicit bundle id', () => {
  assert.deepEqual(
    toAppiumAction({ kind: 'launch', appName: 'Instagram' }, { Instagram: 'com.burbn.instagram' }),
    { via: 'execute', script: 'mobile: activateApp', args: [{ bundleId: 'com.burbn.instagram' }] },
  )
  // an appName that is already a bundle id passes through without a map
  assert.deepEqual(
    toAppiumAction({ kind: 'launch', appName: 'com.apple.Preferences' }),
    { via: 'execute', script: 'mobile: activateApp', args: [{ bundleId: 'com.apple.Preferences' }] },
  )
})

test('launch without a resolvable bundleId throws LAUNCH_UNMAPPED', () => {
  try {
    toAppiumAction({ kind: 'launch', appName: 'Instagram' })
    assert.fail('expected throw')
  } catch (e) {
    assert.equal((e as { code?: string }).code, 'LAUNCH_UNMAPPED')
  }
})

test('install is delegated to ABM/MDM (throws INSTALL_UNSUPPORTED)', () => {
  try {
    toAppiumAction({ kind: 'install', appName: 'Whatever' })
    assert.fail('expected throw')
  } catch (e) {
    assert.equal((e as { code?: string }).code, 'INSTALL_UNSUPPORTED')
  }
})

test('screenshotOutcome carries REAL base64 + device logical dims, degrades safely', () => {
  // valid base64 + window rect → bytes carried with logical size (rounded, positive)
  assert.deepEqual(
    screenshotOutcome('AAAA', { width: 390, height: 844 }),
    { result: { screenshot: { base64: 'AAAA', format: 'png', width: 390, height: 844 } } },
  )
  // missing/invalid rect → bytes still carried, dims null (UI falls back to glass coords)
  assert.deepEqual(
    screenshotOutcome('BBBB'),
    { result: { screenshot: { base64: 'BBBB', format: 'png', width: null, height: null } } },
  )
  assert.deepEqual(
    screenshotOutcome('CCCC', { width: 0, height: -5 }),
    { result: { screenshot: { base64: 'CCCC', format: 'png', width: null, height: null } } },
  )
  // non-string / empty WDA value → benign marker, never a fabricated frame
  assert.deepEqual(screenshotOutcome(undefined), { result: { screenshot: 'captured' } })
  assert.deepEqual(screenshotOutcome(''), { result: { screenshot: 'captured' } })
})

test('resolveBundleId: map hit, bundle-id passthrough, plain name → null', () => {
  assert.equal(resolveBundleId('Insta', { Insta: 'com.x.y' }), 'com.x.y')
  assert.equal(resolveBundleId('com.burbn.instagram'), 'com.burbn.instagram')
  assert.equal(resolveBundleId('Instagram'), null)         // not in a map, not a bundle id
  assert.equal(resolveBundleId('com app'), null)           // spaces → not a bundle id
  assert.equal(resolveBundleId(''), null)
})

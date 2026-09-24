import { describe, expect, it } from 'vitest'

import {
  normalizeShellGPTOpenString,
  pathFromShellGPTDeepLink,
  pathFromOpenDeepLink,
  resolveShellGPTOpenPath
} from './shellgpt-open-target'

describe('normalizeShellGPTOpenString', () => {
  it('accepts hash-router paths and strips a leading hash', () => {
    expect(normalizeShellGPTOpenString('/index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeShellGPTOpenString('#/index-network/intent/1')).toBe('/index-network/intent/1')
  })

  it('maps plugin-scoped shellgpt:// deep links to the same path', () => {
    expect(normalizeShellGPTOpenString('shellgpt://index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeShellGPTOpenString('shellgpt://index-network/intent/1?focus=true')).toBe(
      '/index-network/intent/1?focus=true'
    )
  })

  it('maps shellgpt://open/… deep links by stripping the open host', () => {
    expect(normalizeShellGPTOpenString('shellgpt://open/index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeShellGPTOpenString('shellgpt://open/settings/plugins')).toBe('/settings/plugins')
  })

  it('rejects reserved shellgpt kinds and unsafe paths', () => {
    expect(normalizeShellGPTOpenString('shellgpt://blueprint/morning-brief')).toBeNull()
    expect(normalizeShellGPTOpenString('shellgpt://plugin/install')).toBeNull()
    expect(normalizeShellGPTOpenString('https://example.com/x')).toBeNull()
    expect(normalizeShellGPTOpenString('/../etc/passwd')).toBeNull()
    expect(normalizeShellGPTOpenString('index-network')).toBeNull()
  })
})

describe('resolveShellGPTOpenPath', () => {
  it('merges structured path + params', () => {
    expect(resolveShellGPTOpenPath({ path: '/index-network/intent/1', params: { focus: 'true' } })).toBe(
      '/index-network/intent/1?focus=true'
    )
  })

  it('resolves href the same as a bare string', () => {
    expect(resolveShellGPTOpenPath({ href: 'shellgpt://index-network/intent/1' })).toBe('/index-network/intent/1')
  })
})

describe('pathFromShellGPTDeepLink', () => {
  it('builds the navigate path from a plugin-scoped deep-link payload', () => {
    expect(pathFromShellGPTDeepLink('index-network', 'intent/1')).toBe('/index-network/intent/1')
  })

  it('builds the navigate path from shellgpt://open/… payloads', () => {
    expect(pathFromOpenDeepLink('index-network/intent/1')).toBe('/index-network/intent/1')
    expect(pathFromShellGPTDeepLink('open', 'agent/42')).toBe('/agent/42')
  })

  it('ignores reserved kinds', () => {
    expect(pathFromShellGPTDeepLink('blueprint', 'morning-brief')).toBeNull()
    expect(pathFromShellGPTDeepLink('plugin', 'install')).toBeNull()
  })
})

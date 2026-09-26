import { describe, it, expect } from 'vitest'
import {
  resolveWorkerMode,
  resolveWorkerProxyAvailable,
  resolveStationAgentMode,
  diagnoseStationAgentMode
} from '../transport'

describe('transport policy', () => {
  describe('worker (one service, one tunnel, one token)', () => {
    it('always proxies unless explicitly told otherwise', () => {
      expect(resolveWorkerMode(undefined)).toBe('proxy')
      expect(resolveWorkerMode('')).toBe('proxy')
    })

    it('honours an explicit direct override for a LAN worker', () => {
      expect(resolveWorkerMode('direct')).toBe('direct')
    })

    it('is case and whitespace insensitive', () => {
      expect(resolveWorkerMode('  DIRECT  ')).toBe('direct')
      expect(resolveWorkerMode('Proxy')).toBe('proxy')
    })

    it('ignores junk rather than silently routing direct', () => {
      expect(resolveWorkerMode('yes-please')).toBe('proxy')
      expect(resolveWorkerMode('0')).toBe('proxy')
    })
  })

  describe('worker proxy availability', () => {
    it('is always true in a deployed build (Pages Function exists)', () => {
      expect(resolveWorkerProxyAvailable(true, undefined)).toBe(true)
      expect(resolveWorkerProxyAvailable(true, false)).toBe(true)
    })

    it('follows the compiled dev flag in local dev', () => {
      expect(resolveWorkerProxyAvailable(false, true)).toBe(true)
      expect(resolveWorkerProxyAvailable(false, false)).toBe(false)
    })

    it('is false when the dev flag was never compiled in', () => {
      expect(resolveWorkerProxyAvailable(false, undefined)).toBe(false)
    })
  })

  describe('station agents (four services, four tokens)', () => {
    it('must proxy when deployed, because HTTPS cannot reach a private IP', () => {
      expect(resolveStationAgentMode(undefined, true)).toBe('proxy')
    })

    it('prefers the LAN in local dev', () => {
      expect(resolveStationAgentMode(undefined, false)).toBe('direct')
    })

    it('lets a LAN-only deployment force direct', () => {
      expect(resolveStationAgentMode('direct', true)).toBe('direct')
    })

    it('lets local dev route agents through the tunnel when away from the office', () => {
      expect(resolveStationAgentMode('proxy', false)).toBe('proxy')
    })
  })

  describe('station agent diagnosis', () => {
    it('flags a direct-mode station with no address, and says what to do', () => {
      const d = diagnoseStationAgentMode('direct', false);
      expect(d.problem).toBe('no-ip-configured')
      expect(d.detail).toMatch(/no workstation IP is configured/i)
      expect(d.detail).toMatch(/VITE_STATION_AGENT_MODE=proxy/)
    })

    it('does not flag a direct-mode station that has an address', () => {
      expect(diagnoseStationAgentMode('direct', true).problem).toBeUndefined()
    })

    it('does not flag an unaddressed station when proxying, since the server resolves it', () => {
      const d = diagnoseStationAgentMode('proxy', false);
      expect(d.mode).toBe('proxy')
      expect(d.problem).toBeUndefined()
    })
  })
})

import { describe, it, expect } from 'vitest'
import {
  resolveBranding,
  brandName,
  brandTitle,
  brandAlternateNames,
  BRANDING_DEFAULTS,
  type Branding
} from '../branding'

// Distinct from the production literals, so a test that accidentally asserts
// against BRANDING_DEFAULTS proves nothing about the override path.
const ALT: Branding = {
  productName: 'Reseller',
  productMark: '360°',
  siteUrl: 'https://alt.example',
  defaultProjectName: 'Alt Project',
  defaultContractCode: 'ALT-001',
  defaultClientName: 'Alt Client'
}

describe('branding', () => {
  describe('env resolution', () => {
    it('falls back to the current literals when nothing is set', () => {
      expect(resolveBranding({})).toEqual(BRANDING_DEFAULTS)
      expect(resolveBranding(undefined)).toEqual(BRANDING_DEFAULTS)
    })

    it('reads each variable independently', () => {
      expect(resolveBranding({ VITE_BRAND_NAME: 'UE Geo' }).productName).toBe('UE Geo')
      expect(resolveBranding({ VITE_BRAND_MARK: 'ℹ' }).productMark).toBe('ℹ')
      expect(resolveBranding({ VITE_BRAND_URL: 'https://geo.ue.example' }).siteUrl).toBe(
        'https://geo.ue.example'
      )
      expect(
        resolveBranding({ VITE_BRAND_PROJECT_NAME: 'TNB LV Phase 2' }).defaultProjectName
      ).toBe('TNB LV Phase 2')
      expect(resolveBranding({ VITE_BRAND_CONTRACT_CODE: 'UE-2026-01' }).defaultContractCode).toBe(
        'UE-2026-01'
      )
      expect(resolveBranding({ VITE_BRAND_CLIENT_NAME: 'TNB' }).defaultClientName).toBe('TNB')
    })

    it('trims surrounding whitespace, which .env quoting can introduce', () => {
      const b = resolveBranding({
        VITE_BRAND_NAME: '  UE Geo  ',
        VITE_BRAND_CLIENT_NAME: '\tTNB \n'
      })
      expect(b.productName).toBe('UE Geo')
      expect(b.defaultClientName).toBe('TNB')
    })

    it('treats a blank value as unset rather than rendering an empty brand', () => {
      const b = resolveBranding({ VITE_BRAND_NAME: '', VITE_BRAND_URL: '   ' })
      expect(b.productName).toBe(BRANDING_DEFAULTS.productName)
      expect(b.siteUrl).toBe(BRANDING_DEFAULTS.siteUrl)
    })

    it('omits the mark when it is set to an empty string, which is the only way to drop it', () => {
      expect(resolveBranding({ VITE_BRAND_MARK: '' }).productMark).toBe('')
      expect(resolveBranding({ VITE_BRAND_MARK: '  ' }).productMark).toBe('')
    })

    it('restores the default mark when the variable is absent entirely', () => {
      // Distinct from an empty value: absent means "not configured", and every
      // other variable treats blank the same way. The mark is the sole exception.
      expect(resolveBranding({}).productMark).toBe(BRANDING_DEFAULTS.productMark)
    })

    it('strips a trailing slash so path suffixes do not double up', () => {
      expect(resolveBranding({ VITE_BRAND_URL: 'https://geo.ue.example/' }).siteUrl).toBe(
        'https://geo.ue.example'
      )
      expect(resolveBranding({ VITE_BRAND_URL: 'https://geo.ue.example///' }).siteUrl).toBe(
        'https://geo.ue.example'
      )
    })

    it('takes its fallbacks from the supplied defaults, not the module constant', () => {
      const b = resolveBranding({}, ALT)
      expect(b).toEqual(ALT)
      expect(b.productName).toBe('Reseller')
      expect(b.productName).not.toBe(BRANDING_DEFAULTS.productName)
    })

    it('reproduces today\u2019s defaults exactly — an unset env is a no-op', () => {
      expect(BRANDING_DEFAULTS.productName).toBe('GeoSphere')
      expect(BRANDING_DEFAULTS.productMark).toBe('360°')
      expect(BRANDING_DEFAULTS.siteUrl).toBe('https://app.geosphere.my')
      expect(BRANDING_DEFAULTS.defaultContractCode).toBe('MMS-2026-GEO-01')
      expect(BRANDING_DEFAULTS.defaultClientName).toBe('Spatial Asset Operations')
    })
  })

  describe('composition', () => {
    it('joins wordmark and mark with no separator in lockup form', () => {
      expect(brandName(BRANDING_DEFAULTS)).toBe('GeoSphere360°')
    })

    it('omits an empty mark from the lockup', () => {
      expect(brandName({ ...BRANDING_DEFAULTS, productMark: '' })).toBe('GeoSphere')
    })

    it('spaces the mark and drops the degree ornament in prose form', () => {
      expect(brandTitle(BRANDING_DEFAULTS)).toBe('GeoSphere 360')
      expect(brandTitle({ ...ALT, productMark: 'ℹ' })).toBe('Reseller ℹ')
    })

    it('does not repeat the wordmark when the mark restates it', () => {
      expect(brandTitle({ ...ALT, productMark: 'Reseller' })).toBe('Reseller')
    })

    it('derives JSON-LD alternate names, leading with the bare wordmark', () => {
      expect(brandAlternateNames(BRANDING_DEFAULTS)).toEqual([
        'GeoSphere',
        'GeoSphere 360 WebGIS',
        'GeoSphere 360 Platform'
      ])
      expect(brandAlternateNames({ ...ALT, productMark: '' })).toEqual([
        'Reseller',
        'Reseller WebGIS',
        'Reseller Platform'
      ])
      for (const n of brandAlternateNames({ ...ALT, productName: 'UE Geo' })) {
        expect(n).not.toContain('GeoSphere')
      }
    })
  })

  describe('module-level binding', () => {
    it('is constructed from the build env with no configuration required', async () => {
      const { branding } = await import('../branding')
      expect(branding.productName).toBeTruthy()
      expect(branding.siteUrl).toMatch(/^https?:\/\//)
    })
  })
})
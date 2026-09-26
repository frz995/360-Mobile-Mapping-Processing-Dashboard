import { describe, it, expect } from 'vitest'
import {
  buildBucketObjectPath,
  buildUploadRelCandidates,
  resolveUploadMode
} from '../hub/BucketPublicationGate'

describe('buildBucketObjectPath', () => {
  it('fills the default {subgrid}/{filename} pattern', () => {
    expect(buildBucketObjectPath('{subgrid}/{filename}', 'N93E70', 'N93E70-0001.jpg')).toBe('N93E70/N93E70-0001.jpg')
  })

  it('fills a custom pattern', () => {
    expect(buildBucketObjectPath('images/{subgrid}/{filename}', 'N93E70', 'N93E70-0093.jpg')).toBe('images/N93E70/N93E70-0093.jpg')
  })

  it('fills tile pointFolder patterns without an extension', () => {
    expect(buildBucketObjectPath('tiles/{subgrid}/{pointFolder}/config.json', 'N93E70', 'N93E70-0007.jpg')).toBe('tiles/N93E70/N93E70-0007/config.json')
  })
})

describe('buildUploadRelCandidates', () => {
  it('prefers the survey run 05_Final output, then the release copy', () => {
    expect(buildUploadRelCandidates('N93E70', '20220904', 'N93E70-0001.jpg')).toEqual([
      '05_Final/Project-OUT/Grid 1/N93E70/20220904/panoramas/N93E70-0001.jpg',
      '05_Final/Project-OUT/Grid 1/N93E70/20220904/N93E70-0001.jpg',
      'DELIVERABLES/N93E70/N93E70-0001.jpg',
      '05_Final/N93E70/N93E70-0001.jpg'
    ])
  })

  it('skips run-folder paths when no run folder is set', () => {
    expect(buildUploadRelCandidates('N93E70', '', 'N93E70-0001.jpg')).toEqual([
      'DELIVERABLES/N93E70/N93E70-0001.jpg',
      '05_Final/N93E70/N93E70-0001.jpg'
    ])
    expect(buildUploadRelCandidates('N93E70', '__custom__', 'N93E70-0001.jpg')).toEqual([
      'DELIVERABLES/N93E70/N93E70-0001.jpg',
      '05_Final/N93E70/N93E70-0001.jpg'
    ])
  })
})

describe('resolveUploadMode (any-provider channel selection)', () => {
  it('uses the browser channel for supabase single-image with a worker URL', () => {
    expect(resolveUploadMode('supabase', 'single_equirectangular', true, true).mode).toBe('browser')
  })

  it('falls back to the agent CLI when no worker URL is set', () => {
    const r = resolveUploadMode('supabase', 'single_equirectangular', false, true)
    expect(r.mode).toBe('agent_cli')
  })

  it('pushes every cloud provider via the agent CLI', () => {
    for (const provider of ['cloudflare_r2', 'aws_s3', 'wasabi', 'gcs', 'azure_blob', 'nas_local']) {
      const r = resolveUploadMode(provider, 'single_equirectangular', false, true)
      expect(r.mode).toBe('agent_cli')
    }
  })

  it('reports unavailable when neither channel exists', () => {
    const r = resolveUploadMode('aws_s3', 'single_equirectangular', false, false)
    expect(r.mode).toBe('unavailable')
    expect(r.reason).toContain('No station agent')
  })

  it('custom CDN has no CLI channel', () => {
    const r = resolveUploadMode('custom_cdn', 'single_equirectangular', true, true)
    expect(r.mode).toBe('unavailable')
    expect(r.reason).toContain('Custom CDN')
  })

  it('tile strategy avoids the browser channel even on supabase', () => {
    expect(resolveUploadMode('supabase', 'multires_tiles', true, true).mode).toBe('agent_cli')
  })
})
import { describe, it, expect } from 'vitest'
import { extractSubgridName, generateImageFilenamesList } from '../subgrid'

describe('extractSubgridName', () => {
  it('returns empty for falsy input', () => {
    expect(extractSubgridName(undefined)).toBe('')
    expect(extractSubgridName('')).toBe('')
    expect(extractSubgridName('   ')).toBe('')
  })

  it('extracts GIS coordinate syntax (priority 1)', () => {
    expect(extractSubgridName('N93E70-0001.jpg')).toBe('N93E70')
    expect(extractSubgridName('sp-b-N93E70-0001.jpg')).toBe('N93E70')
    expect(extractSubgridName('s12w45')).toBe('S12W45')
    expect(extractSubgridName('folder/x/N93E70')).toBe('N93E70')
  })

  it('extracts general prefix before hyphen or underscore (priority 2)', () => {
    expect(extractSubgridName('MAIN-0001.jpg')).toBe('MAIN')
    // The prefix regex captures only the first alphanumeric run before a separator
    expect(extractSubgridName('survey_area_01.jpg')).toBe('SURVEY')
  })

  it('falls back to file basename without extension (priority 3)', () => {
    expect(extractSubgridName('plainfile.jpg')).toBe('PLAINFILE')
    expect(extractSubgridName('dir/other.png')).toBe('OTHER')
  })

  it('applies GIS syntax even with mixed separators', () => {
    expect(extractSubgridName('prefix_N93E70_extra')).toBe('N93E70')
  })
})

describe('generateImageFilenamesList', () => {
  it('count defaults to 1 for non-positive count', () => {
    const list = generateImageFilenamesList('N93E70', 0)
    expect(list).toHaveLength(1)
    expect(list[0]).toContain('N93E70')
  })

  it('generates zero-padded suffixes when no base filename', () => {
    const list = generateImageFilenamesList('N93E70', 3)
    expect(list).toEqual([
      'N93E70-0001.jpg',
      'N93E70-0002.jpg',
      'N93E70-0003.jpg'
    ])
  })

  it('uses SUBGRID placeholder prefix when subgrid empty and no base filename', () => {
    const list = generateImageFilenamesList('', 2)
    expect(list[0]).toMatch(/SUBGRID-\d{4}\.jpg/)
  })

  it('continues numbering from a provided base filename', () => {
    const list = generateImageFilenamesList('N93E70', 3, 'N93E70-0010.jpg')
    expect(list).toEqual([
      'N93E70-0010.jpg',
      'N93E70-0011.jpg',
      'N93E70-0012.jpg'
    ])
  })

  it('preserves zero padding width from base filename', () => {
    const list = generateImageFilenamesList('N93E70', 2, 'N93E70-0007.jpg')
    expect(list).toEqual(['N93E70-0007.jpg', 'N93E70-0008.jpg'])
  })
})

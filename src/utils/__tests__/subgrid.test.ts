import { describe, it, expect } from 'vitest'
import { extractSubgridName } from '../subgrid'

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

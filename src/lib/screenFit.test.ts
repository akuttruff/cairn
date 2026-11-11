import { describe, it, expect } from 'vitest'
import { appHeight } from './screenFit.ts'

const phone = { screenWidth: 430, screenHeight: 932, landscape: false }

describe('appHeight', () => {
  it('stretches an installed app laid out short of the screen to the full height', () => {
    expect(appHeight({ ...phone, standalone: true, innerHeight: 870 })).toBe(932)
  })

  it('leaves a browser tab, or an app that already fills the screen, to CSS', () => {
    expect(appHeight({ ...phone, standalone: false, innerHeight: 760 })).toBeNull()
    expect(appHeight({ ...phone, standalone: true, innerHeight: 932 })).toBeNull()
  })

  it('uses the short side when the phone is on its side', () => {
    expect(appHeight({ ...phone, standalone: true, innerHeight: 400, landscape: true })).toBe(430)
  })
})

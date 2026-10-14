import { describe, it, expect } from 'vitest'
import { carriesPicture, pictureOf } from './pictures.ts'

const png = new File(['x'], 'shot.png', { type: 'image/png' })
const pdf = new File(['x'], 'menu.pdf', { type: 'application/pdf' })
const item = (file: File | null, kind = 'file', type = file?.type ?? 'text/plain') => ({ kind, type, getAsFile: () => file })
const transfer = (items: ReturnType<typeof item>[], files: File[] = []) => ({ items, files }) as unknown as DataTransfer

describe('pictures', () => {
  it('knows a drag that carries a picture before the files are given out', () => {
    expect(carriesPicture(transfer([item(null, 'file', 'image/jpeg')]))).toBe(true)
    expect(carriesPicture(transfer([item(null, 'string', 'text/plain'), item(null, 'file', 'application/pdf')]))).toBe(false)
    expect(carriesPicture(null)).toBe(false)
  })

  it('takes the first picture out of a paste or drop, ignoring the rest', () => {
    expect(pictureOf(transfer([item(null, 'string', 'text/html'), item(pdf), item(png)]))).toBe(png)
    expect(pictureOf(transfer([item(pdf)]))).toBeNull()
    expect(pictureOf(transfer([], [pdf, png]))).toBe(png)
    expect(pictureOf(undefined)).toBeNull()
  })
})

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DataTable } from './index'

afterEach(cleanup)

const words = [
  'Mali',
  'Anan',
  'Ploy',
  'Krit',
  'Dao',
  'Fah',
  'Nok',
  'Ton',
  'Pim',
  'Beam',
  'Win',
  'Zoe',
]
const many = words.map((name, i) => ({ id: i, name, age: 30 - i }))

describe('datakable <DataTable />', () => {
  it('zero-config <DataTable data={rows} /> installs the default preset', () => {
    render(<DataTable data={many} />)
    expect(screen.getByRole('searchbox')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Pagination' }).textContent).toContain(
      'Page 1 of 2',
    )
    const age = screen.getByRole('columnheader', { name: /age/ })
    fireEvent.click(within(age).getByRole('button'))
    expect(age.getAttribute('aria-sort')).toBe('ascending')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Ploy' } })
    const body = screen.getAllByRole('rowgroup')[1] as HTMLElement
    expect(within(body).getAllByRole('row')).toHaveLength(1)
  })
})

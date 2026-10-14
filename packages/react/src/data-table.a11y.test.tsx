import { type FetchResult, pagination, search, sorting } from '@datakable/core'
import { withFetcher } from '@datakable/core/server'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { DataTable } from './data-table'
import { useDataTable } from './use-data-table'

// Accessibility of the default parts (#54–#60): names, live status, focus.

type User = { id: number; name: string; city: string }
const users: User[] = Array.from({ length: 25 }, (_, i) => ({
  id: i + 1,
  name: `User ${i + 1}`,
  city: i % 5 ? 'Oslo' : 'Kyoto',
}))

let consoleError: MockInstance
let consoleWarn: MockInstance
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  consoleError.mockRestore()
  consoleWarn.mockRestore()
})

function Hooked(props: { options: Record<string, unknown>; caption?: string }) {
  return <DataTable table={useDataTable(props.options as never) as never} caption={props.caption} />
}

describe('a failed cell has a text alternative (#60)', () => {
  it('the ⚠ of a throwing cell is an image named "Could not display this value"', () => {
    render(
      <DataTable
        data={users.slice(0, 3)}
        columns={[
          { key: 'id' },
          {
            key: 'name',
            cell: ({ value }: { value: unknown }) => {
              if (value === 'User 2') throw new Error('x')
              return value as string
            },
          },
        ]}
      />,
    )
    const cell = screen.getAllByRole('row')[2]?.querySelectorAll('td')[1] as HTMLElement
    expect(cell.textContent).toBe('⚠')
    expect(within(cell).getByRole('img').getAttribute('aria-label')).toBe(
      'Could not display this value',
    )
  })

  it('so is the ⚠ of a cell whose component throws while React renders it', () => {
    const Boom = (): never => {
      throw new Error('x')
    }
    render(
      <DataTable
        data={users.slice(0, 1)}
        columns={[{ key: 'id' }, { key: 'name', cell: () => <Boom /> }]}
      />,
    )
    const cell = screen.getAllByRole('row')[1]?.querySelectorAll('td')[1] as HTMLElement
    expect(within(cell).getByRole('img', { name: 'Could not display this value' })).toBeTruthy()
  })
})

describe('the search box and pager are named after the caption (#59)', () => {
  it('two tables on a page get distinct search and navigation names', () => {
    const features = () => [search(), pagination()]
    render(
      <>
        <Hooked caption="Customers" options={{ data: users, features: features() }} />
        <Hooked caption="Suppliers" options={{ data: users, features: features() }} />
      </>,
    )
    expect(screen.getAllByRole('searchbox').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Search Customers',
      'Search Suppliers',
    ])
    expect(screen.getAllByRole('navigation').map((n) => n.getAttribute('aria-label'))).toEqual([
      'Customers pagination',
      'Suppliers pagination',
    ])
  })

  it('without a text caption the names stay "Search" and "Pagination"; custom parts get the label', () => {
    const seen: string[] = []
    render(
      <DataTable
        data={users}
        features={[search(), pagination()]}
        components={{
          SearchInput: (p) => {
            seen.push(p.label)
            return null
          },
        }}
      />,
    )
    expect(seen.at(-1)).toBe('Search')
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeTruthy()
  })
})

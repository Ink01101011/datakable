import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { App } from './App'
import { ROW_COUNT, rows } from './data'

let consoleError: MockInstance
let consoleWarn: MockInstance
beforeEach(() => {
  vi.useFakeTimers()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  consoleError.mockRestore()
  consoleWarn.mockRestore()
})

const section = (name: string) => screen.getByRole('region', { name })

describe('playground <App />', () => {
  it('generates ~10k rows locally', () => {
    expect(rows).toHaveLength(ROW_COUNT)
    expect(ROW_COUNT).toBeGreaterThanOrEqual(10_000)
  })

  it('renders the zero-config table, the four examples and the diagnostics panel', async () => {
    render(<App />)
    await act(async () => {})

    const zero = section('Zero-config <DataTable />')
    expect(within(zero).getByRole('table')).toBeTruthy()
    expect(within(zero).getAllByRole('columnheader').length).toBeGreaterThan(0)
    expect(section('useDataTable with a custom render')).toBeTruthy()
    expect(section('Server mode')).toBeTruthy()
    expect(section('Schema, flag mode')).toBeTruthy()
    expect(section('Diagnostics')).toBeTruthy()
  })

  it('server mode shows Loading, then the fetched rows', async () => {
    render(<App />)
    const server = section('Server mode')
    expect(within(server).getByText('Loading…')).toBeTruthy()
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(server.querySelector('[data-datakable]')?.getAttribute('data-status')).toBe('idle')
    expect(server.querySelectorAll('tbody tr').length).toBeGreaterThan(1)
  })

  it('schema flag mode marks invalid rows and reports them in the diagnostics panel', async () => {
    render(<App />)
    await act(async () => {})
    const flagged = section('Schema, flag mode')
    expect(flagged.querySelectorAll('tbody tr[data-invalid="true"]').length).toBeGreaterThan(0)
    expect(
      within(section('Diagnostics')).getAllByText(/DK_SCHEMA_INVALID_ROW/).length,
    ).toBeGreaterThan(0)
  })
})

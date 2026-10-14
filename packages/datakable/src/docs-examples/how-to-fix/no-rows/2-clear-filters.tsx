import { DataTable, useDataTable } from 'datakable/react'

type Product = { sku: string; name: string; price: number }

export function Products({ products }: { products: Product[] }) {
  const table = useDataTable({ data: products, rowKey: 'sku' })
  const { totalCount, filteredCount } = table.rowModel
  // There is data, but the filters or the search removed every row: offer a way back.
  const hidden = totalCount > 0 && filteredCount === 0
  return (
    <>
      {hidden && (
        <button
          type="button"
          onClick={() => {
            table.resetColumnFilters()
            table.clearSearch()
          }}
        >
          Clear filters and search
        </button>
      )}
      <DataTable table={table} />
    </>
  )
}

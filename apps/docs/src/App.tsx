import { useDataTable, VERSION } from 'datakable'

type User = { id: number; name: string; email: string }

const users: User[] = [
  { id: 1, name: 'Ada Lovelace', email: 'ada@example.com' },
  { id: 2, name: 'Alan Turing', email: 'alan@example.com' },
  { id: 3, name: 'Grace Hopper', email: 'grace@example.com' },
]

export function App() {
  const { rowModel } = useDataTable({ data: users })

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24 }}>
      <h1>DataKable playground</h1>
      <p>v{VERSION}</p>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Email</th>
          </tr>
        </thead>
        <tbody>
          {rowModel.rows.map(({ key, original: u }) => (
            <tr key={key}>
              <td>{u.id}</td>
              <td>{u.name}</td>
              <td>{u.email}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}

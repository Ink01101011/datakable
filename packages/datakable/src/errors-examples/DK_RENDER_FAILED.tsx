import { DataTable } from '@datakable/react'

type User = { id: number; name: string; avatar?: { url: string } }
const users: User[] = [
  { id: 1, name: 'Ada', avatar: { url: '/ada.png' } },
  { id: 2, name: 'Grace' }, // no avatar
]

function Avatar({ user }: { user: User }) {
  const { url } = user.avatar as { url: string } // throws for Grace
  return <img src={url} alt="" />
}

export default function Users() {
  return (
    <DataTable
      data={users}
      rowKey="id"
      columns={[{ key: 'id' }, { key: 'name', cell: ({ row }) => <Avatar user={row} /> }]}
    />
  )
}

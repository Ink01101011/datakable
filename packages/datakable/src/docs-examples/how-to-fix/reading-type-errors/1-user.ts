// The row type of the examples on this page.
export type User = {
  id: number
  first: string
  age: number
  address: { city: string; geo: { lat: number; lng: number } }
  onClick: () => void
  friends: { id: number }[]
}

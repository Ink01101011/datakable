import type { FetchOutcome } from 'datakable'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Retries a failed load, waiting longer each time (1 s, 2 s, 4 s). refetch() never rejects.
export async function refetchWithRetry(
  table: { refetch(): Promise<FetchOutcome> },
  attempts = 3,
): Promise<FetchOutcome['status']> {
  for (let attempt = 0; ; attempt++) {
    const { status } = await table.refetch()
    if (status !== 'error' || attempt + 1 >= attempts) return status
    await wait(1000 * 2 ** attempt)
  }
}

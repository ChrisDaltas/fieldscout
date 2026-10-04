/**
 * A database read that failed, said to a league member (friendly server
 * messages, part 1). The member sees one plain sentence; the table and the
 * raw database error go to the server log only — never to the browser.
 * Still a 500: a failed read is never an empty success.
 */
export const DB_FAILURE_COPY = 'Something went wrong — try again.'

export function dbFailure(where: string, error: { message: string }): { status: 500; body: { error: string } } {
  console.error(`league read failed — ${where}: ${error.message}`)
  return { status: 500, body: { error: DB_FAILURE_COPY } }
}

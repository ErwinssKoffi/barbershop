import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleSalonApiRequest } from '../server/apiHandler.ts'

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  await handleSalonApiRequest(req, res)
}

/** Error carrying an HTTP status the error handler will honour. */
export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
  }
}

export const unauthorized = (m = 'authentication required') => new HttpError(401, m)
export const forbidden = (m = 'forbidden') => new HttpError(403, m)
export const notFound = (m = 'not found') => new HttpError(404, m)
export const badRequest = (m = 'bad request') => new HttpError(400, m)

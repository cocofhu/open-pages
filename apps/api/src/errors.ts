export class ClientError extends Error {
  readonly status: 400 | 401 | 403 | 429;

  constructor(message: string, status: 400 | 401 | 403 | 429 = 400) {
    super(message);
    this.name = "ClientError";
    this.status = status;
  }
}

export function asClientError(error: unknown): ClientError | null {
  if (error instanceof ClientError) return error;
  if (!(error instanceof Error)) return null;
  if (error.message === "Not signed in") return new ClientError(error.message, 401);
  if (error.message.startsWith("Too many requests")) {
    return new ClientError(error.message, 429);
  }
  if (
    /^(Invalid |Path not allowed|Too many files|File too large|Repository name|Cannot publish|Theme package not installed|Hexo 没有生成首页|Hexo 首页是空的|YAMLException|hexo generate timed out|hexo generate failed)/.test(
      error.message,
    )
  ) {
    return new ClientError(error.message, 400);
  }
  return null;
}

export function portalPath(slug: string) {
  return `/threads/${encodeURIComponent(slug)}`;
}

export function customerThreadPath(slug: string, threadId: string) {
  return `${portalPath(slug)}/thread/${encodeURIComponent(threadId)}`;
}

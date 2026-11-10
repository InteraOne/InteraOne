import {
  FetchedPage,
  crawlPages,
  fetchSinglePage,
} from "../sources/playwright-crawler";
import { ContentStreamItem } from "../ingestion.types";

export async function* streamFromText(
  content: string,
  sourceRef = "text:0",
  metadata?: Record<string, unknown>,
): AsyncGenerator<ContentStreamItem> {
  if (!content.trim()) return;
  yield { sourceRef, text: content, metadata };
}

export async function* streamFromPages(
  pages: FetchedPage[],
): AsyncGenerator<ContentStreamItem> {
  let pageIndex = 0;
  for (const page of pages) {
    if (!page.text.trim()) continue;
    yield {
      sourceRef: page.url,
      text: page.text,
      metadata: { sourceUrl: page.url, pageIndex },
    };
    pageIndex += 1;
  }
}

export async function* streamFromSingleUrl(
  url: string,
): AsyncGenerator<ContentStreamItem> {
  const pages = await fetchSinglePage(url);
  yield* streamFromPages(pages);
}

export async function* streamFromCrawl(
  rootUrl: string,
  maxDepth: number,
): AsyncGenerator<ContentStreamItem> {
  let pageIndex = 0;
  for await (const page of crawlPages(rootUrl, maxDepth)) {
    if (!page.text.trim()) continue;
    yield {
      sourceRef: page.url,
      text: page.text,
      metadata: { sourceUrl: page.url, pageIndex },
    };
    pageIndex += 1;
  }
}

import { Fragment } from "react";

export function RichText({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground/90">
      {text.split(/(```[\s\S]*?```)/g).map((block, index) =>
        block.startsWith("```") ? (
          <pre
            key={index}
            className="my-3 overflow-x-auto rounded-lg border bg-muted/60 p-4 text-sm"
          >
            <code>{block.slice(3, -3).replace(/^\w*\n/, "")}</code>
          </pre>
        ) : (
          <Fragment key={index}>
            {block
              .split(
                /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g,
              )
              .map((part, i) => {
                if (part.startsWith("**") && part.endsWith("**"))
                  return <strong key={i}>{part.slice(2, -2)}</strong>;
                if (part.startsWith("`") && part.endsWith("`"))
                  return (
                    <code
                      key={i}
                      className="rounded bg-muted px-1 py-0.5 text-sm"
                    >
                      {part.slice(1, -1)}
                    </code>
                  );
                const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(
                  part,
                );
                return link ? (
                  <a
                    key={i}
                    href={link[2]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4"
                  >
                    {link[1]}
                  </a>
                ) : (
                  part
                );
              })}
          </Fragment>
        ),
      )}
    </div>
  );
}

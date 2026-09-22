"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

/**
 * Tutti gli ospiti ricevono l'istruzione di rispondere in Markdown con la
 * matematica in LaTeX: qui la si rende, normalizzando la tipografia fra
 * famiglie che altrimenti userebbero ciascuna la propria.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

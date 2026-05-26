import { Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { go } from "@codemirror/lang-go";
import { php } from "@codemirror/lang-php";
import { sql } from "@codemirror/lang-sql";
import { graphql } from "cm6-graphql";

export function getLanguageExtension(filename: string): Extension[] {
  if (!filename) return [];

  const ext = filename.split(".").pop()?.toLowerCase() || "";

  switch (ext) {
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return [javascript({ jsx: true })];
    case "ts":
    case "tsx":
      return [javascript({ jsx: true, typescript: true })];
    case "py":
    case "pyw":
      return [python()];
    case "html":
    case "htm":
      return [html()];
    case "css":
      return [css()];
    case "json":
      return [json()];
    case "md":
    case "markdown":
      return [markdown()];
    case "rs":
      return [rust()];
    case "c":
    case "cpp":
    case "cxx":
    case "cc":
    case "h":
    case "hpp":
      return [cpp()];
    case "java":
      return [java()];
    case "go":
      return [go()];
    case "php":
      return [php()];
    case "sql":
      return [sql()];
    case "graphql":
    case "gql":
      return [graphql()];
    default:
      return [];
  }
}

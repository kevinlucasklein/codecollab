import { 
  FileCode2, 
  FileJson, 
  FileText, 
  Database, 
  Terminal, 
  Box, 
  File,
  LucideIcon
} from "lucide-react";

export interface FileIconMeta {
  displayName: string;
  icon: LucideIcon;
  color: string;
}

export function getFileIconMeta(filename: string | undefined): FileIconMeta {
  if (!filename) {
    return { displayName: "Text", icon: FileText, color: "#8b949e" };
  }

  const ext = filename.split(".").pop()?.toLowerCase() || "";

  switch (ext) {
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return { displayName: "JavaScript", icon: FileCode2, color: "#f7df1e" };
    case "ts":
    case "tsx":
      return { displayName: "TypeScript", icon: FileCode2, color: "#3178c6" };
    case "py":
    case "pyw":
      return { displayName: "Python", icon: Terminal, color: "#3776ab" };
    case "html":
    case "htm":
      return { displayName: "HTML", icon: FileCode2, color: "#e34f26" };
    case "css":
      return { displayName: "CSS", icon: FileCode2, color: "#1572b6" };
    case "json":
      return { displayName: "JSON", icon: FileJson, color: "#cb3837" };
    case "md":
    case "markdown":
      return { displayName: "Markdown", icon: FileText, color: "#ffffff" };
    case "rs":
      return { displayName: "Rust", icon: Box, color: "#dea584" };
    case "c":
    case "cpp":
    case "cxx":
    case "cc":
    case "h":
    case "hpp":
      return { displayName: "C/C++", icon: FileCode2, color: "#00599c" };
    case "java":
      return { displayName: "Java", icon: FileCode2, color: "#b07219" };
    case "go":
      return { displayName: "Go", icon: FileCode2, color: "#00add8" };
    case "php":
      return { displayName: "PHP", icon: FileCode2, color: "#777bb4" };
    case "sql":
      return { displayName: "SQL", icon: Database, color: "#336791" };
    case "graphql":
    case "gql":
      return { displayName: "GraphQL", icon: FileCode2, color: "#e10098" };
    default:
      return { displayName: "Text", icon: File, color: "#8b949e" };
  }
}

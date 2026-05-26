"use client";

import React, { useEffect, useRef } from "react";
import * as Y from "yjs";
import { EditorState } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { yCollab } from "y-codemirror.next";
import { Awareness } from "y-protocols/awareness";
import { MergeView } from "@codemirror/merge";
import styles from "./editor.module.css";

interface DiffEditorProps {
  ytext: Y.Text;
  awareness: Awareness;
  baseContent: string;
}

export function DiffEditor({ ytext, awareness, baseContent }: DiffEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MergeView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // We only create the MergeView once on mount
    const view = new MergeView({
      a: {
        doc: baseContent,
        extensions: [
          basicSetup,
          EditorState.readOnly.of(true)
        ]
      },
      b: {
        doc: ytext.toString(),
        extensions: [
          basicSetup,
          yCollab(ytext, awareness)
        ]
      },
      parent: containerRef.current
    });

    viewRef.current = view;

    return () => {
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytext, awareness]); 
  // Note: we purposefully do not include baseContent in deps so it doesn't re-render 
  // and destroy the view if something else changes. baseContent is static anyway.

  return (
    <div 
      ref={containerRef} 
      className={styles.editorContainer} 
      style={{ display: "flex", flex: 1, overflow: "hidden" }}
    />
  );
}

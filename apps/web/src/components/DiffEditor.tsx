"use client";

import React, { useEffect, useRef } from "react";
import * as Y from "yjs";
import { EditorState, Compartment } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { yCollab } from "y-codemirror.next";
import { Awareness } from "y-protocols/awareness";
import { MergeView } from "@codemirror/merge";
import { oneDark } from "@codemirror/theme-one-dark";
import { getLanguageExtension } from "../lib/languageMatcher";
import styles from "./editor.module.css";

interface DiffEditorProps {
  ytext: Y.Text;
  awareness: Awareness;
  baseContent: string;
  filename?: string;
}

export function DiffEditor({ ytext, awareness, baseContent, filename }: DiffEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MergeView | null>(null);
  const languageCompartmentA = useRef(new Compartment());
  const languageCompartmentB = useRef(new Compartment());

  useEffect(() => {
    if (!containerRef.current) return;

    const languageExtensions = filename ? getLanguageExtension(filename) : [];

    // We only create the MergeView once on mount
    const view = new MergeView({
      a: {
        doc: baseContent,
        extensions: [
          basicSetup,
          oneDark,
          languageCompartmentA.current.of(languageExtensions),
          EditorState.readOnly.of(true)
        ]
      },
      b: {
        doc: ytext.toString(),
        extensions: [
          basicSetup,
          oneDark,
          languageCompartmentB.current.of(languageExtensions),
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

  // Dynamically reconfigure language state when filename prop changes
  useEffect(() => {
    if (viewRef.current) {
      const languageExtensions = filename ? getLanguageExtension(filename) : [];
      viewRef.current.a.dispatch({
        effects: languageCompartmentA.current.reconfigure(languageExtensions)
      });
      viewRef.current.b.dispatch({
        effects: languageCompartmentB.current.reconfigure(languageExtensions)
      });
    }
  }, [filename]);

  return (
    <div 
      ref={containerRef} 
      className={styles.editorContainer} 
      style={{ display: "flex", flex: 1, overflow: "hidden" }}
    />
  );
}

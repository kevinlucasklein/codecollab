"use client";

import React, { useEffect, useRef } from "react";
import * as Y from "yjs";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import { yCollab } from "y-codemirror.next";
import { Awareness } from "y-protocols/awareness";
import { oneDark } from "@codemirror/theme-one-dark";
import { commentGutterExtension } from "./extensions/commentGutter";
import { getLanguageExtension } from "../lib/languageMatcher";
import styles from "./editor.module.css";

interface EditorProps {
  ytext: Y.Text;
  awareness: Awareness;
  disabled?: boolean;
  filename?: string;
  onCommentClick?: (lineNumber: number) => void;
}

export function Editor({ ytext, awareness, disabled, filename, onCommentClick }: EditorProps) {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyCompartment = useRef(new Compartment());
  const languageCompartment = useRef(new Compartment());

  useEffect(() => {
    if (!editorContainerRef.current) return;

    const languageExtensions = filename ? getLanguageExtension(filename) : [];

    const extensions = [
      basicSetup,
      oneDark,
      languageCompartment.current.of(languageExtensions),
      yCollab(ytext, awareness),
      readOnlyCompartment.current.of(EditorState.readOnly.of(disabled || false)),
      ...(onCommentClick ? [commentGutterExtension(onCommentClick)] : [])
    ];

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions
    });

    const view = new EditorView({
      state,
      parent: editorContainerRef.current
    });

    viewRef.current = view;

    return () => {
      view.destroy();
    };
    // Only run once on mount. We DO NOT want to destroy/recreate the editor when `disabled` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytext]);

  // Dynamically reconfigure language state when filename prop changes
  useEffect(() => {
    if (viewRef.current) {
      const languageExtensions = filename ? getLanguageExtension(filename) : [];
      viewRef.current.dispatch({
        effects: languageCompartment.current.reconfigure(languageExtensions)
      });
    }
  }, [filename]);

  // Dynamically reconfigure readOnly state when disabled prop changes
  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(disabled || false))
      });
    }
  }, [disabled]);

  return (
    <div 
      ref={editorContainerRef} 
      className={styles.editorContainer} 
    />
  );
}

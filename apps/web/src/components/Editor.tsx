"use client";

import React, { useEffect, useRef } from "react";
import * as Y from "yjs";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import { yCollab } from "y-codemirror.next";
import { Awareness } from "y-protocols/awareness";
import { commentGutterExtension } from "./extensions/commentGutter";
import styles from "./editor.module.css";

interface EditorProps {
  ytext: Y.Text;
  awareness: Awareness;
  disabled?: boolean;
  onCommentClick?: (lineNumber: number) => void;
}

export function Editor({ ytext, awareness, disabled, onCommentClick }: EditorProps) {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyCompartment = useRef(new Compartment());

  useEffect(() => {
    if (!editorContainerRef.current) return;

    const extensions = [
      basicSetup,
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

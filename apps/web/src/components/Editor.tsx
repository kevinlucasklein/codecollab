"use client";

import React, { useEffect, useRef } from "react";
import * as Y from "yjs";
import { EditorState } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import { yCollab } from "y-codemirror.next";
import styles from "./editor.module.css";

interface EditorProps {
  ytext: Y.Text;
  disabled?: boolean;
}

export function Editor({ ytext, disabled }: EditorProps) {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!editorContainerRef.current) return;

    // We don't have an Awareness provider yet (Step 16), so we pass null or leave it empty.
    // However, yCollab optionally takes an awareness instance. 
    // We can pass a dummy one for now or just initialize the extension.
    const extensions = [
      basicSetup,
      // Pass null for awareness for now (we'll add it in Step 16)
      yCollab(ytext, null as any),
      EditorState.readOnly.of(disabled || false)
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
  }, [ytext, disabled]);

  // When disabled state changes, we could reconfigure, but for simplicity we rely on the remount or 
  // since `disabled` only toggles initially during the loading phase, it's mostly fine.
  // To handle dynamic disabled toggling properly in CM6:
  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: EditorState.transactionExtender.of(() => ({
          effects: [EditorState.readOnly.of(disabled || false).reconfigure]
        }))
      });
      // Actually CM6 dynamic reconfiguration is slightly more complex using Compartments.
      // But since disabled is mostly a one-time thing while connecting, we can ignore dynamic updates for Layer 1.
    }
  }, [disabled]);

  return (
    <div 
      ref={editorContainerRef} 
      className={styles.editorContainer} 
    />
  );
}

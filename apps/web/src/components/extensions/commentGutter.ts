import { gutter, GutterMarker } from "@codemirror/view";

// Marker that renders the "+" button in the gutter
class CommentButtonMarker extends GutterMarker {
  toDOM() {
    const btn = document.createElement("button");
    btn.className = "cm-comment-btn";
    btn.innerHTML = "+";
    btn.title = "Add a comment on this line";
    return btn;
  }
}

const commentMarker = new CommentButtonMarker();

export const commentGutterExtension = (onCommentClick: (lineNumber: number) => void) => {
  return gutter({
    class: "cm-comment-gutter",
    lineMarker() {
      // Return a marker for every line so the button exists in the DOM.
      // We will hide it using CSS and only show it when hovering over the line.
      return commentMarker;
    },
    initialSpacer: () => commentMarker,
    domEventHandlers: {
      mousedown(view, lineBlock, event) {
        // Prevent default to avoid stealing focus from the editor if we don't want to
        event.preventDefault();
        
        const pos = lineBlock.from;
        const line = view.state.doc.lineAt(pos);
        
        onCommentClick(line.number);
        
        // Return true to indicate we handled the event
        return true;
      }
    }
  });
};

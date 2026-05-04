import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

interface Props {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

const toolbarBtnStyle: React.CSSProperties = {
  padding: '0.25rem 0.6rem',
  border: '1px solid var(--border, #d8cfbc)',
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '0.95rem',
  borderRadius: '0.25rem',
};
const activeBtnStyle: React.CSSProperties = {
  ...toolbarBtnStyle,
  background: 'var(--ink, #1a3548)',
  color: 'var(--paper, #fafaf5)',
  borderColor: 'var(--ink, #1a3548)',
};

/** Minimal WYSIWYG for the house chapter-intro. Three buttons: bold,
 * italic, h2. StarterKit also gives us paragraphs and undo/redo for free.
 * Output is HTML; the read side sanitizes via DOMPurify before render. */
export const RichTextEditor = ({ value, onChange, disabled, placeholder }: Props) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Don't need lists / blockquote / code in this short-text use case;
        // turning them off keeps the toolbar simple and the output tidy.
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        strike: false,
        heading: { levels: [2] },
      }),
    ],
    content: value || '',
    editable: !disabled,
    onUpdate: ({ editor: e }) => {
      const html = e.getHTML();
      // Tiptap renders an empty doc as "<p></p>" — collapse to '' so the
      // dirty/empty checks elsewhere behave sensibly.
      onChange(html === '<p></p>' ? '' : html);
    },
    editorProps: {
      attributes: {
        // Reasonable defaults; the wrapping <div> below provides the frame.
        style: 'min-height: 8rem; outline: none; font-family: inherit; font-size: 1rem; line-height: 1.55;',
        ...(placeholder ? { 'data-placeholder': placeholder } : {}),
      },
    },
  });

  // Re-sync external value changes (e.g. when the profile arrives after
  // mount, or after a successful save when we re-fetch /me).
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const incoming = value || '<p></p>';
    if (current !== incoming) editor.commands.setContent(incoming, { emitUpdate: false });
  }, [value, editor]);

  useEffect(() => {
    if (editor) editor.setEditable(!disabled);
  }, [disabled, editor]);

  if (!editor) return null;

  const btn = (label: string, isActive: boolean, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={isActive ? activeBtnStyle : toolbarBtnStyle}
      aria-pressed={isActive}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        border: '1px solid var(--border, #d8cfbc)',
        borderRadius: '0.4rem',
        background: 'var(--paper, #fafaf5)',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: '0.4rem',
          padding: '0.4rem 0.5rem',
          borderBottom: '1px solid var(--border, #d8cfbc)',
        }}
      >
        {btn(
          'Overskrift',
          editor.isActive('heading', { level: 2 }),
          () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        )}
        {btn('Fed', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run())}
        {btn('Kursiv', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run())}
      </div>
      <div style={{ padding: '0.75rem 1rem' }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};
